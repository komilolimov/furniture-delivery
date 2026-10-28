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
  AuthUser,
  DashboardResponse,
  OrderListResponse,
  OrderResponse,
  PaymentResponse,
} from '@furniture-delivery/contracts';
import { CurrentSessionId, CurrentUser, Roles } from '../auth/public-api';
import { OrderDto } from './orders.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@Roles('ADMIN', 'DISPATCHER')
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}
  @Get()
  async list(@Query() query: unknown): Promise<OrderListResponse> {
    return this.orders.list(OrderDto.query(query));
  }
  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<OrderResponse> {
    return { order: await this.orders.detail(id) };
  }
  @Post()
  async create(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<OrderResponse> {
    return { order: await this.orders.create(OrderDto.create(body), user.id, sessionId) };
  }
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<OrderResponse> {
    return { order: await this.orders.update(id, OrderDto.update(body), user.id, sessionId) };
  }
  @Post(':id/payments')
  async payment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<PaymentResponse> {
    return this.orders.recordPayment(id, OrderDto.payment(body), user.id, sessionId);
  }
  @Post(':id/payments/:paymentId/void')
  async void(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentSessionId() sessionId: string,
  ): Promise<PaymentResponse> {
    return this.orders.voidPayment(id, paymentId, OrderDto.void(body).reason, user.id, sessionId);
  }
}
@Controller('dashboard')
@Roles('ADMIN', 'DISPATCHER')
export class DashboardController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}
  @Get()
  async detail(): Promise<DashboardResponse> {
    return this.orders.dashboard();
  }
}
