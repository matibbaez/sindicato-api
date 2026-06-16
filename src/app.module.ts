import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
// 1. IMPORTAMOS EL SERVICIO DE PDF
import { PdfService } from './common/pdf.service';

// --- Nuestros Módulos ---
import { ReclamosModule } from './reclamos/reclamos.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';

// --- Nuestras Entidades (Moldes) ---
import { Reclamo } from './reclamos/entities/reclamo.entity';
import { User } from './users/entities/user.entity';

@Module({
  imports: [
    // 1. MÓDULO DE CONFIGURACIÓN (.env)
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // 2. MÓDULO DE BASE DE DATOS (TypeORM)
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('DATABASE_URL'), // <-- Usamos la URL directa de Supabase
        entities: [Reclamo, User],
        synchronize: configService.get<string>('DB_SYNC') === 'true', // <-- Esto es lo que crea las tablas
      }),
    }),

    // 3. NUESTROS MÓDULOS DE LÓGICA
    ReclamosModule,
    StorageModule,
    UsersModule,
    AuthModule,
    MailModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    PdfService 
  ],
})
export class AppModule {}