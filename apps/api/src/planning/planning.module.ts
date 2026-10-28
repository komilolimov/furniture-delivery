import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import {
  AppointmentsController,
  CrewAvailabilityController,
  PlanningController,
  TaskTemplatesController,
} from './planning.controller';
import { PlanningService } from './planning.service';
import { CrewAvailabilityService } from './crew-availability.service';
import { TaskTemplatesService } from './task-templates.service';

@Module({
  imports: [OrdersModule],
  controllers: [
    AppointmentsController,
    PlanningController,
    CrewAvailabilityController,
    TaskTemplatesController,
  ],
  providers: [PlanningService, CrewAvailabilityService, TaskTemplatesService],
  exports: [PlanningService],
})
export class PlanningModule {}
