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
import { ReschedulingService } from './rescheduling.service';
import { ReschedulingDto } from './rescheduling.dto';
function actor(request: AuthenticatedRequest) {
  return { id: request.user!.id, sessionId: request.sessionId };
}
@Controller('planning')
@Roles('ADMIN', 'DISPATCHER')
export class ReschedulingController {
  constructor(@Inject(ReschedulingService) private readonly service: ReschedulingService) {}
  @Get('risks') risks(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.service.risks(actor(request), ReschedulingDto.risks(query));
  }
  @Get('available-windows') search(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.service.search(actor(request), ReschedulingDto.search(query));
  }
  @Post('assignments/:id/estimate') @HttpCode(200) estimate(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.estimate(actor(request), id, ReschedulingDto.estimate(body), false);
  }
}
@Controller('crew/assignments')
@Roles('CREW_MEMBER')
export class CrewEstimateController {
  constructor(@Inject(ReschedulingService) private readonly service: ReschedulingService) {}
  @Post(':id/estimate') @HttpCode(200) estimate(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.estimate(actor(request), id, ReschedulingDto.estimate(body), true);
  }
}

@Controller('orders/:orderId/appointments')
@Roles('ADMIN', 'DISPATCHER')
export class ApplyRescheduleController {
  constructor(@Inject(ReschedulingService) private readonly service: ReschedulingService) {}
  @Post(':id/reschedule') @HttpCode(200) apply(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.apply(actor(request), orderId, id, ReschedulingDto.apply(body));
  }
}
