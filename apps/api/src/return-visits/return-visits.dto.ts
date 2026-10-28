import { BadRequestException } from '@nestjs/common';
import type {
  CreateReturnRequestCommand,
  NewReturnTaskInput,
  PlanReturnVisitCommand,
  ResolveReturnRequestCommand,
  ReturnQueueQuery,
} from '@furniture-delivery/contracts';
import { objectPayload } from '../auth/validation';
import { planningId, planningInteger, planningText } from '../planning/planning.dto';
import { resolveLocalWindow } from '../planning/planning-time';
function text(value: unknown, field: string, max: number, required = false): string {
  const result = planningText(value, field, max, required);
  if (result.includes('\0')) throw new BadRequestException(`Invalid ${field}.`);
  return result;
}
const reason = (v: unknown) => text(v, 'reason', 4000, true);
function key(v: unknown): string {
  const parsed = text(v, 'operationKey', 100, true);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(parsed))
    throw new BadRequestException('Invalid operation key.');
  return parsed;
}
function rows(v: unknown, name: string, max = 100): unknown[] {
  if (!Array.isArray(v) || v.length > max)
    throw new BadRequestException(`${name} must be an array of at most ${max} entries.`);
  return v;
}
function unique(ids: string[], name: string): void {
  if (new Set(ids).size !== ids.length) throw new BadRequestException(`Duplicate ${name}.`);
}
export class ReturnVisitsDto {
  static create(value: unknown): CreateReturnRequestCommand {
    const i = objectPayload(value, [
      'operationKey',
      'expectedExecutionVersion',
      'reason',
      'remainingWork',
    ]);
    return {
      operationKey: key(i.operationKey),
      expectedExecutionVersion: planningInteger(
        i.expectedExecutionVersion,
        'expectedExecutionVersion',
        1,
        2147483646,
      ),
      reason: reason(i.reason),
      remainingWork: text(i.remainingWork, 'remainingWork', 4000, true),
    };
  }
  static plan(value: unknown): PlanReturnVisitCommand {
    const i = objectPayload(value, [
      'operationKey',
      'expectedVersion',
      'localStart',
      'durationMinutes',
      'crewIds',
      'carriedTasks',
      'newTasks',
      'itemTargets',
      'reason',
      'notes',
    ]);
    const localStart = text(i.localStart, 'localStart', 16, true),
      durationMinutes = planningInteger(i.durationMinutes, 'durationMinutes', 1, 1440);
    resolveLocalWindow(localStart, durationMinutes);
    const crewIds = rows(i.crewIds, 'crewIds', 50).map(planningId).sort();
    unique(crewIds, 'crews');
    if (!crewIds.length) throw new BadRequestException('A follow-up needs at least one team.');
    const carriedTasks = rows(i.carriedTasks, 'carriedTasks').map((v) => {
      const t = objectPayload(v, ['sourceTaskId', 'crewId']);
      return { sourceTaskId: planningId(t.sourceTaskId), crewId: planningId(t.crewId) };
    });
    unique(
      carriedTasks.map((t) => t.sourceTaskId),
      'source tasks',
    );
    const newTasks = rows(i.newTasks, 'newTasks').map((v): NewReturnTaskInput => {
      const t = objectPayload(v, [
        'crewId',
        'name',
        'description',
        'required',
        'severity',
        'priority',
        'reason',
      ]);
      if (
        typeof t.required !== 'boolean' ||
        !['LOW', 'MEDIUM', 'HIGH'].includes(String(t.severity))
      )
        throw new BadRequestException('Invalid new task flags.');
      return {
        crewId: planningId(t.crewId),
        name: text(t.name, 'name', 200, true),
        description: text(t.description ?? '', 'description', 4000),
        required: t.required,
        severity: t.severity as NewReturnTaskInput['severity'],
        priority: planningInteger(t.priority, 'priority', 0, 9999),
        reason: reason(t.reason),
      };
    });
    const itemTargets = rows(i.itemTargets, 'itemTargets').map((v) => {
      const t = objectPayload(v, ['itemId', 'deliveredQuantity', 'assembledQuantity']);
      return {
        itemId: planningId(t.itemId),
        deliveredQuantity: planningInteger(t.deliveredQuantity, 'deliveredQuantity', 0, 2147483647),
        assembledQuantity: planningInteger(t.assembledQuantity, 'assembledQuantity', 0, 2147483647),
      };
    });
    unique(
      itemTargets.map((t) => t.itemId),
      'item targets',
    );
    return {
      operationKey: key(i.operationKey),
      expectedVersion: planningInteger(i.expectedVersion, 'expectedVersion', 1, 2147483646),
      localStart,
      durationMinutes,
      crewIds,
      carriedTasks,
      newTasks,
      itemTargets,
      reason: reason(i.reason),
      notes: text(i.notes ?? '', 'notes', 4000),
    };
  }
  static resolve(value: unknown): ResolveReturnRequestCommand {
    const i = objectPayload(value, ['operationKey', 'expectedVersion', 'reason']);
    return {
      operationKey: key(i.operationKey),
      expectedVersion: planningInteger(i.expectedVersion, 'expectedVersion', 1, 2147483646),
      reason: reason(i.reason),
    };
  }
  static query(value: unknown): ReturnQueueQuery {
    const i = objectPayload(value, ['status', 'orderId', 'page', 'pageSize']);
    if (i.status !== undefined && !['OPEN', 'PLANNED', 'RESOLVED'].includes(String(i.status)))
      throw new BadRequestException('Invalid return request status.');
    const page = (v: unknown, fallback: number, max: number) => {
      if (v === undefined) return fallback;
      if (typeof v !== 'string' || !/^\d+$/.test(v))
        throw new BadRequestException('Invalid pagination.');
      return planningInteger(Number(v), 'pagination', 1, max);
    };
    return {
      ...(i.status === undefined ? {} : { status: i.status as ReturnQueueQuery['status'] }),
      ...(i.orderId === undefined ? {} : { orderId: planningId(i.orderId) }),
      page: page(i.page, 1, 1000000),
      pageSize: page(i.pageSize, 20, 100),
    };
  }
}
