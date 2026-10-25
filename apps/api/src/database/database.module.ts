import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../config/environment';
import { createDataSource } from './data-source';
import { DATABASE_SOURCE, DatabaseService } from './database.service';

@Module({})
export class DatabaseModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        { provide: DATABASE_SOURCE, useFactory: () => createDataSource(config) },
        DatabaseService,
      ],
      exports: [DatabaseService],
    };
  }
}
