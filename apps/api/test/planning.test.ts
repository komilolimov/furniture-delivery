import { describe, expect, it } from 'vitest';
import { appointmentFingerprint } from '../src/planning/planning.service';
import {
  fitsWindow,
  localToUtc,
  overlaps,
  reserveEnd,
  resolveLocalWindow,
  validateRange,
} from '../src/planning/planning-time';

const instant = (value: string) => new Date(value);

describe('M4 named-zone time and reservation boundaries', () => {
  it('resolves an ordinary Rome wall clock independently of the process timezone', () => {
    const before = process.env.TZ;
    try {
      for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
        process.env.TZ = zone;
        expect(localToUtc('2030-01-07T09:00').toISOString()).toBe('2030-01-07T08:00:00.000Z');
        const window = resolveLocalWindow('2030-07-08T09:00', 90);
        expect(window.plannedStartAt.toISOString()).toBe('2030-07-08T07:00:00.000Z');
        expect(window.plannedEndAt.toISOString()).toBe('2030-07-08T08:30:00.000Z');
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
  it('rejects invalid, nonexistent and ambiguous local times before working-hours validation', () => {
    for (const value of [
      '2026-03-29T02:30',
      '2026-10-25T02:30',
      '2026-02-30T09:00',
      '2026-03-29T02:30Z',
      '2026-01-07 09:00',
      'not-a-date',
    ]) {
      expect(() => localToUtc(value)).toThrow();
    }
    // Both sides of each DST transition remain valid, with the actual Rome offsets.
    expect(localToUtc('2026-03-29T01:30').toISOString()).toBe('2026-03-29T00:30:00.000Z');
    expect(localToUtc('2026-03-29T03:30').toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(localToUtc('2026-10-25T01:30').toISOString()).toBe('2026-10-24T23:30:00.000Z');
    expect(localToUtc('2026-10-25T03:30').toISOString()).toBe('2026-10-25T02:30:00.000Z');
  });
  it('computes local-date range boundaries across 23-hour and 25-hour days', () => {
    const spring = validateRange('2026-03-29', '2026-03-30');
    const autumn = validateRange('2026-10-25', '2026-10-26');
    expect(spring.from.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(spring.to.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect((spring.to.getTime() - spring.from.getTime()) / 3600000).toBe(23);
    expect((autumn.to.getTime() - autumn.from.getTime()) / 3600000).toBe(25);
    for (const [from, to] of [
      ['2026-01-01', '2026-01-01'],
      ['2026-01-02', '2026-01-01'],
      ['2026-01-01', '2026-02-13'],
    ])
      expect(() => validateRange(from!, to!)).toThrow();
  });
  it('checks half-open full reservations on both sides and permits exact boundary contact', () => {
    const existingStart = localToUtc('2030-01-07T09:00');
    const existingEnd = localToUtc('2030-01-07T11:00');
    const endWithBuffer = reserveEnd(existingEnd, 30);
    expect(
      overlaps(
        existingStart,
        endWithBuffer,
        localToUtc('2030-01-07T11:29'),
        localToUtc('2030-01-07T12:29'),
      ),
    ).toBe(true);
    expect(
      overlaps(
        existingStart,
        endWithBuffer,
        localToUtc('2030-01-07T11:30'),
        localToUtc('2030-01-07T12:30'),
      ),
    ).toBe(false);
    expect(
      overlaps(
        localToUtc('2030-01-07T08:00'),
        reserveEnd(localToUtc('2030-01-07T08:45'), 30),
        existingStart,
        endWithBuffer,
      ),
    ).toBe(true);
    expect(
      overlaps(
        existingStart,
        reserveEnd(existingEnd, 0),
        existingEnd,
        localToUtc('2030-01-07T12:00'),
      ),
    ).toBe(false);
  });
  it('includes the whole buffer in one local weekly window and treats a break as unavailable', () => {
    const windows = [
      { weekday: 1, startTime: '08:00', endTime: '12:00' },
      { weekday: 1, startTime: '13:00', endTime: '18:00' },
    ];
    expect(
      fitsWindow(
        localToUtc('2030-01-07T10:30'),
        reserveEnd(localToUtc('2030-01-07T11:30'), 30),
        windows,
      ),
    ).toBe(true);
    expect(
      fitsWindow(
        localToUtc('2030-01-07T11:00'),
        reserveEnd(localToUtc('2030-01-07T12:00'), 30),
        windows,
      ),
    ).toBe(false);
    expect(
      fitsWindow(
        localToUtc('2030-01-07T12:30'),
        reserveEnd(localToUtc('2030-01-07T13:30'), 30),
        windows,
      ),
    ).toBe(false);
    expect(
      fitsWindow(localToUtc('2030-01-12T09:00'), localToUtc('2030-01-12T10:00'), windows),
    ).toBe(false);
    expect(
      fitsWindow(localToUtc('2030-01-12T09:00'), localToUtc('2030-01-12T10:00'), [
        { weekday: 6, startTime: '08:00', endTime: '18:00' },
      ]),
    ).toBe(true);
  });
  it('rejects fractional/negative durations and buffers, overnight and contradictory intervals', () => {
    for (const duration of [0, -1, 1.5, 10081])
      expect(() => resolveLocalWindow('2030-01-07T09:00', duration)).toThrow();
    expect(() => resolveLocalWindow('2030-01-07T23:30', 60)).toThrow();
    for (const buffer of [-1, 0.5, 181])
      expect(() => reserveEnd(instant('2030-01-07T10:00:00Z'), buffer)).toThrow();
  });
});

describe('M4 create fingerprint semantics', () => {
  it('normalizes selections and notes, excludes operation keys, and detects actual changes', () => {
    const input = {
      localStart: '2030-01-07T09:00',
      durationMinutes: 60,
      crewIds: ['b', 'a'],
      templateIds: ['y', 'x'],
      notes: '  Fixture note  ',
      idempotencyKey: 'operation-a',
    };
    const fingerprint = appointmentFingerprint(input);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(
      appointmentFingerprint({
        ...input,
        crewIds: ['a', 'b'],
        templateIds: ['x', 'y'],
        notes: 'Fixture note',
        idempotencyKey: 'operation-b',
      }),
    ).toBe(fingerprint);
    expect(appointmentFingerprint({ ...input, durationMinutes: 90 })).not.toBe(fingerprint);
    expect(appointmentFingerprint({ ...input, localStart: '2030-01-07T10:00' })).not.toBe(
      fingerprint,
    );
    expect(appointmentFingerprint({ ...input, notes: undefined, templateIds: undefined })).toBe(
      appointmentFingerprint({ ...input, notes: '', templateIds: [] }),
    );
  });
});
