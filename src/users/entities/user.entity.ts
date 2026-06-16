import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Reclamo } from '../../reclamos/entities/reclamo.entity';

export enum UserRole {
  ADMIN = 'Admin',
  TRAMITADOR = 'Tramitador',
  SINDICATO = 'Sindicato' 
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string; 

  @Column()
  nombre!: string; 

  @Column({ unique: true })
  email!: string; 

  @Column({ select: false }) 
  password!: string; 

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.TRAMITADOR, 
  })
  role!: string; 

  @Column({ default: false })
  isApproved!: boolean; 

  @Column({ nullable: true }) 
  dni!: string; 

  @Column({ nullable: true })
  telefono!: string; 

  @Column({ nullable: true })
  matricula!: string; 

  @CreateDateColumn()
  createdAt!: Date; 

  @OneToMany(() => Reclamo, (reclamo) => reclamo.tramitador)
  reclamos_asignados!: Reclamo[]; 
}