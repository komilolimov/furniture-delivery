import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type {
  AppointmentListResponse,
  AppointmentResponse,
  AuthUser,
  CalendarResponse,
  CrewAvailabilityResponse,
  TaskTemplateListResponse,
  TaskTemplateResponse,
} from '@furniture-delivery/contracts';
import { CurrentSessionId, CurrentUser, Roles } from '../auth/public-api';
import { PlanningDto } from './planning.dto';
import { PlanningService } from './planning.service';
import { CrewAvailabilityService } from './crew-availability.service';
import { TaskTemplatesService } from './task-templates.service';

@Controller('orders/:orderId/appointments')
@Roles('ADMIN', 'DISPATCHER')
export class AppointmentsController {
  constructor(@Inject(PlanningService) private readonly planning: PlanningService) {}
  @Get()
  list(@Param('orderId', ParseUUIDPipe) orderId: string): Promise<AppointmentListResponse> {
    return this.planning.list(orderId);
  }
  @Post()
  create(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<AppointmentResponse> {
    return this.planning.create(orderId, PlanningDto.create(body), actor.id, sessionId);
  }
  @Get(':id')
  detail(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AppointmentResponse> {
    return this.planning.detail(orderId, id);
  }
  @Patch(':id')
  update(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<AppointmentResponse> {
    return this.planning.update(orderId, id, PlanningDto.update(body), actor.id, sessionId);
  }
  @Post(':id/confirm')
  confirm(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<AppointmentResponse> {
    return this.planning.confirm(
      orderId,
      id,
      PlanningDto.confirm(body).expectedVersion,
      actor.id,
      sessionId,
    );
  }
  @Post(':id/cancel')
  cancel(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<AppointmentResponse> {
    const input = PlanningDto.cancel(body);
    return this.planning.cancel(
      orderId,
      id,
      input.expectedVersion,
      input.reason,
      actor.id,
      sessionId,
    );
  }
}
@Controller('planning')
@Roles('ADMIN', 'DISPATCHER')
export class PlanningController {
  constructor(@Inject(PlanningService) private readonly planning: PlanningService) {}
  @Get('calendar')
  calendar(@Query() query: unknown): Promise<CalendarResponse> {
    return this.planning.calendar(PlanningDto.calendar(query));
  }
}
@Controller('crews/:crewId')
@Roles('ADMIN', 'DISPATCHER')
export class CrewAvailabilityController {
  constructor(
    @Inject(CrewAvailabilityService) private readonly availability: CrewAvailabilityService,
  ) {}
  @Get('planning')
  detail(@Param('crewId', ParseUUIDPipe) crewId: string): Promise<CrewAvailabilityResponse> {
    return this.availability.get(crewId);
  }
  @Patch('planning')
  update(
    @Param('crewId', ParseUUIDPipe) crewId: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<CrewAvailabilityResponse> {
    return this.availability.updateConfig(crewId, PlanningDto.config(body), actor.id, sessionId);
  }
  @Post('unavailability')
  createInterval(
    @Param('crewId', ParseUUIDPipe) crewId: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<CrewAvailabilityResponse> {
    return this.availability.createUnavailability(
      crewId,
      PlanningDto.unavailable(body),
      actor.id,
      sessionId,
    );
  }
  @Patch('unavailability/:id')
  updateInterval(
    @Param('crewId', ParseUUIDPipe) crewId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<CrewAvailabilityResponse> {
    return this.availability.updateUnavailability(
      crewId,
      id,
      PlanningDto.unavailableUpdate(body),
      actor.id,
      sessionId,
    );
  }
}
@Controller('task-templates')
@Roles('ADMIN', 'DISPATCHER')
export class TaskTemplatesController {
  constructor(@Inject(TaskTemplatesService) private readonly templates: TaskTemplatesService) {}
  @Get()
  list(): Promise<TaskTemplateListResponse> {
    return this.templates.list();
  }
  @Post()
  create(
    @Body() body: unknown,
    @CurrentUser() actor: AuthUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<TaskTemplateResponse> {
    return this.templates.create(PlanningDto.template(body), actor.id, sessionId);
  }
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<TaskTemplateResponse> {
    return this.templates.update(id, PlanningDto.templateUpdate(body), actor.id, sessionId);
  }
}
