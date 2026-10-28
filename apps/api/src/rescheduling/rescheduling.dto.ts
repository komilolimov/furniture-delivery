import { BadRequestException } from '@nestjs/common';
import type {
  ApplyRescheduleCommand,
  EstimateCommand,
  RiskQuery,
  SlotSearchQuery,
} from '@furniture-delivery/contracts';
import { DateTime } from 'luxon';
import { objectPayload } from '../auth/validation';
import { planningId, planningInteger, planningText } from '../planning/planning.dto';
import { BUSINESS_ZONE, localToUtc, validateRange } from '../planning/planning-time';

function text(value: unknown, name: string, max: number): string {
  const result = planningText(value, name, max, true);
  if (result.includes('\0')) throw new BadRequestException(`Invalid ${name}.`);
  return result;
}
function flag(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  throw new BadRequestException(`${name} must be true or false.`);
}
function ids(value: unknown, required: boolean): string[] {
  const values = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(values) || values.length > 10 || (required && !values.length))
    throw new BadRequestException('Select between one and ten distinct teams.');
  const result = values.map(planningId).sort();
  if (new Set(result).size !== result.length) throw new BadRequestException('Duplicate team IDs.');
  return result;
}
function date(value: unknown, name: string): string {
  const result = text(value, name, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result))
    throw new BadRequestException(`${name} must be a Rome date.`);
  localToUtc(`${result}T00:00`);
  return result;
}
export class ReschedulingDto {
  static apply(value: unknown): ApplyRescheduleCommand {
    const input = objectPayload(value, [
      'operationKey',
      'expectedVersion',
      'localStart',
      'durationMinutes',
      'crewIds',
      'reason',
    ]);
    const operationKey = text(input.operationKey, 'operationKey', 100);
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(operationKey))
      throw new BadRequestException('Invalid operationKey.');
    const localStart = text(input.localStart, 'localStart', 16);
    localToUtc(localStart);
    return {
      operationKey,
      expectedVersion: planningInteger(input.expectedVersion, 'expectedVersion', 1, 2147483646),
      localStart,
      durationMinutes: planningInteger(input.durationMinutes, 'durationMinutes', 1, 1440),
      crewIds: ids(input.crewIds, true),
      reason: text(input.reason, 'reason', 1000),
    };
  }
  static estimate(value: unknown): EstimateCommand {
    const input = objectPayload(value, [
      'operationKey',
      'expectedEstimateVersion',
      'localFinish',
      'reason',
    ]);
    const operationKey = text(input.operationKey, 'operationKey', 100);
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(operationKey))
      throw new BadRequestException('Invalid operationKey.');
    const localFinish =
      input.localFinish === null ? null : text(input.localFinish, 'localFinish', 16);
    if (localFinish !== null) localToUtc(localFinish);
    return {
      operationKey,
      expectedEstimateVersion: planningInteger(
        input.expectedEstimateVersion,
        'expectedEstimateVersion',
        1,
        2147483646,
      ),
      localFinish,
      reason: text(input.reason, 'reason', 4000),
    };
  }
  static risks(value: unknown): RiskQuery {
    const input = objectPayload(value, ['from', 'to', 'allTeams', 'crewIds']);
    const from = date(input.from, 'from'),
      to = date(input.to, 'to');
    validateRange(from, to);
    const allTeams = flag(input.allTeams, 'allTeams', false);
    const crewIds = ids(input.crewIds ?? [], !allTeams);
    if (allTeams && crewIds.length)
      throw new BadRequestException('Use allTeams or selected teams.');
    return { from, to, allTeams, crewIds };
  }
  static search(value: unknown): SlotSearchQuery {
    const input = objectPayload(value, [
      'context',
      'orderId',
      'appointmentId',
      'requestId',
      'earliestLocal',
      'from',
      'to',
      'durationMinutes',
      'crewIds',
      'alternativeCrews',
    ]);
    if (input.context !== 'APPOINTMENT' && input.context !== 'RETURN_REQUEST')
      throw new BadRequestException('Invalid search context.');
    const earliestLocal = text(input.earliestLocal, 'earliestLocal', 16);
    localToUtc(earliestLocal);
    const from = date(input.from ?? earliestLocal.slice(0, 10), 'from');
    const to = date(
      input.to ?? DateTime.fromISO(from, { zone: BUSINESS_ZONE }).plus({ days: 14 }).toISODate(),
      'to',
    );
    validateRange(from, to);
    const crewIds = ids(input.crewIds, true),
      alternativeCrews = flag(input.alternativeCrews, 'alternativeCrews', false);
    if (alternativeCrews && crewIds.length !== 1)
      throw new BadRequestException('Alternative teams require one selected team.');
    if (
      input.context === 'APPOINTMENT' &&
      (input.appointmentId === undefined || input.requestId !== undefined)
    )
      throw new BadRequestException('Appointment context requires only appointmentId.');
    if (
      input.context === 'RETURN_REQUEST' &&
      (input.requestId === undefined || input.appointmentId !== undefined)
    )
      throw new BadRequestException('Return context requires only requestId.');
    const duration =
      typeof input.durationMinutes === 'string' && /^\d+$/.test(input.durationMinutes)
        ? Number(input.durationMinutes)
        : input.durationMinutes;
    return {
      context: input.context,
      orderId: planningId(input.orderId),
      ...(input.appointmentId === undefined
        ? {}
        : { appointmentId: planningId(input.appointmentId) }),
      ...(input.requestId === undefined ? {} : { requestId: planningId(input.requestId) }),
      earliestLocal,
      from,
      to,
      durationMinutes: planningInteger(duration, 'durationMinutes', 1, 1440),
      crewIds,
      alternativeCrews,
    };
  }
}
