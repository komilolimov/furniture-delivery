import type { AppointmentDetail } from '@furniture-delivery/contracts';
import type { EventInput } from '@fullcalendar/react';
import { Temporal } from 'temporal-polyfill';
import { BUSINESS_ZONE, businessRange, utcToRomeLocalInput } from './business-time';
import { orderProgressLabel } from './execution-labels';

export type PlanningView = 'day' | 'week' | 'month' | 'list';
const palette = [
  '#285b50',
  '#414d7f',
  '#7b4d2b',
  '#6a477c',
  '#356479',
  '#765469',
  '#52642e',
  '#8b453b',
];
const rangeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_ZONE,
  month: 'long',
  year: 'numeric',
});
function planningDate(value: string): Temporal.PlainDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('Choose a complete planning date.');
  const date = Temporal.PlainDate.from(value);
  if (date.year < 1900 || date.year > 9999)
    throw new RangeError('Choose a date from 1900 to 9999.');
  return date;
}
function noon(date: Temporal.PlainDate): number {
  return date.toZonedDateTime({ timeZone: BUSINESS_ZONE, plainTime: '12:00' }).epochMilliseconds;
}
/** Month queries cover exactly the six Monday-first rows rendered by the standard month grid. */
export function planningRange(date: string, view: PlanningView): { from: string; to: string } {
  const selected = planningDate(date);
  let range: { from: string; to: string };
  if (view === 'month') {
    const first = selected.with({ day: 1 });
    const from = first.subtract({ days: first.dayOfWeek - 1 });
    range = { from: from.toString(), to: from.add({ days: 42 }).toString() };
  } else {
    range = businessRange(date, view);
  }
  planningDate(range.from);
  planningDate(range.to);
  return range;
}
export function isPlanningDate(date: string, view: PlanningView = 'day'): boolean {
  try {
    planningRange(date, view);
    return true;
  } catch {
    return false;
  }
}
export function shiftPlanningDate(date: string, view: PlanningView, direction: -1 | 1): string {
  try {
    const selected = planningDate(date);
    const next = selected.add(
      view === 'month' ? { months: direction } : { days: direction * (view === 'day' ? 1 : 7) },
    );
    planningRange(next.toString(), view);
    return next.toString();
  } catch {
    return date;
  }
}
export function planningRangeLabel(date: string, view: PlanningView): string {
  const selected = planningDate(date);
  if (view === 'month') return monthFormatter.format(noon(selected));
  if (view === 'day') return dayFormatter.format(noon(selected));
  const range = planningRange(date, view);
  return rangeFormatter.formatRange(
    noon(Temporal.PlainDate.from(range.from)),
    noon(Temporal.PlainDate.from(range.to).subtract({ days: 1 })),
  );
}
export function planningTeamColor(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length]!;
}
export function activeTeams(appointment: AppointmentDetail) {
  return appointment.assignments.filter((assignment) => assignment.status === 'ASSIGNED');
}
export function teamNames(appointment: AppointmentDetail): string {
  const teams = activeTeams(appointment);
  return teams.length
    ? teams.map((team) => `${team.crewName}${team.crewActive ? '' : ' (inactive)'}`).join(' + ')
    : 'Unassigned';
}
export function rangeTime(appointment: AppointmentDetail): string {
  return `${utcToRomeLocalInput(appointment.plannedStartAt).slice(11)}–${utcToRomeLocalInput(appointment.plannedEndAt).slice(11)}`;
}
export function planningEventTitle(appointment: AppointmentDetail): string {
  return [
    `${appointment.orderNumber} · ${appointment.customerName}`,
    `${appointment.city} · ${rangeTime(appointment)} · Europe/Rome`,
    teamNames(appointment),
    orderProgressLabel(appointment.execution.orderProgress),
    appointment.status === 'CANCELLED'
      ? 'Cancelled visit'
      : appointment.confirmationStatus === 'CONFIRMED'
        ? 'Confirmed'
        : 'Needs confirmation',
    appointment.needsAttention ? 'Needs attention' : '',
    appointment.execution.openIssueCount
      ? `${appointment.execution.openIssueCount} open issues`
      : '',
    appointment.execution.returnVisitRequired ? 'Return required' : '',
    appointment.execution.maybeDelayed ? 'Possibly delayed' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
export function planningEvents(appointments: readonly AppointmentDetail[]): EventInput[] {
  return appointments.map((appointment) => {
    const firstTeamId = activeTeams(appointment)
      .map(({ crewId }) => crewId)
      .sort()[0];
    return {
      id: appointment.id,
      title: planningEventTitle(appointment),
      start: appointment.plannedStartAt,
      end: appointment.plannedEndAt,
      allDay: false,
      url: `/backoffice/planning/orders/${appointment.orderId}/appointments/${appointment.id}`,
      color: firstTeamId ? planningTeamColor(firstTeamId) : '#64748b',
      contrastColor: '#ffffff',
    };
  });
}
