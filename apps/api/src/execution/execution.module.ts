import { Module } from '@nestjs/common';
import { ExecutionService } from './execution.service';
import { CrewExecutionController, OrderExecutionController } from './execution.controller';
@Module({
  controllers: [CrewExecutionController, OrderExecutionController],
  providers: [ExecutionService],
  exports: [ExecutionService],
})
export class ExecutionModule {}
