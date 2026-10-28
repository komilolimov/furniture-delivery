import { BadRequestException } from '@nestjs/common';
import type {
  CrewAssignmentQuery,
  DepartCommand,
  ExecutionCommand,
  FinishCommand,
  FulfillmentCommand,
  TaskResultCommand,
} from '@furniture-delivery/contracts';
import { objectPayload } from '../auth/validation';
import { integer } from '../orders/orders.dto';
function text(value: unknown, field: string, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    value.trim().length > 4000 ||
    (required && !value.trim())
  )
    throw new BadRequestException(`Invalid ${field}.`);
  return value.trim() || undefined;
}
function key(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(value))
    throw new BadRequestException(
      'operationKey must contain 8–100 letters, digits, underscores or hyphens.',
    );
  return value;
}
const version = (v: unknown, name: string) => integer(v, name, 1, 2147483646);
export class ExecutionDto {
  static command(value: unknown): ExecutionCommand {
    const r = objectPayload(value, ['operationKey', 'expectedExecutionVersion']);
    return {
      operationKey: key(r.operationKey),
      expectedExecutionVersion: version(r.expectedExecutionVersion, 'expectedExecutionVersion'),
    };
  }
  static depart(value: unknown): DepartCommand {
    const r = objectPayload(value, [
      'operationKey',
      'expectedExecutionVersion',
      'expectedAppointmentVersion',
    ]);
    return {
      operationKey: key(r.operationKey),
      expectedExecutionVersion: version(r.expectedExecutionVersion, 'expectedExecutionVersion'),
      expectedAppointmentVersion: version(
        r.expectedAppointmentVersion,
        'expectedAppointmentVersion',
      ),
    };
  }
  static task(value: unknown): TaskResultCommand {
    const r = objectPayload(value, [
      'operationKey',
      'expectedTaskVersion',
      'resultStatus',
      'reason',
    ]);
    if (r.resultStatus !== 'PENDING' && r.resultStatus !== 'DONE' && r.resultStatus !== 'SKIPPED')
      throw new BadRequestException('Invalid resultStatus.');
    return {
      operationKey: key(r.operationKey),
      expectedTaskVersion: version(r.expectedTaskVersion, 'expectedTaskVersion'),
      resultStatus: r.resultStatus,
      reason: text(r.reason, 'reason'),
    };
  }
  static fulfillment(value: unknown): FulfillmentCommand {
    const r = objectPayload(value, [
      'operationKey',
      'expectedFulfillmentVersion',
      'deliveredQuantity',
      'assembledQuantity',
      'reason',
    ]);
    return {
      operationKey: key(r.operationKey),
      expectedFulfillmentVersion: version(
        r.expectedFulfillmentVersion,
        'expectedFulfillmentVersion',
      ),
      deliveredQuantity: integer(r.deliveredQuantity, 'deliveredQuantity', 0, 10000),
      assembledQuantity: integer(r.assembledQuantity, 'assembledQuantity', 0, 10000),
      reason: text(r.reason, 'reason'),
    };
  }
  static finish(value: unknown): FinishCommand {
    const r = objectPayload(value, [
      'operationKey',
      'expectedExecutionVersion',
      'outcome',
      'summary',
      'reason',
      'remainingWork',
      'returnVisitRequired',
      'returnReason',
    ]);
    if (r.outcome !== 'COMPLETED' && r.outcome !== 'PARTIALLY_COMPLETED' && r.outcome !== 'BLOCKED')
      throw new BadRequestException('Invalid outcome.');
    if (typeof r.returnVisitRequired !== 'boolean')
      throw new BadRequestException('returnVisitRequired must be a boolean.');
    const input: FinishCommand = {
      operationKey: key(r.operationKey),
      expectedExecutionVersion: version(r.expectedExecutionVersion, 'expectedExecutionVersion'),
      outcome: r.outcome,
      summary: text(r.summary, 'summary', true)!,
      reason: text(r.reason, 'reason'),
      remainingWork: text(r.remainingWork, 'remainingWork'),
      returnVisitRequired: r.returnVisitRequired,
      returnReason: text(r.returnReason, 'returnReason'),
    };
    if (input.outcome !== 'COMPLETED' && (!input.reason || !input.remainingWork))
      throw new BadRequestException(
        'Reason and remainingWork are required for a partial or blocked outcome.',
      );
    if (input.returnVisitRequired && (!input.returnReason || !input.remainingWork))
      throw new BadRequestException('A return visit requires returnReason and remainingWork.');
    return input;
  }
  static query(value: unknown): CrewAssignmentQuery {
    const r = objectPayload(value, ['view', 'page', 'pageSize']);
    const view = r.view ?? 'today';
    if (view !== 'today' && view !== 'upcoming' && view !== 'open' && view !== 'completed')
      throw new BadRequestException('Invalid crew view.');
    const number = (n: string, fallback: number, max: number) =>
      r[n] === undefined
        ? fallback
        : typeof r[n] === 'string' && /^[1-9]\d*$/.test(r[n])
          ? integer(Number(r[n]), n, 1, max)
          : (() => {
              throw new BadRequestException(`Invalid ${n}.`);
            })();
    return { view, page: number('page', 1, 1000000), pageSize: number('pageSize', 20, 100) };
  }
}
