import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { CompleteOrderCommand, ReopenOrderCommand } from '@furniture-delivery/contracts';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { Roles } from '../auth/public-api';
import { objectPayload } from '../auth/validation';
import { planningId, planningInteger } from '../planning/planning.dto';
import { evidenceOperationKey, evidenceText } from '../evidence/evidence.dto';
import { CompletionService } from './completion.service';
export function completeCommand(value: unknown): CompleteOrderCommand {
  const i = objectPayload(value, ['operationKey', 'expectedVersion', 'reason']);
  return {
    operationKey: evidenceOperationKey(i.operationKey),
    expectedVersion: planningInteger(i.expectedVersion, 'expectedVersion', 1, 2147483646),
    reason: evidenceText(i.reason, 'reason'),
  };
}
export function reopenCommand(value: unknown): ReopenOrderCommand {
  const i = objectPayload(value, [
    'operationKey',
    'expectedVersion',
    'expectedCompletionId',
    'reason',
  ]);
  return {
    ...completeCommand({
      operationKey: i.operationKey,
      expectedVersion: i.expectedVersion,
      reason: i.reason,
    }),
    expectedCompletionId: planningId(i.expectedCompletionId),
  };
}
const actor = (r: AuthenticatedRequest) => ({ id: r.user!.id, sessionId: r.sessionId });
@Controller('orders/:orderId')
@Roles('ADMIN', 'DISPATCHER')
export class CompletionController {
  constructor(@Inject(CompletionService) private readonly completion: CompletionService) {}
  @Get('completion-readiness') readiness(
    @Req() r: AuthenticatedRequest,
    @Param('orderId', ParseUUIDPipe) id: string,
  ) {
    return this.completion.readiness(actor(r), id);
  }
  @Get('completion-history') history(
    @Req() r: AuthenticatedRequest,
    @Param('orderId', ParseUUIDPipe) id: string,
  ) {
    return this.completion.history(actor(r), id);
  }
  @Post('complete') @HttpCode(200) complete(
    @Req() r: AuthenticatedRequest,
    @Param('orderId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.completion.complete(actor(r), id, completeCommand(body));
  }
  @Post('reopen') @HttpCode(200) reopen(
    @Req() r: AuthenticatedRequest,
    @Param('orderId', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.completion.reopen(actor(r), id, reopenCommand(body));
  }
}
