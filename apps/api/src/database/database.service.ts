import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';

export const DATABASE_SOURCE = Symbol('DATABASE_SOURCE');

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private initialization: Promise<DataSource> | undefined;

  constructor(@Inject(DATABASE_SOURCE) private readonly dataSource: DataSource) {}

  private async initialize(): Promise<void> {
    if (!this.initialization && this.dataSource.isInitialized) return;
    // A single initialization is shared by concurrent health requests.
    const initialization = (this.initialization ??= this.dataSource.initialize());
    try {
      await initialization;
    } finally {
      if (this.initialization === initialization) this.initialization = undefined;
    }
  }

  async checkConnection(): Promise<void> {
    await this.initialize();
    await this.dataSource.query('SELECT 1');
  }

  async getDataSource(): Promise<DataSource> {
    await this.initialize();
    return this.dataSource;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.initialization?.catch(() => undefined);
    if (this.dataSource.isInitialized) await this.dataSource.destroy();
  }
}
