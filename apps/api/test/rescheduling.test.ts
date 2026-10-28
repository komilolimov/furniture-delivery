import { describe, expect, it } from 'vitest';
import { Crew } from '../src/crews/crew.entity';
import {
  releaseForReservation,
  reservationIssues,
  type CrewReservationState,
  type ReservedAssignment,
} from '../src/planning/crew-reservations';
import { localToUtc } from '../src/planning/planning-time';

const local = (clock: string) => localToUtc('2030-01-07T' + clock);
const reservation = (change: Partial<ReservedAssignment> = {}): ReservedAssignment => ({
  appointmentId: 'visit',
  assignmentId: 'assignment',
  orderId: 'order',
  orderNumber: 'TEST-1',
  crewId: 'crew',
  plannedStartAt: local('09:00'),
  plannedEndAt: local('12:00'),
  travelBufferMinutes: 30,
  executionStatus: 'IN_PROGRESS',
  departedAt: null,
  estimatedFinishAt: null,
  actualEndAt: null,
  ...change,
});
const state = (change: Partial<CrewReservationState> = {}): CrewReservationState => ({
  crew: Object.assign(new Crew(), { id: 'crew', active: true }),
  weeklyWindows: [{ weekday: 1, startTime: '08:00', endTime: '18:00' }],
  travelBufferMinutes: 90,
  absences: [],
  reservations: [reservation()],
  ...change,
});

