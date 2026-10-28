import { describe, expect, it } from 'vitest';
import { Temporal } from 'temporal-polyfill';
import { appointmentFixture, planningCrews } from '../test/planning-fixture';
import {
  activeTeams,
  isPlanningDate,
  planningEvents,
  planningEventTitle,
  planningRange,
  planningRangeLabel,
  planningTeamColor,
  rangeTime,
  shiftPlanningDate,
  teamNames,
} from './planning-calendar-model';

describe('Planning calendar display model', () => {
  it('loads all six Monday-first month rows including leading and trailing dates', () => {
    expect(planningRange('2026-03-18', 'month')).toEqual({ from: '2026-02-23', to: '2026-04-06' });
    expect(planningRange('2026-02-15', 'month')).toEqual({ from: '2026-01-26', to: '2026-03-09' });
    for (const date of ['2026-03-18', '2026-02-15', '2028-02-29', '2030-01-01']) {
      const { from, to } = planningRange(date, 'month');
      expect(Temporal.PlainDate.from(from).dayOfWeek).toBe(1);
      expect(Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to)).days).toBe(42);
    }
  });
  it('preserves the established week/list/day boundaries through Rome DST and other device zones', () => {
    const original = process.env.TZ;
    try {
      for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
        process.env.TZ = zone;
        expect(planningRange('2026-03-29', 'week')).toEqual({
          from: '2026-03-23',
          to: '2026-03-30',
        });
        expect(planningRange('2026-10-25', 'list')).toEqual({
          from: '2026-10-19',
          to: '2026-10-26',
        });
        expect(planningRange('2026-10-25', 'day')).toEqual({
          from: '2026-10-25',
          to: '2026-10-26',
        });
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
  it('moves by day, week or calendar month and constrains the month day without UTC-hour arithmetic', () => {
    expect(shiftPlanningDate('2026-01-31', 'month', 1)).toBe('2026-02-28');
    expect(shiftPlanningDate('2028-01-31', 'month', 1)).toBe('2028-02-29');
    expect(shiftPlanningDate('2026-03-29', 'day', 1)).toBe('2026-03-30');
    expect(shiftPlanningDate('2026-10-25', 'week', -1)).toBe('2026-10-18');
    expect(shiftPlanningDate('2026-10-25', 'list', 1)).toBe('2026-11-01');
  });
  it('rejects incomplete/out-of-bounds native dates and does not navigate to invalid API ranges', () => {
    for (const date of ['', '2030-01', '2030-02-30', '1899-12-31', '0001-01-01', '+010000-01-01']) {
      expect(isPlanningDate(date)).toBe(false);
      expect(() => planningRange(date, 'day')).toThrow();
      expect(shiftPlanningDate(date, 'week', 1)).toBe(date);
    }
    expect(isPlanningDate('1900-01-01', 'month')).toBe(true);
    expect(isPlanningDate('9999-12-01', 'month')).toBe(false);
    expect(shiftPlanningDate('1900-01-01', 'day', -1)).toBe('1900-01-01');
    expect(shiftPlanningDate('9999-12-31', 'day', 1)).toBe('9999-12-31');
  });
  it('labels the selected month rather than the leading grid month and uses inclusive readable week ends', () => {
    expect(planningRangeLabel('2026-03-18', 'month')).toBe('March 2026');
    expect(planningRangeLabel('2030-01-07', 'day')).toContain('Monday');
    expect(planningRangeLabel('2030-01-07', 'day')).toContain('7 January 2030');
    const week = planningRangeLabel('2030-01-07', 'week');
    expect(week).toContain('7');
    expect(week).toContain('13');
    expect(week).not.toContain('14');
  });
  it('keeps inactive historical teams while excluding cancelled assignments and supports an unassigned visit', () => {
    const appointment = {
      ...appointmentFixture,
      assignments: appointmentFixture.assignments.map((assignment, index) => ({
        ...assignment,
        crewActive: false,
        status: index === 1 ? ('CANCELLED' as const) : ('ASSIGNED' as const),
      })),
    };
    expect(activeTeams(appointment)).toHaveLength(1);
    expect(teamNames(appointment)).toBe('Aurora (inactive)');
    expect(teamNames({ ...appointmentFixture, assignments: [] })).toBe('Unassigned');
    expect(planningEvents([{ ...appointmentFixture, assignments: [] }])[0]?.color).toBe('#64748b');
  });
  it('keeps one multi-team event, stable colour and planned instants regardless of assignment order or actual/estimated times', () => {
    const appointment = {
      ...appointmentFixture,
      assignments: [...appointmentFixture.assignments].reverse().map((assignment) => ({
        ...assignment,
        execution: {
          ...assignment.execution,
          actualStartAt: '2030-01-07T08:30:00.000Z',
          estimatedFinishAt: '2030-01-07T11:00:00.000Z',
        },
      })),
    };
    const events = planningEvents([appointment]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: appointmentFixture.id,
      start: appointmentFixture.plannedStartAt,
      end: appointmentFixture.plannedEndAt,
      allDay: false,
      url: `/backoffice/planning/orders/${appointmentFixture.orderId}/appointments/${appointmentFixture.id}`,
      color: planningTeamColor(planningCrews[0]!.id),
      contrastColor: '#ffffff',
    });
    expect(events[0]?.color).toBe(planningEvents([appointmentFixture])[0]?.color);
    expect(appointmentFixture.assignments[0]?.crewId).toBe(planningCrews[0]?.id);
    expect(rangeTime(appointment)).toBe('09:00–10:00');
  });
  it('retains full operational context in accessible event text without adding financial/internal fields', () => {
    const appointment = {
      ...appointmentFixture,
      needsAttention: true,
      execution: {
        ...appointmentFixture.execution,
        orderProgress: 'IN_PROGRESS' as const,
        openIssueCount: 2,
        returnVisitRequired: true,
        maybeDelayed: true,
      },
    };
    const title = planningEventTitle(appointment);
    for (const text of [
      'Aurora + Birch',
      'Europe/Rome',
      'In progress',
      'Needs confirmation',
      'Needs attention',
      '2 open issues',
      'Return required',
      'Possibly delayed',
    ])
      expect(title).toContain(text);
    expect(Object.keys(planningEvents([appointment])[0]!)).toEqual([
      'id',
      'title',
      'start',
      'end',
      'allDay',
      'url',
      'color',
      'contrastColor',
    ]);
  });
});
