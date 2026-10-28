import { BadRequestException } from '@nestjs/common';
import type {
  AssignmentTaskEdit,
  CalendarQuery,
  CreateAppointmentRequest,
  CreateCrewUnavailabilityRequest,
  CreateTaskTemplateRequest,
  PlannedTaskInput,
  TaskSeverity,
  TemplateApplicability,
  UpdateAppointmentRequest,
  UpdateCrewPlanningRequest,
  UpdateCrewUnavailabilityRequest,
  UpdateTaskTemplateRequest,
  WeeklyWorkingWindow,
} from '@furniture-delivery/contracts';
import { objectPayload, uuidValue } from '../auth/validation';
import { localToUtc, resolveLocalWindow, validateRange } from './planning-time';

export function planningText(value: unknown, field: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new BadRequestException(`${field} must contain ${required ? 1 : 0}–${max} characters.`);
  }
  return value.trim();
}
export function planningInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new BadRequestException(`${field} must be an integer between ${min} and ${max}.`);
  }
  return value;
}
function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new BadRequestException(`${field} must be a boolean.`);
  return value;
}
export function planningId(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('Invalid identifier.');
  return uuidValue(value).toLowerCase();
}
function ids(value: unknown, field: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new BadRequestException(`${field} must be an array with at most ${maximum} IDs.`);
  const result = value.map(planningId);
  if (new Set(result).size !== result.length)
    throw new BadRequestException(`${field} must not contain duplicate IDs.`);
  return result.sort();
}
function severity(value: unknown): TaskSeverity {
  if (value !== 'LOW' && value !== 'MEDIUM' && value !== 'HIGH')
    throw new BadRequestException('Invalid severity.');
  return value;
}
function applicability(value: unknown): TemplateApplicability {
  if (value !== 'ALL' && value !== 'DELIVERY_ONLY' && value !== 'DELIVERY_AND_ASSEMBLY')
    throw new BadRequestException('Invalid applicability.');
  return value;
}
function tasksValue(value: unknown): AssignmentTaskEdit[] {
  if (!Array.isArray(value) || value.length > 50)
    throw new BadRequestException('tasks must contain at most 50 assignment edits.');
  const result = value.map((entry): AssignmentTaskEdit => {
    const row = objectPayload(entry, ['assignmentId', 'tasks']);
    if (!Array.isArray(row.tasks) || row.tasks.length > 100)
      throw new BadRequestException('An assignment supports at most 100 planned tasks.');
    const tasks = row.tasks.map((input): PlannedTaskInput => {
      const task = objectPayload(input, ['id', 'templateId', 'severity', 'priority']);
      if ((task.id === undefined) === (task.templateId === undefined))
        throw new BadRequestException('Supply exactly one task ID or template ID.');
      return {
        ...(task.id === undefined
          ? { templateId: planningId(task.templateId) }
          : { id: planningId(task.id) }),
        severity: severity(task.severity),
        priority: planningInteger(task.priority, 'priority', 0, 9999),
      };
    });
    const keys = tasks.map((task) => task.id ?? task.templateId);
    if (new Set(keys).size !== keys.length)
      throw new BadRequestException('Duplicate task identifiers.');
    return { assignmentId: planningId(row.assignmentId), tasks };
  });
  if (new Set(result.map(({ assignmentId }) => assignmentId)).size !== result.length)
    throw new BadRequestException('Duplicate assignment identifiers.');
  return result;
}
function local(value: unknown, field: string): string {
  const result = planningText(value, field, 16, true);
  localToUtc(result);
  return result;
}

