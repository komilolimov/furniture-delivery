import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';

export const BUSINESS_ZONE = 'Europe/Rome';
export interface WorkingWindow {
  weekday: number;
  startTime: string;
  endTime: string;
}

function invalidTime(message: string): never {
  throw new BadRequestException({ code: 'INVALID_LOCAL_TIME', message });
}

/** Reject both normalized DST gaps and the two possible offsets of a DST fold. */
export function localToUtc(local: string): Date {
  if (typeof local !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) {
    return invalidTime('Use local date and time YYYY-MM-DDTHH:mm in Europe/Rome.');
  }
  const value = DateTime.fromISO(local, { zone: BUSINESS_ZONE });
  if (
    !value.isValid ||
    value.toFormat("yyyy-MM-dd'T'HH:mm") !== local ||
    value.year < 1900 ||
    value.year > 9999
  ) {
    return invalidTime(
      'This local time does not exist or is invalid in Europe/Rome. Choose another time.',
    );
  }
  if (value.getPossibleOffsets().length !== 1) {
    return invalidTime('This local time is ambiguous in Europe/Rome. Choose another time.');
  }
  return value.toUTC().toJSDate();
}

export function resolveLocalWindow(localStart: string, durationMinutes: number) {
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
    throw new BadRequestException('durationMinutes must be an integer between 1 and 1440.');
  }
  const plannedStartAt = localToUtc(localStart);
  const plannedEndAt = new Date(plannedStartAt.getTime() + durationMinutes * 60000);
  const start = DateTime.fromJSDate(plannedStartAt, { zone: BUSINESS_ZONE });
  const end = DateTime.fromJSDate(plannedEndAt, { zone: BUSINESS_ZONE });
  if (!start.hasSame(end, 'day')) {
    throw new BadRequestException({
      code: 'INVALID_LOCAL_WINDOW',
      message:
        'A visit must fit within one local date in Europe/Rome. Split longer work into several visits.',
    });
  }
  return { plannedStartAt, plannedEndAt, durationMinutes };
}

export function reserveEnd(end: Date, travelBufferMinutes: number): Date {
  if (
    !Number.isInteger(travelBufferMinutes) ||
    travelBufferMinutes < 0 ||
    travelBufferMinutes > 180
  ) {
    throw new BadRequestException('travelBufferMinutes must be an integer between 0 and 180.');
  }
  return new Date(end.getTime() + travelBufferMinutes * 60000);
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function fitsWindow(
  start: Date,
  reservedEnd: Date,
  windows: readonly WorkingWindow[],
): boolean {
  const local = DateTime.fromJSDate(start, { zone: BUSINESS_ZONE });
  const end = DateTime.fromJSDate(reservedEnd, { zone: BUSINESS_ZONE });
  if (!local.isValid || !end.isValid || reservedEnd <= start || !local.hasSame(end, 'day'))
    return false;
  return windows.some((window) => {
    if (window.weekday !== local.weekday) return false;
    try {
      const date = local.toISODate();
      const from = localToUtc(`${date}T${window.startTime}`);
      const to = localToUtc(`${date}T${window.endTime}`);
      return from <= start && reservedEnd <= to;
    } catch {
      // A DST gap/fold in a configured window never silently authorizes a reservation.
      return false;
    }
  });
}

function rangePoint(value: string): DateTime {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return DateTime.fromJSDate(localToUtc(`${value}T00:00`), { zone: BUSINESS_ZONE });
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new BadRequestException(
      'Range boundaries must be Rome YYYY-MM-DD dates or ISO UTC instants ending in Z.',
    );
  }
  const date = DateTime.fromISO(value, { zone: 'utc' });
  if (
    !date.isValid ||
    date.year < 1900 ||
    date.year > 9999 ||
    date.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss") !== value.slice(0, 19)
  )
    throw new BadRequestException('Invalid range boundary.');
  return date.setZone(BUSINESS_ZONE);
}

export function validateRange(fromValue: string, toValue: string): { from: Date; to: Date } {
  const from = rangePoint(fromValue),
    to = rangePoint(toValue);
  if (to <= from || to > from.plus({ days: 42 })) {
    throw new BadRequestException(
      'Range must have from < to and cover at most 42 local days in Europe/Rome.',
    );
  }
  return { from: from.toUTC().toJSDate(), to: to.toUTC().toJSDate() };
}
