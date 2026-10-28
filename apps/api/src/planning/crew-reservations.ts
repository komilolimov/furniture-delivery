import type {
  ExecutionStatus,
  PlanningAttention,
  WeeklyWorkingWindow,
} from '@furniture-delivery/contracts';
import type { EntityManager } from 'typeorm';
import { Crew } from '../crews/crew.entity';
import { Order } from '../orders/order.entity';
import { Appointment } from './appointment.entity';
import { CrewAssignment } from './crew-assignment.entity';
import { CrewPlanningConfig } from './crew-planning-config.entity';
import { CrewUnavailability } from './crew-unavailability.entity';
import { defaultWorkingWindows } from './planning-defaults';
import { fitsWindow, overlaps, reserveEnd } from './planning-time';

export type ReservationBasis = 'PLAN' | 'ESTIMATE' | 'ACTUAL' | 'UNKNOWN';
export interface ReservedAssignment {
  appointmentId: string;
  assignmentId: string;
  orderId: string;
  orderNumber: string;
  crewId: string;
  plannedStartAt: Date;
  plannedEndAt: Date;
  travelBufferMinutes: number;
  executionStatus: ExecutionStatus;
  departedAt: Date | null;
  estimatedFinishAt: Date | null;
  actualEndAt: Date | null;
}
export interface ReservationRelease {
  basis: ReservationBasis;
  releaseAt: Date | null;
  message: string;
}
export interface CrewReservationState {
  crew: Crew;
  weeklyWindows: readonly WeeklyWorkingWindow[];
  travelBufferMinutes: number;
  absences: { startAt: Date; endAt: Date }[];
  reservations: ReservedAssignment[];
}
export const activeReservation = (status: ExecutionStatus): boolean =>
  ['ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS'].includes(status);

/** Early departure occupies the team now without rewriting its promised customer window. */
export function startForReservation(row: ReservedAssignment): Date {
  return activeReservation(row.executionStatus) &&
    row.departedAt &&
    row.departedAt < row.plannedStartAt
    ? row.departedAt
    : row.plannedStartAt;
}

/** A forecast never releases a promised plan early. Unknown is deliberately not a far-future date. */
export function releaseForReservation(row: ReservedAssignment, now: Date): ReservationRelease {
  if (activeReservation(row.executionStatus)) {
    if (row.estimatedFinishAt && row.estimatedFinishAt > now)
      return {
        basis: 'ESTIMATE',
        releaseAt: reserveEnd(
          new Date(Math.max(+row.plannedEndAt, +row.estimatedFinishAt)),
          row.travelBufferMinutes,
        ),
        message: 'Based on the current team estimate; this is a forecast, not a guarantee.',
      };
    if (now > row.plannedEndAt)
      return {
        basis: 'UNKNOWN',
        releaseAt: null,
        message:
          'Active work is past its plan without a current estimate. Update the estimate or choose another team.',
      };
    return {
      basis: 'PLAN',
      releaseAt: reserveEnd(row.plannedEndAt, row.travelBufferMinutes),
      message: row.estimatedFinishAt
        ? 'The team estimate is stale; the planned end is still in the future.'
        : 'Based on the plan; the team has not supplied an estimate.',
    };
  }
  if (row.executionStatus !== 'NOT_STARTED' && row.actualEndAt)
    return {
      basis: 'ACTUAL',
      releaseAt: reserveEnd(
        new Date(Math.max(+row.plannedEndAt, +row.actualEndAt)),
        row.travelBufferMinutes,
      ),
      message: 'Based on actual completion, preserving the original planned reserve.',
    };
  return {
    basis: 'PLAN',
    releaseAt: reserveEnd(row.plannedEndAt, row.travelBufferMinutes),
    message: 'Based on the reserved plan.',
  };
}

