import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AppConfig } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CrewModule } from './crews/crews.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.forRoot(config),
        AuthModule.forRoot(config.auth),
        HealthModule,
        UsersModule,
        CrewModule,
      ],
    };
  }
}
