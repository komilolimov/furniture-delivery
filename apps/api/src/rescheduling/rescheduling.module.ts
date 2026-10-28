import { Module } from '@nestjs/common';
import {
  ApplyRescheduleController,
  CrewEstimateController,
  ReschedulingController,
} from './rescheduling.controller';
import { ReschedulingService } from './rescheduling.service';
import { PlanningModule } from '../planning/planning.module';
@Module({
  imports: [PlanningModule],
  controllers: [ReschedulingController, CrewEstimateController, ApplyRescheduleController],
  providers: [ReschedulingService],
})
export class ReschedulingModule {}
