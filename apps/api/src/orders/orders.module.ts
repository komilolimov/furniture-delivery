import { Module } from '@nestjs/common';
import { DashboardController, OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController, DashboardController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
