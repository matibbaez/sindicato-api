import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reclamo, ReclamoEstado, MensajeReclamo } from './entities/reclamo.entity';
import { CreateReclamoDto } from './dto/create-reclamo.dto';
import { StorageService } from 'src/storage/storage.service';
import { randomBytes } from 'crypto';
import { extname } from 'path';
import { MailService } from 'src/mail/mail.service';
import { PdfService } from 'src/common/pdf.service'; 
import { User, UserRole } from 'src/users/entities/user.entity';

const MAX_SIZE_BYTES = 10 * 1024 * 1024;
// En src/reclamos/reclamos.service.ts
const ALLOWED_MIME_TYPES = [
  'application/pdf', 
  'image/jpeg', 
  'image/png', 
  'image/webp', 
  'image/heic', 
  'image/heif' 
];

@Injectable()
export class ReclamosService {

  constructor(
    @InjectRepository(Reclamo) private readonly reclamoRepository: Repository<Reclamo>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly storageService: StorageService,
    private readonly mailService: MailService,
    private readonly pdfService: PdfService,
  ) { }

  private async validateFile(file: Express.Multer.File) {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(`Formato inválido: ${file.originalname}`);
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new BadRequestException(`Archivo muy pesado: ${file.originalname}`);
    }
  }

  // ----------------------------------------------------------------------
  // 1. CREATE (OPTIMIZADO, FLEXIBILIZADO Y CON PASO INTERMEDIO SEGURO)
  // ----------------------------------------------------------------------
  async create(dto: CreateReclamoDto, files: any) {

    // --- A. VALIDACIÓN LÓGICA ESTRICTA (Solo datos de contacto esenciales) ---
    if (!dto.nombre) throw new BadRequestException('El nombre es obligatorio.');
    if (!dto.telefono) throw new BadRequestException('El teléfono es obligatorio.');
    if (!dto.dni) throw new BadRequestException('El DNI es obligatorio.');
    if (!dto.rol_victima) throw new BadRequestException('El rol de la víctima es obligatorio.');

    // Parseo seguro de estados booleanos enviados como String desde FormData
    const tieneSeguro = String(dto.tiene_seguro) === 'true';
    const hizoDenuncia = String(dto.hizo_denuncia) === 'true';
    const inItinere = String(dto.in_itinere) === 'true'; 
    const poseeArt = String(dto.posee_art) === 'true'; 
    const sufrioLesiones = String(dto.sufrio_lesiones) === 'true';
    const intervinoPolicia = String(dto.intervino_policia) === 'true';
    const intervinoAmbulancia = String(dto.intervino_ambulancia) === 'true';

    // Se eliminaron todos los "throw BadRequestException" de fileLicencia, fileCedula, 
    // fileSeguro, fileMedicos, etc. Ahora el trámite pasa sí o sí aunque venga sin adjuntos.

    // --- B. PREPARACIÓN PARA SUBIDA (Paralelismo) ---
    const { dni } = dto;
    const codigo_seguimiento = randomBytes(3).toString('hex').toUpperCase();
    const timestamp = Date.now();
    const firmaFile = (files.fileFirma && files.fileFirma.length > 0) ? files.fileFirma[0] : null;
    const firmaBuffer = firmaFile ? firmaFile.buffer : undefined;

    // Helpers de subida de archivos
    const upload = async (file: Express.Multer.File, tag: string, index?: number) => {
      if (!file) return null;
      await this.validateFile(file);
      const sufijo = index !== undefined ? `-${index + 1}` : '';
      const nombre = `${dni}-${tag}-${timestamp}${sufijo}${extname(file.originalname)}`;
      return this.storageService.uploadFile(file, tag, nombre);
    };

    const uploadSingle = (fileArray: any[], tag: string) => 
        (fileArray && fileArray.length > 0) ? upload(fileArray[0], tag) : Promise.resolve(null);

    const uploadMultiple = (fileArray: any[], tag: string) => 
        (fileArray && fileArray.length > 0) 
          ? Promise.all(fileArray.map((f, i) => upload(f, tag, i))) 
          : Promise.resolve([]);

    // 🚀 EJECUCIÓN PARALELA DE SUBIDAS
    const [
      path_dni,
      path_licencia,
      path_cedula,
      path_poliza_uploaded, 
      path_denuncia,        
      path_medicos,         
      path_presupuesto,     
      path_cbu_archivo,     
      path_denuncia_penal,  
      path_fotos_raw,       
      path_firma_archivo,   
      path_complementaria   
    ] = await Promise.all([
      uploadMultiple(files.fileDNI, 'dni'),
      uploadMultiple(files.fileLicencia, 'licencia'),
      uploadMultiple(files.fileCedula, 'cedula'),
      uploadMultiple(files.fileSeguro, 'poliza'),      
      uploadMultiple(files.fileDenuncia, 'denuncia'),  
      uploadMultiple(files.fileMedicos, 'medicos'),    
      uploadMultiple(files.filePresupuesto, 'presupuesto'), 
      uploadMultiple(files.fileCBU, 'cbu'),            
      uploadMultiple(files.fileDenunciaPenal, 'legal'),
      uploadMultiple(files.fileFotos, 'fotos'),
      uploadSingle(files.fileFirma, 'firmas'),
      uploadMultiple(files.fileComplementaria, 'complementaria')
    ]);

    const cleanArray = (arr: any) => Array.isArray(arr) ? arr.filter(p => p !== null) : [];
    
    // Preparar estructuras finales
    const path_fotos = cleanArray(path_fotos_raw);
    let path_poliza = cleanArray(path_poliza_uploaded); 

    // Tareas automáticas de generación de PDFs legales firmados
    const representacionTask = async () => {
        try {
            const pdfRep = await this.pdfService.generarRepresentacion({
                nombre: dto.nombre, dni: dto.dni || 'Sin DNI', fecha: new Date().toLocaleDateString('es-AR'),
                firma: firmaBuffer
            });
            const fileRep: any = { buffer: pdfRep, originalname: 'representacion.pdf', mimetype: 'application/pdf', size: pdfRep.length };
            return await this.storageService.uploadFile(fileRep, 'legales', `${dto.dni || 'sindni'}-representacion-${timestamp}.pdf`);
        } catch (e) { console.error('Error Rep:', e); return null; }
    };

    const honorariosTask = async () => {
        try {
            const pdfHon = await this.pdfService.generarHonorarios({
                nombre: dto.nombre, dni: dto.dni || 'Sin DNI', fecha: new Date().toLocaleDateString('es-AR'),
                firma: firmaBuffer 
            });
            const fileHon: any = { buffer: pdfHon, originalname: 'honorarios.pdf', mimetype: 'application/pdf', size: pdfHon.length };
            return await this.storageService.uploadFile(fileHon, 'legales', `${dto.dni || 'sindni'}-honorarios-${timestamp}.pdf`);
        } catch (e) { console.error('Error Hon:', e); return null; }
    };

    const noSeguroTask = async () => {
        if (dto.rol_victima === 'Conductor' && !tieneSeguro) {
            try {
                const pdfBuffer = await this.pdfService.generarCartaNoSeguro({
                    nombre: dto.nombre, dni: dto.dni || 'Sin DNI',
                    fecha: dto.fecha_hecho || new Date().toISOString().split('T')[0],
                    lugar: dto.lugar_hecho || 'No especificado', relato: dto.relato_hecho || '',
                    firma: firmaBuffer
                });
                const fakeFile: any = { buffer: pdfBuffer, originalname: `carta-no-seguro-${dto.dni || 'sindni'}.pdf`, mimetype: 'application/pdf', size: pdfBuffer.length };
                return await this.storageService.uploadFile(fakeFile, 'legales', `${dto.dni || 'sindni'}-carta-generada-${timestamp}.pdf`);
            } catch (e) { console.error('Error NoSeguro:', e); return null; }
        }
        return null;
    };

    const [path_representacion, path_honorarios, path_generado_noseguro] = await Promise.all([
        representacionTask(),
        honorariosTask(),
        noSeguroTask()
    ]);

    if (path_generado_noseguro) {
        path_poliza = [path_generado_noseguro];
    }

    // --- D. GUARDAR EN BASE DE DATOS ---
    const nuevoReclamo = this.reclamoRepository.create({
      nombre: dto.nombre,
      dni: dto.dni,
      email: dto.email,
      telefono: dto.telefono,
      domicilio_usuario: dto.domicilio_usuario,
      cbu: dto.cbu,
      
      rol_victima: dto.rol_victima,
      aseguradora_tercero: dto.aseguradora_tercero,
      patente_tercero: dto.patente_tercero,
      patente_propia: dto.patente_propia,
      
      tercero_nombre: dto.tercero_nombre,
      tercero_apellido: dto.tercero_apellido,
      tercero_dni: dto.tercero_dni,
      tercero_marca_modelo: dto.tercero_marca_modelo,

      relato_hecho: dto.relato_hecho,
      hora_hecho: dto.hora_hecho,
      fecha_hecho: dto.fecha_hecho,
      lugar_hecho: dto.lugar_hecho,
      localidad: dto.localidad,
      provincia: dto.provincia,
      
      in_itinere: inItinere,
      posee_art: poseeArt,
      tiene_seguro: tieneSeguro,
      hizo_denuncia: hizoDenuncia,
      sufrio_lesiones: sufrioLesiones,
      intervino_policia: intervinoPolicia,
      intervino_ambulancia: intervinoAmbulancia,

      codigo_seguimiento,
      estado: ReclamoEstado.ENVIADO,
      
      path_dni: cleanArray(path_dni) as string[], 
      path_licencia: cleanArray(path_licencia) as string[],
      path_cedula: cleanArray(path_cedula) as string[],
      
      path_poliza: path_poliza.length > 0 ? (path_poliza as string[]) : undefined,
      path_denuncia: cleanArray(path_denuncia).length > 0 ? (cleanArray(path_denuncia) as string[]) : undefined,
      path_medicos: cleanArray(path_medicos).length > 0 ? (cleanArray(path_medicos) as string[]) : undefined,
      path_presupuesto: cleanArray(path_presupuesto).length > 0 ? (cleanArray(path_presupuesto) as string[]) : undefined,
      path_cbu_archivo: cleanArray(path_cbu_archivo).length > 0 ? (cleanArray(path_cbu_archivo) as string[]) : undefined,
      path_denuncia_penal: cleanArray(path_denuncia_penal).length > 0 ? (cleanArray(path_denuncia_penal) as string[]) : undefined,
      
      path_fotos: path_fotos.length > 0 ? (path_fotos as string[]) : undefined,
      path_complementaria: cleanArray(path_complementaria).length > 0 ? (cleanArray(path_complementaria) as string[]) : undefined,

      path_representacion: path_representacion || undefined,
      path_honorarios: path_honorarios || undefined
    });

    await this.reclamoRepository.save(nuevoReclamo);

    // --- E. NOTIFICACIONES AUTOMÁTICAS ---
    if (dto.email) {
        this.mailService.sendNewReclamoClient(dto.email, dto.nombre, codigo_seguimiento).catch(console.error);
    }
    
    this.mailService.sendNewReclamoAdmin({
      nombre: dto.nombre,
      dni: dto.dni || 'Sin DNI',
      codigo_seguimiento,
      tipo: dto.rol_victima || 'No especificado' 
    }).catch(console.error);

    return { message: '¡Éxito!', codigo_seguimiento };
  }

  private validarAcceso(reclamo: Reclamo, user: any) {
    if (user.role === UserRole.ADMIN) return true; // El admin ve todo
    if (user.role === UserRole.SINDICATO) return true; // El sindicato ve todo (solo lectura)
    if (reclamo.tramitador?.id === user.id) return true; // El tramitador asignado ve lo suyo
    if (reclamo.usuario_creador?.id === user.id) return true; // El productor ve sus propios casos
    
    throw new ForbiddenException('Acceso denegado: No tienes permiso para ver o modificar este reclamo.');
  }

  // ----------------------------------------------------------------------
  // ASIGNAR O REMOVER TRAMITADOR
  // ----------------------------------------------------------------------
  async asignarTramitador(reclamoId: string, tramitadorId: string | null) {
    const reclamo = await this.reclamoRepository.findOne({ where: { id: reclamoId } });
    if (!reclamo) throw new NotFoundException('Reclamo no encontrado');

    // SI VIENE UN ID: Hacemos la lógica completa de asignación
    if (tramitadorId) {
      const tramitador = await this.userRepository.findOne({ where: { id: tramitadorId } });
      if (!tramitador) throw new NotFoundException('Usuario no encontrado');

      const rolesValidos = [UserRole.ADMIN, UserRole.TRAMITADOR];
      if (!rolesValidos.includes(tramitador.role as UserRole)) {
          throw new BadRequestException(`El usuario ${tramitador.nombre} no tiene permisos para gestionar reclamos.`);
      }

      reclamo.tramitador = tramitador;
      
      // Pasamos a recepcionado si estaba recién enviado
      if (reclamo.estado === ReclamoEstado.ENVIADO) {
        reclamo.estado = ReclamoEstado.RECEPCIONADO;
      }

      const actualizado = await this.reclamoRepository.save(reclamo);

      // Enviar notificación por correo al tramitador asignado
      this.mailService.sendTramitadorAssignment(
        tramitador.email,
        tramitador.nombre,
        actualizado.codigo_seguimiento,
        actualizado.nombre
      ).catch(err => console.error('❌ Error enviando mail de asignación al tramitador:', err));

      return actualizado;
      
    } else {
      // SI VIENE NULL: Lógica de remoción (tocaron el tacho de basura)
      reclamo.tramitador = null;
      // Guardamos el expediente sin abogado asignado
      return await this.reclamoRepository.save(reclamo);
    }
  }

  async getGaleria(id: string) {
    const reclamo = await this.reclamoRepository.findOne({ where: { id } });
    if (!reclamo) throw new NotFoundException('Reclamo no encontrado');

    const paths = reclamo.path_fotos; 
    
    if (!paths || paths.length === 0) {
      return { urls: [] };
    }

    const urls = await Promise.all(paths.map(async (p) => {
      const url = await this.storageService.createSignedUrl(p) as any;
      return url?.url || url; 
    }));

    return { urls }; 
  }

  // ----------------------------------------------------------------------
  // CONSULTAS Y UPDATES
  // ----------------------------------------------------------------------

  async findAll(estado?: string) {
    const where = estado ? { estado: estado as ReclamoEstado } : {};
    return this.reclamoRepository.find({ 
      where, 
      order: { fecha_creacion: 'DESC' },
      relations: ['usuario_creador', 'tramitador'] 
    });
  }

  async consultarPorCodigo(codigo: string, dni: string) { 
    const reclamo = await this.reclamoRepository.findOne({ 
      where: { 
        codigo_seguimiento: codigo,
        dni: dni 
      } 
    });

    if (!reclamo) throw new NotFoundException('No se encontró un trámite con esos datos. Verificá el Código y tu DNI.');

    return { 
        codigo_seguimiento: reclamo.codigo_seguimiento, 
        estado: reclamo.estado, 
        fecha_creacion: reclamo.fecha_creacion,
        updatedAt: reclamo['updatedAt'] || null,
        nombre: reclamo.nombre,
        mensajes: reclamo.mensajes,
    };
  }

  async update(id: string, body: any, user: any) { 
    const reclamo = await this.reclamoRepository.findOne({ 
        where: { id }, 
        relations: ['tramitador', 'usuario_creador'] // <-- Limpiado: quitamos referidoPor
    });
    
    if (!reclamo) throw new NotFoundException('No encontrado');
    
    // Bloqueamos si no tiene permiso para editar
    this.validarAcceso(reclamo, user);

    const estadoAnterior = reclamo.estado;

    Object.assign(reclamo, body);
    
    const actualizado = await this.reclamoRepository.save(reclamo);

    // 👇 NOTIFICACIONES DE CAMBIO DE ESTADO
    if (body.estado && body.estado !== estadoAnterior) {
        
        // 1. Notificar al ADMIN
        this.mailService.sendAdminStatusUpdate(
            reclamo.nombre, 
            reclamo.estado, 
            reclamo.codigo_seguimiento
        ).catch(e => console.error('Error mail admin update:', e));

        // 2. Notificar al CLIENTE (Solo si cargó email)
        if (reclamo.email) {
            this.mailService.sendClientStatusUpdate(
                reclamo.email, 
                reclamo.nombre, 
                reclamo.estado, 
                reclamo.codigo_seguimiento
            ).catch(e => console.error('Error mail cliente:', e));
        }
    }
    
    return actualizado;
  }
  
  // ----------------------------------------------------------------------
  // BITÁCORA DE MENSAJES
  // ----------------------------------------------------------------------
  async agregarMensaje(id: string, texto: string) {
    const reclamo = await this.reclamoRepository.findOne({ where: { id }, relations: ['tramitador'] });
    if (!reclamo) throw new NotFoundException('Reclamo no encontrado');

    const nuevoMensaje: MensajeReclamo = {
      fecha: new Date(),
      texto: texto,
      autor: 'Estudio'
    };

    if (!reclamo.mensajes) {
      reclamo.mensajes = [nuevoMensaje];
    } else {
      reclamo.mensajes.push(nuevoMensaje);
    }

    return this.reclamoRepository.save(reclamo);
  }

  async agregarNotaInterna(id: string, texto: string) {
    const reclamo = await this.reclamoRepository.findOne({ where: { id } });
    if (!reclamo) throw new NotFoundException('Reclamo no encontrado');

    const nuevaNota: MensajeReclamo = {
      fecha: new Date(),
      texto: texto,
      autor: 'Interno'
    };

    if (!reclamo.notas_internas) {
      reclamo.notas_internas = [nuevaNota];
    } else {
      reclamo.notas_internas.push(nuevaNota);
    }

    return this.reclamoRepository.save(reclamo);
  }

  // ----------------------------------------------------------------------
  // DESCARGA DE ARCHIVOS
  // ----------------------------------------------------------------------
  async getArchivoUrl(reclamoId: string, tipoArchivo: string, index: number = 0, user: any) { // 👇 FIX IDOR: Agregamos user
    const mapaColumnas: Record<string, keyof Reclamo> = {
      'dni': 'path_dni',
      'licencia': 'path_licencia',
      'cedula': 'path_cedula',
      'poliza': 'path_poliza',
      'denuncia': 'path_denuncia',
      'fotos': 'path_fotos',
      'medicos': 'path_medicos',
      'representacion': 'path_representacion',
      'honorarios': 'path_honorarios',
      'presupuesto': 'path_presupuesto',
      'cbu': 'path_cbu_archivo',
      'legal': 'path_denuncia_penal',
      'complementaria': 'path_complementaria'
    };

    const columnaBd = mapaColumnas[tipoArchivo];
    if (!columnaBd) throw new BadRequestException(`El tipo de archivo '${tipoArchivo}' no es válido.`);

    // 👇 FIX IDOR: Le sumamos relations para que validarAcceso sepa de quién es el reclamo
    const reclamo = await this.reclamoRepository.findOne({ 
        where: { id: reclamoId },
        relations: ['tramitador', 'usuario_creador'] 
    });
    
    if (!reclamo) throw new NotFoundException(`Reclamo con ID ${reclamoId} no encontrado`);

    // 👇 FIX IDOR: Bloqueamos descarga si es el PDF/Imagen de otro
    this.validarAcceso(reclamo, user);

    const filePath = reclamo[columnaBd] as any;
    
    if (!filePath) throw new NotFoundException(`El archivo no existe para este reclamo.`);

    let targetPath: string;
    
    if (Array.isArray(filePath)) {
        if (filePath.length === 0) throw new NotFoundException(`No hay archivos cargados.`);
        const i = (index >= 0 && index < filePath.length) ? index : 0;
        targetPath = filePath[i]; 
    } else {
        targetPath = filePath as string;
    }

    return this.storageService.createSignedUrl(targetPath);
  }
  
  async findOne(id: string, user: any) { 
    const reclamo = await this.reclamoRepository.findOne({ 
      where: { id },
      relations: ['usuario_creador', 'tramitador'] 
    }); 

    if (!reclamo) throw new NotFoundException('Reclamo no encontrado');
    this.validarAcceso(reclamo, user); 
    
    return reclamo;
  }

  async findAllByUser(userId: string) {
    return this.reclamoRepository.find({
      where: [
        { usuario_creador: { id: userId } },
        { tramitador: { id: userId } }
        // <-- Limpiado: eliminamos la búsqueda de referidos
      ],
      order: { fecha_creacion: 'DESC' },
      relations: ['usuario_creador', 'tramitador'] 
    });
  }

  // ----------------------------------------------------------------------
  // ELIMINAR RECLAMO (LIMPIEZA PROFUNDA DB + CLOUDFLARE R2)
  // ----------------------------------------------------------------------
  async remove(id: string) {
    // 1. Buscamos el reclamo con toda su data
    const reclamo = await this.reclamoRepository.findOne({ where: { id } });
    if (!reclamo) throw new NotFoundException('Reclamo no encontrado en la base de datos.');

    // 2. Recolectamos todas las rutas de los archivos en un solo tacho de basura
    const archivosParaBorrar: string[] = [];

    // Arrays de archivos
    const camposArray: (keyof Reclamo)[] = [
      'path_dni', 'path_licencia', 'path_cedula', 'path_poliza', 'path_denuncia',
      'path_medicos', 'path_presupuesto', 'path_cbu_archivo', 'path_denuncia_penal',
      'path_fotos', 'path_complementaria'
    ];

    camposArray.forEach(campo => {
      const arrayPaths = reclamo[campo] as string[];
      if (arrayPaths && Array.isArray(arrayPaths)) {
        archivosParaBorrar.push(...arrayPaths);
      }
    });

    // Archivos únicos (PDFs generados)
    if (reclamo.path_representacion) archivosParaBorrar.push(reclamo.path_representacion as string);
    if (reclamo.path_honorarios) archivosParaBorrar.push(reclamo.path_honorarios as string);

    // 3. Mandamos a Cloudflare R2 a quemar todo en paralelo
    if (archivosParaBorrar.length > 0) {
      // Promise.allSettled asegura que si un archivo ya no existe, el código siga borrando el resto
      await Promise.allSettled(
        archivosParaBorrar.map(path => this.storageService.deleteFile(path))
      );
    }

    // 4. Finalmente, volamos la fila de Supabase
    await this.reclamoRepository.delete(id);
    
    return { message: 'Reclamo y archivos eliminados correctamente.' };
  }
} 