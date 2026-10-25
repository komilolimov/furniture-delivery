import { Inject, Injectable } from '@nestjs/common';
import type { HealthResponse } from '@furniture-delivery/contracts';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class HealthService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async check(): Promise<HealthResponse> {
    try {
      await this.database.checkConnection();
      return { status: 'ok', api: 'up', database: 'up', checkedAt: new Date().toISOString() };
    } catch {
      return { status: 'error', api: 'up', database: 'down', checkedAt: new Date().toISOString() };
    }
  }
}
