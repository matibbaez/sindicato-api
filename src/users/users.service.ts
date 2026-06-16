import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt'; 
import { User, UserRole } from './entities/user.entity';
import { MailService } from 'src/mail/mail.service'; 

@Injectable()
export class UsersService {

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly mailService: MailService
  ) {}

  // CREAR USUARIO (LIMPIADO DE REFERIDOS)
  async create(createUserDto: CreateUserDto): Promise<User> {
    const existe = await this.userRepository.findOne({ where: { email: createUserDto.email } });
    if (existe) throw new BadRequestException('El email ya está registrado.');

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const newUser = this.userRepository.create({
      email: createUserDto.email,
      password: hashedPassword,
      nombre: createUserDto.nombre,
      role: createUserDto.role || UserRole.TRAMITADOR, // <-- Por defecto ahora es Tramitador
      dni: createUserDto.dni,
      telefono: createUserDto.telefono,
      matricula: createUserDto.matricula
      // Eliminamos la asignación de referidoPor
    });

    return this.userRepository.save(newUser);
  }

  async findAll(role?: string, approvedStr?: string) {
    const where: any = {};
    
    if (role) where.role = role;
    if (approvedStr !== undefined) {
        where.isApproved = approvedStr === 'true';
    }

    return this.userRepository.find({ 
      where,
      order: { createdAt: 'DESC' } 
    });
  }

  async approveUser(id: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    user.isApproved = true;
    await this.userRepository.save(user);

    console.log(`✅ Usuario ${user.email} aprobado. Enviando mail...`);
    await this.mailService.sendAccountApproved(user.email, user.nombre);

    return { message: 'Usuario aprobado correctamente' };
  }

  async cambiarMiPassword(userId: string, passwordActual: string, passwordNueva: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'password'] 
    });

    if (!user) throw new NotFoundException('Usuario no encontrado en la base de datos.');
    if (!user.password) throw new BadRequestException('Error de lectura: No se pudo obtener la clave.');

    const esValida = await bcrypt.compare(passwordActual, user.password);
    if (!esValida) throw new BadRequestException('La contraseña actual introducida es incorrecta.');

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(passwordNueva, salt);

    await this.userRepository.save(user);
    return { message: 'Contraseña actualizada correctamente.' };
  }

  findOneByEmail(email: string) {
    return this.userRepository.findOne({ 
      where: { email },
      select: ['id', 'email', 'password', 'nombre', 'role', 'isApproved', 'dni', 'telefono', 'matricula', 'createdAt']
    });
  }

  async cambiarRol(id: string, nuevoRol: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    user.role = nuevoRol;
    return await this.userRepository.save(user);
  }

  async findOne(id: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  update(id: string, updateUserDto: UpdateUserDto) {
    return this.userRepository.update(id, updateUserDto);
  }

  remove(id: string) {
    return this.userRepository.delete(id);
  }
}