/** Shared by ordinary M4 writes, attention reads and M6 search; writers call after the Crew lock. */
export async function readCrewReservationState(
  manager: EntityManager,
  crew: Crew,
  from: Date,
  to: Date,
  excludeAppointmentId?: string,
): Promise<CrewReservationState> {
  const config = await manager.getRepository(CrewPlanningConfig).findOneBy({ crewId: crew.id });
  const absences = await manager
    .getRepository(CrewUnavailability)
    .createQueryBuilder('absence')
    .where(
      'absence.crewId = :crewId AND absence.active = true AND absence.startAt < :to AND absence.endAt > :from',
      { crewId: crew.id, from, to },
    )
    .getMany();
  const query = manager
    .getRepository(CrewAssignment)
    .createQueryBuilder('a')
    .innerJoin(Appointment, 'v', 'v.id = a.appointmentId')
    .innerJoin(Order, 'o', 'o.id = v.orderId')
    .select('v.id', 'appointmentId')
    .addSelect('a.id', 'assignmentId')
    .addSelect('v.orderId', 'orderId')
    .addSelect('o.number', 'orderNumber')
    .addSelect('a.crewId', 'crewId')
    .addSelect('v.plannedStartAt', 'plannedStartAt')
    .addSelect('v.plannedEndAt', 'plannedEndAt')
    .addSelect('a.travelBufferMinutes', 'travelBufferMinutes')
    .addSelect('a.executionStatus', 'executionStatus')
    .addSelect('a.departedAt', 'departedAt')
    .addSelect('a.estimatedFinishAt', 'estimatedFinishAt')
    .addSelect('a.actualEndAt', 'actualEndAt')
    .where("a.crewId = :crewId AND a.status = 'ASSIGNED' AND v.status = 'SCHEDULED'", {
      crewId: crew.id,
    })
    .andWhere(
      "(v.plannedStartAt < :to OR (a.executionStatus IN ('ON_THE_WAY','ARRIVED','IN_PROGRESS') AND a.departedAt < :to))",
      { to },
    )
    .andWhere(
      "(v.plannedEndAt > :earliest OR a.actualEndAt > :earliest OR a.estimatedFinishAt > :earliest OR a.executionStatus IN ('ON_THE_WAY','ARRIVED','IN_PROGRESS'))",
      { earliest: new Date(+from - 180 * 60000) },
    )
    .orderBy('v.plannedStartAt', 'ASC')
    .addOrderBy('a.id', 'ASC');
  if (excludeAppointmentId)
    query.andWhere('v.id <> :excludeAppointmentId', { excludeAppointmentId });
  const raw = await query.getRawMany<ReservedAssignment>();
  const reservations = raw.map((row) => ({
    ...row,
    plannedStartAt: new Date(row.plannedStartAt),
    plannedEndAt: new Date(row.plannedEndAt),
    actualEndAt: row.actualEndAt ? new Date(row.actualEndAt) : null,
    departedAt: row.departedAt ? new Date(row.departedAt) : null,
    estimatedFinishAt: row.estimatedFinishAt ? new Date(row.estimatedFinishAt) : null,
    travelBufferMinutes: Number(row.travelBufferMinutes),
  }));
  return {
    crew,
    weeklyWindows: config?.weeklyWindows ?? defaultWorkingWindows(),
    travelBufferMinutes: config?.travelBufferMinutes ?? 30,
    absences,
    reservations,
  };
}

export function reservationIssues(
  state: CrewReservationState,
  start: Date,
  end: Date,
  buffer: number,
  now: Date,
): PlanningAttention[] {
  const issues: PlanningAttention[] = [],
    reservedEnd = reserveEnd(end, buffer);
  const detail = {
    crewId: state.crew.id,
    from: start.toISOString(),
    to: reservedEnd.toISOString(),
  };
  if (!state.crew.active)
    issues.push({ ...detail, code: 'CREW_INACTIVE', message: 'The team is inactive.' });
  if (!fitsWindow(start, reservedEnd, state.weeklyWindows))
    issues.push({
      ...detail,
      code: 'OUTSIDE_WORKING_WINDOW',
      message: 'The complete visit and travel buffer do not fit one current working window.',
    });
  for (const absence of state.absences)
    if (overlaps(start, reservedEnd, absence.startAt, absence.endAt))
      issues.push({
        crewId: state.crew.id,
        code: 'UNAVAILABLE',
        message: 'The team has a recorded unavailability interval.',
        from: absence.startAt.toISOString(),
        to: absence.endAt.toISOString(),
      });
  for (const row of state.reservations) {
    const release = releaseForReservation(row, now);
    const bookingStart = startForReservation(row);
    if (release.releaseAt === null) {
      if (reservedEnd > bookingStart)
        issues.push({
          ...detail,
          code: 'UNKNOWN_RELEASE',
          appointmentId: row.appointmentId,
          message: release.message,
        });
    } else if (overlaps(start, reservedEnd, bookingStart, release.releaseAt)) {
      const plannedRelease = reserveEnd(row.plannedEndAt, row.travelBufferMinutes);
      const extendedOnly = !overlaps(start, reservedEnd, row.plannedStartAt, plannedRelease);
      issues.push({
        crewId: state.crew.id,
        code: extendedOnly ? 'PREDICTED_CONFLICT' : 'BOOKING_CONFLICT',
        appointmentId: row.appointmentId,
        message: extendedOnly
          ? bookingStart < row.plannedStartAt && start < row.plannedStartAt
            ? 'The team has already departed before its planned start and is still active.'
            : release.message
          : 'The team already has an overlapping reserved visit.',
        from: bookingStart.toISOString(),
        to: release.releaseAt.toISOString(),
      });
    }
  }
  return issues;
}
