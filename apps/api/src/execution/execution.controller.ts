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
import { ExecutionDto } from './execution.dto';
import { ExecutionService } from './execution.service';
function actor(request: AuthenticatedRequest) {
  return { id: request.user!.id, sessionId: request.sessionId };
}
@Controller('crew/assignments')
@Roles('CREW_MEMBER')
export class CrewExecutionController {
  constructor(@Inject(ExecutionService) private readonly execution: ExecutionService) {}
  @Get() list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.execution.list(actor(request), ExecutionDto.query(query));
  }
  @Get(':id') detail(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.execution.detail(actor(request), id);
  }
  @Post(':id/actions/depart') @HttpCode(200) depart(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.execution.action(actor(request), id, 'DEPART', ExecutionDto.depart(body));
  }
  @Post(':id/actions/arrive') @HttpCode(200) arrive(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.execution.action(actor(request), id, 'ARRIVE', ExecutionDto.command(body));
  }
  @Post(':id/actions/start') @HttpCode(200) start(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.execution.action(actor(request), id, 'START', ExecutionDto.command(body));
  }
  @Post(':id/actions/finish') @HttpCode(200) finish(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.execution.finish(actor(request), id, ExecutionDto.finish(body));
  }
  @Post(':id/tasks/:taskId/result') @HttpCode(200) task(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() body: unknown,
  ) {
    return this.execution.taskResult(actor(request), id, taskId, ExecutionDto.task(body));
  }
  @Post(':id/items/:itemId/fulfillment') @HttpCode(200) fulfillment(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: unknown,
  ) {
    return this.execution.fulfillment(actor(request), id, itemId, ExecutionDto.fulfillment(body));
  }
}
@Controller('orders/:orderId/execution')
@Roles('ADMIN', 'DISPATCHER')
export class OrderExecutionController {
  constructor(@Inject(ExecutionService) private readonly execution: ExecutionService) {}
  @Get() detail(
    @Req() request: AuthenticatedRequest,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.execution.orderExecution(actor(request), orderId);
  }
}
