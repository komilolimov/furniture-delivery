import { Controller, Get, Inject, Module, Req, Res } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Roles } from '../auth/public-api';
import { RealtimeHub, REALTIME_ORIGIN } from './realtime-hub';
@Controller('realtime')
@Roles('ADMIN', 'DISPATCHER', 'CREW_MEMBER')
class RealtimeController {
  constructor(@Inject(RealtimeHub) private readonly hub: RealtimeHub) {}
  @Get('events') events(@Req() request: AuthenticatedRequest, @Res() response: Response) {
    return this.hub.connect(
      { id: request.user!.id, sessionId: request.sessionId },
      request,
      response,
    );
  }
}
@Module({})
export class RealtimeModule {
  static forRoot(webOrigin: string): DynamicModule {
    return {
      module: RealtimeModule,
      providers: [{ provide: REALTIME_ORIGIN, useValue: webOrigin }, RealtimeHub],
      controllers: [RealtimeController],
      exports: [RealtimeHub],
    };
  }
}
