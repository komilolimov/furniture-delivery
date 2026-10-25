import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { AUTH_CONFIG } from './auth.types';
import type { AuthConfig } from './auth.types';
import { LoginRateLimiter } from './login-rate-limiter';

@Module({})
export class AuthModule {
  static forRoot(config: AuthConfig): DynamicModule {
    return {
      module: AuthModule,
      global: true,
      controllers: [AuthController],
      providers: [
        { provide: AUTH_CONFIG, useValue: config },
        AuthService,
        LoginRateLimiter,
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [AuthService],
    };
  }
}