export class PlanningDto {
  static create(value: unknown): CreateAppointmentRequest {
    const input = objectPayload(value, [
      'localStart',
      'durationMinutes',
      'crewIds',
      'templateIds',
      'notes',
      'idempotencyKey',
    ]);
    const localStart = local(input.localStart, 'localStart');
    const durationMinutes = planningInteger(input.durationMinutes, 'durationMinutes', 1, 1440);
    resolveLocalWindow(localStart, durationMinutes);
    const idempotencyKey = planningText(input.idempotencyKey, 'idempotencyKey', 100, true);
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey))
      throw new BadRequestException(
        'idempotencyKey must contain 8–100 letters, digits, underscores or hyphens.',
      );
    return {
      localStart,
      durationMinutes,
      crewIds: ids(input.crewIds, 'crewIds', 50),
      templateIds: ids(input.templateIds ?? [], 'templateIds', 100),
      notes: planningText(input.notes ?? '', 'notes', 4000),
      idempotencyKey,
    };
  }
  static update(value: unknown): UpdateAppointmentRequest {
    const input = objectPayload(value, [
      'expectedVersion',
      'localStart',
      'durationMinutes',
      'crewIds',
      'notes',
      'reason',
      'tasks',
    ]);
    if (Object.keys(input).length < 2)
      throw new BadRequestException('At least one appointment change is required.');
    return {
      expectedVersion: planningInteger(input.expectedVersion, 'expectedVersion', 1, 2147483646),
      ...(input.localStart === undefined
        ? {}
        : { localStart: local(input.localStart, 'localStart') }),
      ...(input.durationMinutes === undefined
        ? {}
        : { durationMinutes: planningInteger(input.durationMinutes, 'durationMinutes', 1, 1440) }),
      ...(input.crewIds === undefined ? {} : { crewIds: ids(input.crewIds, 'crewIds', 50) }),
      ...(input.notes === undefined ? {} : { notes: planningText(input.notes, 'notes', 4000) }),
      ...(input.reason === undefined
        ? {}
        : { reason: planningText(input.reason, 'reason', 1000, true) }),
      ...(input.tasks === undefined ? {} : { tasks: tasksValue(input.tasks) }),
    };
  }
  static confirm(value: unknown): { expectedVersion: number } {
    const input = objectPayload(value, ['expectedVersion']);
    return {
      expectedVersion: planningInteger(input.expectedVersion, 'expectedVersion', 1, 2147483646),
    };
  }
  static cancel(value: unknown): { expectedVersion: number; reason: string } {
    const input = objectPayload(value, ['expectedVersion', 'reason']);
    return {
      expectedVersion: planningInteger(input.expectedVersion, 'expectedVersion', 1, 2147483646),
      reason: planningText(input.reason, 'reason', 1000, true),
    };
  }
  static calendar(value: unknown): CalendarQuery {
    const input = objectPayload(value, ['from', 'to', 'allTeams', 'crewIds', 'includeUnassigned']);
    const from = planningText(input.from, 'from', 24, true),
      to = planningText(input.to, 'to', 24, true);
    validateRange(from, to);
    const queryBool = (value: unknown, name: string, fallback?: boolean) => {
      if (value === undefined && fallback !== undefined) return fallback;
      if (value !== 'true' && value !== 'false')
        throw new BadRequestException(`${name} must explicitly be true or false.`);
      return value === 'true';
    };
    const allTeams = queryBool(input.allTeams, 'allTeams');
    const list =
      input.crewIds === undefined || input.crewIds === ''
        ? []
        : typeof input.crewIds === 'string'
          ? input.crewIds.split(',')
          : input.crewIds;
    const crewIds = ids(list, 'crewIds', 50);
    if (allTeams && crewIds.length)
      throw new BadRequestException('Choose All teams or explicit crew IDs, not both.');
    return {
      from,
      to,
      allTeams,
      crewIds,
      includeUnassigned: queryBool(input.includeUnassigned, 'includeUnassigned', true),
    };
  }
  static config(value: unknown): UpdateCrewPlanningRequest {
    const input = objectPayload(value, ['expectedVersion', 'weeklyWindows', 'travelBufferMinutes']);
    if (!Array.isArray(input.weeklyWindows) || input.weeklyWindows.length > 49)
      throw new BadRequestException('weeklyWindows supports at most 49 windows.');
    const weeklyWindows = input.weeklyWindows
      .map((value): WeeklyWorkingWindow => {
        const row = objectPayload(value, ['weekday', 'startTime', 'endTime']);
        const weekday = planningInteger(row.weekday, 'weekday', 1, 7);
        const startTime = planningText(row.startTime, 'startTime', 5, true),
          endTime = planningText(row.endTime, 'endTime', 5, true);
        if (
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
          startTime >= endTime
        )
          throw new BadRequestException(
            'Working windows need valid HH:mm start < end without crossing midnight.',
          );
        return { weekday, startTime, endTime };
      })
      .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
    for (let index = 1; index < weeklyWindows.length; index++) {
      const previous = weeklyWindows[index - 1]!,
        next = weeklyWindows[index]!;
      if (previous.weekday === next.weekday && previous.endTime > next.startTime)
        throw new BadRequestException('Working windows must not overlap.');
    }
    return {
      expectedVersion: planningInteger(input.expectedVersion, 'expectedVersion', 0, 2147483646),
      weeklyWindows,
      travelBufferMinutes: planningInteger(
        input.travelBufferMinutes,
        'travelBufferMinutes',
        0,
        180,
      ),
    };
  }
  static unavailable(value: unknown): CreateCrewUnavailabilityRequest {
    const input = objectPayload(value, ['localStart', 'localEnd', 'reason']);
    const localStart = local(input.localStart, 'localStart'),
      localEnd = local(input.localEnd, 'localEnd');
    if (localToUtc(localEnd) <= localToUtc(localStart))
      throw new BadRequestException('Unavailability start must precede end.');
    return { localStart, localEnd, reason: planningText(input.reason, 'reason', 1000, true) };
  }
  static unavailableUpdate(value: unknown): UpdateCrewUnavailabilityRequest {
    const input = objectPayload(value, ['localStart', 'localEnd', 'reason', 'active']);
    if (!Object.keys(input).length)
      throw new BadRequestException('At least one availability change is required.');
    return {
      ...(input.localStart === undefined
        ? {}
        : { localStart: local(input.localStart, 'localStart') }),
      ...(input.localEnd === undefined ? {} : { localEnd: local(input.localEnd, 'localEnd') }),
      ...(input.reason === undefined
        ? {}
        : { reason: planningText(input.reason, 'reason', 1000, true) }),
      ...(input.active === undefined ? {} : { active: bool(input.active, 'active') }),
    };
  }
  static template(value: unknown): CreateTaskTemplateRequest {
    const input = objectPayload(value, [
      'code',
      'name',
      'description',
      'active',
      'required',
      'severity',
      'defaultPriority',
      'applicability',
    ]);
    const code = planningText(input.code, 'code', 64, true);
    if (!/^[A-Z][A-Z0-9_-]{2,63}$/.test(code))
      throw new BadRequestException(
        'Template code must contain 3–64 uppercase letters, digits, underscores or hyphens.',
      );
    return {
      code,
      name: planningText(input.name, 'name', 200, true),
      description: planningText(input.description ?? '', 'description', 4000),
      active: bool(input.active ?? true, 'active'),
      required: bool(input.required ?? false, 'required'),
      severity: severity(input.severity ?? 'MEDIUM'),
      defaultPriority: planningInteger(input.defaultPriority ?? 0, 'defaultPriority', 0, 9999),
      applicability: applicability(input.applicability ?? 'ALL'),
    };
  }
  static templateUpdate(value: unknown): UpdateTaskTemplateRequest {
    const input = objectPayload(value, [
      'name',
      'description',
      'active',
      'required',
      'severity',
      'defaultPriority',
      'applicability',
    ]);
    if (!Object.keys(input).length)
      throw new BadRequestException('At least one template change is required.');
    return {
      ...(input.name === undefined ? {} : { name: planningText(input.name, 'name', 200, true) }),
      ...(input.description === undefined
        ? {}
        : { description: planningText(input.description, 'description', 4000) }),
      ...(input.active === undefined ? {} : { active: bool(input.active, 'active') }),
      ...(input.required === undefined ? {} : { required: bool(input.required, 'required') }),
      ...(input.severity === undefined ? {} : { severity: severity(input.severity) }),
      ...(input.defaultPriority === undefined
        ? {}
        : { defaultPriority: planningInteger(input.defaultPriority, 'defaultPriority', 0, 9999) }),
      ...(input.applicability === undefined
        ? {}
        : { applicability: applicability(input.applicability) }),
    };
  }
}