describe('M6 release forecasts keep plan, estimate and actual facts distinct', () => {
  it.each([
    {
      label: 'future plan with no estimate',
      now: '11:00',
      change: {},
      basis: 'PLAN',
      end: '12:30',
    },
    {
      label: 'current later estimate',
      now: '11:00',
      change: { estimatedFinishAt: local('14:00') },
      basis: 'ESTIMATE',
      end: '14:30',
    },
    {
      label: 'estimate earlier than the plan',
      now: '10:00',
      change: { estimatedFinishAt: local('11:00') },
      basis: 'ESTIMATE',
      end: '12:30',
    },
    {
      label: 'stale estimate while the plan remains future',
      now: '11:00',
      change: { estimatedFinishAt: local('10:00') },
      basis: 'PLAN',
      end: '12:30',
    },
    { label: 'exact planned-end boundary', now: '12:00', change: {}, basis: 'PLAN', end: '12:30' },
    {
      label: 'overdue active plan without an estimate',
      now: '12:01',
      change: {},
      basis: 'UNKNOWN',
      end: null,
    },
    {
      label: 'overdue plan and stale estimate',
      now: '14:00',
      change: { estimatedFinishAt: local('14:00') },
      basis: 'UNKNOWN',
      end: null,
    },
    {
      label: 'late actual completion',
      now: '15:00',
      change: {
        executionStatus: 'COMPLETED' as const,
        actualEndAt: local('14:10'),
        estimatedFinishAt: local('16:00'),
      },
      basis: 'ACTUAL',
      end: '14:40',
    },
    {
      label: 'early actual completion preserves the promise',
      now: '15:00',
      change: { executionStatus: 'COMPLETED' as const, actualEndAt: local('10:00') },
      basis: 'ACTUAL',
      end: '12:30',
    },
    {
      label: 'partial terminal result uses actual time',
      now: '15:00',
      change: { executionStatus: 'PARTIALLY_COMPLETED' as const, actualEndAt: local('13:00') },
      basis: 'ACTUAL',
      end: '13:30',
    },
    {
      label: 'unstarted booking keeps its planned reserve',
      now: '15:00',
      change: { executionStatus: 'NOT_STARTED' as const },
      basis: 'PLAN',
      end: '12:30',
    },
  ])('$label', ({ now, change, basis, end }) => {
    const result = releaseForReservation(reservation(change), local(now));
    expect(result.basis).toBe(basis);
    expect(result.releaseAt?.toISOString() ?? null).toBe(end ? local(end).toISOString() : null);
    expect(result.message.length).toBeGreaterThan(10);
  });

  it('keeps the stored assignment buffer when current planning defaults change', () => {
    const olderBooking = reservation({
      estimatedFinishAt: local('14:00'),
      travelBufferMinutes: 15,
    });
    const currentState = state({ reservations: [olderBooking], travelBufferMinutes: 90 });
    expect(
      reservationIssues(currentState, local('14:15'), local('15:00'), 30, local('11:00')),
    ).toEqual([]);
  });
  it('reserves from an early actual departure while keeping plan and terminal reserve rules intact', () => {
    const early = reservation({
      plannedStartAt: local('15:00'),
      plannedEndAt: local('16:00'),
      departedAt: local('09:00'),
    });
    expect(
      reservationIssues(
        state({ reservations: [early] }),
        local('10:00'),
        local('11:00'),
        30,
        local('09:00'),
      ).map((issue) => issue.code),
    ).toEqual(['PREDICTED_CONFLICT']);
    expect(
      reservationIssues(
        state({ reservations: [early] }),
        local('08:00'),
        local('08:30'),
        30,
        local('08:00'),
      ),
    ).toEqual([]);
    expect(early.plannedStartAt).toEqual(local('15:00'));
    const finished = { ...early, executionStatus: 'BLOCKED' as const, actualEndAt: local('09:10') };
    expect(
      reservationIssues(
        state({ reservations: [finished] }),
        local('09:15'),
        local('10:15'),
        30,
        local('09:10'),
      ),
    ).toEqual([]);
    expect(
      reservationIssues(
        state({ reservations: [finished] }),
        local('15:00'),
        local('16:00'),
        30,
        local('09:10'),
      )[0]!.code,
    ).toBe('BOOKING_CONFLICT');
  });

  it('extends only the reservation and classifies the forecast conflict independently of the plan', () => {
    const currentState = state({
      reservations: [reservation({ estimatedFinishAt: local('14:00') })],
    });
    const beforeBoundary = reservationIssues(
      currentState,
      local('14:29'),
      local('15:00'),
      30,
      local('11:00'),
    );
    expect(beforeBoundary.map((issue) => issue.code)).toEqual(['PREDICTED_CONFLICT']);
    expect(beforeBoundary[0]!.appointmentId).toBe('visit');
    expect(
      reservationIssues(currentState, local('14:30'), local('15:00'), 30, local('11:00')),
    ).toEqual([]);
    expect(
      reservationIssues(currentState, local('12:29'), local('13:00'), 30, local('11:00'))[0]!.code,
    ).toBe('BOOKING_CONFLICT');
  });

  it('counts the incoming buffer before an existing booking as well as release after it', () => {
    const currentState = state({ reservations: [reservation({ executionStatus: 'NOT_STARTED' })] });
    expect(
      reservationIssues(currentState, local('08:00'), local('08:31'), 30, local('08:00'))[0]!.code,
    ).toBe('BOOKING_CONFLICT');
    expect(
      reservationIssues(currentState, local('08:00'), local('08:30'), 30, local('08:00')),
    ).toEqual([]);
  });

  it('explains unknown release throughout the future search range rather than inventing a release instant', () => {
    const unknown = state();
    const tomorrow = localToUtc('2030-01-08T10:00');
    const tomorrowEnd = localToUtc('2030-01-08T11:00');
    unknown.weeklyWindows = [{ weekday: 2, startTime: '08:00', endTime: '18:00' }];
    const issues = reservationIssues(unknown, tomorrow, tomorrowEnd, 30, local('13:00'));
    expect(issues.map((issue) => issue.code)).toEqual(['UNKNOWN_RELEASE']);
    expect(issues[0]!.message).toMatch(/estimate|another team/i);
  });

  it('requires each full reserve to fit one working window and honors absences and inactive crews', () => {
    const split = state({
      reservations: [],
      weeklyWindows: [
        { weekday: 1, startTime: '08:00', endTime: '12:00' },
        { weekday: 1, startTime: '13:00', endTime: '18:00' },
      ],
      absences: [{ startAt: local('15:00'), endAt: local('16:00') }],
    });
    expect(
      reservationIssues(split, local('11:00'), local('12:00'), 30, local('08:00')).map(
        (issue) => issue.code,
      ),
    ).toEqual(['OUTSIDE_WORKING_WINDOW']);
    expect(
      reservationIssues(split, local('14:00'), local('14:31'), 30, local('08:00')).map(
        (issue) => issue.code,
      ),
    ).toEqual(['UNAVAILABLE']);
    split.crew.active = false;
    expect(
      reservationIssues(split, local('13:00'), local('14:00'), 30, local('08:00')).map(
        (issue) => issue.code,
      ),
    ).toEqual(['CREW_INACTIVE']);
  });
});
