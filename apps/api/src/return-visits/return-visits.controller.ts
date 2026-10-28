import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Roles } from '../auth/public-api';
import { ReturnVisitsDto } from './return-visits.dto';
import { ReturnVisitsService } from './return-visits.service';
const actor = (r: AuthenticatedRequest) => ({ id: r.user!.id, sessionId: r.sessionId });
@Controller('backoffice')
@Roles('ADMIN', 'DISPATCHER')
export class ReturnVisitsController {
  constructor(@Inject(ReturnVisitsService) private readonly returns: ReturnVisitsService) {}
  @Get('return-requests') list(@Req() r: AuthenticatedRequest, @Query() q: unknown) {
    return this.returns.list(actor(r), ReturnVisitsDto.query(q));
  }
  @Get('return-requests/:id') detail(
    @Req() r: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.returns.detail(actor(r), id);
  }
  @Post('assignments/:id/return-request') @HttpCode(200) create(
    @Req() r: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.returns.create(actor(r), id, ReturnVisitsDto.create(b));
  }
  @Post('return-requests/:id/plan') @HttpCode(200) plan(
    @Req() r: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.returns.plan(actor(r), id, ReturnVisitsDto.plan(b));
  }
  @Post('return-requests/:id/resolve') @HttpCode(200) resolve(
    @Req() r: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.returns.resolve(actor(r), id, ReturnVisitsDto.resolve(b));
  }
}
