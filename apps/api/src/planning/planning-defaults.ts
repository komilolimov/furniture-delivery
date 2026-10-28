import type { WeeklyWorkingWindow } from '@furniture-delivery/contracts';

/** Editable MVP defaults; return a fresh array so one crew cannot mutate another. */
export function defaultWorkingWindows(): WeeklyWorkingWindow[] {
  return [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '08:00', endTime: '18:00' }));
}
