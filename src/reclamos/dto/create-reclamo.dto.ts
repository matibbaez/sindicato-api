import {
  IsString, IsEmail, IsNotEmpty, MinLength, MaxLength, Matches,
  IsNumberString, IsOptional, IsBooleanString,
} from 'class-validator';

export class CreateReclamoDto {
  
  // --- DATOS OBLIGATORIOS INICIALES ---
  @IsString() @IsNotEmpty() @MinLength(3)
  nombre!: string;

  @IsString() @IsNotEmpty()
  telefono!: string;

  // --- DATOS OPCIONALES A COMPLETAR LUEGO ---
  @IsOptional() @IsNumberString() @MinLength(7) @MaxLength(11)
  dni?: string;

  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsString()
  domicilio_usuario?: string; 

  @IsOptional() @IsString()
  rol_victima?: string; 

  // --- DATOS DEL SINIESTRO / TERCERO ---
  @IsOptional() @IsString() codigo_ref?: string;
  @IsOptional() @IsString() aseguradora_tercero?: string;
  @IsOptional() @IsString() patente_tercero?: string;
  @IsOptional() @IsString() tercero_nombre?: string;       
  @IsOptional() @IsString() tercero_apellido?: string;     
  @IsOptional() @IsString() tercero_dni?: string;          
  @IsOptional() @IsString() tercero_marca_modelo?: string; 

  @IsOptional() @IsString() patente_propia?: string;
  @IsOptional() @IsString() relato_hecho?: string;

  // --- FECHA Y LUGAR ---
  @IsOptional() @IsString() fecha_hecho?: string;
  @IsOptional() @IsString() hora_hecho?: string; 
  @IsOptional() @IsString() lugar_hecho?: string;
  @IsOptional() @IsString() localidad?: string;
  @IsOptional() @IsString() provincia?: string;

  // --- BOOLEANOS ---
  @IsOptional() @IsBooleanString() tiene_seguro?: string; 
  @IsOptional() @IsBooleanString() hizo_denuncia?: string;
  @IsOptional() @IsBooleanString() in_itinere?: string;
  @IsOptional() @IsBooleanString() posee_art?: string;
  
  @IsOptional() @IsBooleanString() sufrio_lesiones?: string;    
  @IsOptional() @IsBooleanString() intervino_policia?: string;  
  @IsOptional() @IsBooleanString() intervino_ambulancia?: string; 

  @IsOptional() @IsString() cbu?: string;
}