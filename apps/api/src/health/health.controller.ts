import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import type { HealthResponse } from '@furniture-delivery/contracts';
import type { Response } from 'express';
import { HealthService } from './health.service';
import { Public } from '../auth/public-api';

@Controller('health')
@Public()
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async getHealth(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    const result = await this.health.check();
    response.status(result.status === 'ok' ? 200 : 503);
    return result;
  }
}
