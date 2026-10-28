import { Temporal } from 'temporal-polyfill';

export const BUSINESS_ZONE = 'Europe/Rome';
export function businessToday(): string {
  return Temporal.Now.plainDateISO(BUSINESS_ZONE).toString();
}
export function utcToRomeLocalInput(iso: string): string {
  return Temporal.Instant.from(iso)
    .toZonedDateTimeISO(BUSINESS_ZONE)
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' });
}
export function displayRome(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}
export function shiftBusinessDate(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}
export function businessRange(
  date: string,
  view: 'day' | 'week' | 'list',
): { from: string; to: string } {
  const selected = Temporal.PlainDate.from(date);
  const from = view === 'day' ? selected : selected.subtract({ days: selected.dayOfWeek - 1 });
  return { from: from.toString(), to: from.add({ days: view === 'day' ? 1 : 7 }).toString() };
}
