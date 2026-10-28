import { describe, expect, it } from 'vitest';
import {
  businessRange,
  shiftBusinessDate,
  utcToRomeLocalInput,
  displayRome,
} from './business-time';

describe('M4 browser business time helpers', () => {
  it('keeps Rome slots independent of the device/process timezone', () => {
    const previous = process.env.TZ;
    try {
      for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
        process.env.TZ = zone;
        expect(utcToRomeLocalInput('2030-01-07T08:00:00.000Z')).toBe('2030-01-07T09:00');
        expect(utcToRomeLocalInput('2030-07-08T07:00:00.000Z')).toBe('2030-07-08T09:00');
        expect(displayRome('2030-01-07T08:00:00.000Z')).toContain('09:00');
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
  it('moves calendar dates rather than adding UTC24h at DST changes', () => {
    expect(shiftBusinessDate('2026-03-29', 1)).toBe('2026-03-30');
    expect(shiftBusinessDate('2026-10-25', 1)).toBe('2026-10-26');
    expect(businessRange('2026-03-29', 'week')).toEqual({ from: '2026-03-23', to: '2026-03-30' });
    expect(businessRange('2026-10-25', 'day')).toEqual({ from: '2026-10-25', to: '2026-10-26' });
  });
});
