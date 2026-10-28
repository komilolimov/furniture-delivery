import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PlanningDto } from '../src/planning/planning.dto';

const createInput = () => ({
  localStart: '2030-01-07T09:00',
  durationMinutes: 60,
  crewIds: [randomUUID()],
  idempotencyKey: randomUUID(),
});

describe('M4 strict planning payload contracts', () => {
  it('normalizes IDs and optional fields without allowing caller-derived dates', () => {
    const id = randomUUID();
    const result = PlanningDto.create({ ...createInput(), crewIds: [id.toUpperCase()] });
    expect(result.crewIds).toEqual([id]);
    expect(result.templateIds).toEqual([]);
    expect(result.notes).toBe('');
    for (const field of ['status', 'confirmationStatus', 'plannedEndAt', 'createdBy', 'version']) {
      expect(() => PlanningDto.create({ ...createInput(), [field]: 'forged' })).toThrow();
    }
  });
  it.each([0, -1, 1.5, 1441, Number.MAX_SAFE_INTEGER])('rejects duration %s', (durationMinutes) => {
    expect(() => PlanningDto.create({ ...createInput(), durationMinutes })).toThrow();
  });
  it('rejects duplicate case-insensitive team IDs and same-key fingerprint injection', () => {
    const id = randomUUID();
    expect(() => PlanningDto.create({ ...createInput(), crewIds: [id, id.toUpperCase()] })).toThrow(
      'duplicate',
    );
    expect(() => PlanningDto.create({ ...createInput(), fingerprint: 'forged' })).toThrow(
      'unsupported',
    );
  });
  it('validates task edits without accepting required/name or mixed ID origins', () => {
    const assignmentId = randomUUID(),
      id = randomUUID(),
      templateId = randomUUID();
    expect(
      PlanningDto.update({
        expectedVersion: 1,
        tasks: [{ assignmentId, tasks: [{ id, severity: 'HIGH', priority: 3 }] }],
      }).tasks?.[0]?.tasks[0]?.id,
    ).toBe(id);
    for (const task of [
      { id, templateId, severity: 'HIGH', priority: 3 },
      { id, severity: 'HIGH', priority: 3, required: false },
      { id, severity: 'HIGH', priority: 3, name: 'Forged snapshot' },
      { templateId, severity: 'CRITICAL', priority: 3 },
      { templateId, severity: 'HIGH', priority: 0.5 },
    ])
      expect(() =>
        PlanningDto.update({ expectedVersion: 1, tasks: [{ assignmentId, tasks: [task] }] }),
      ).toThrow();
  });
  it('requires explicit all-team selection and rejects duplicate or ambiguous filters', () => {
    const range = { from: '2030-01-07', to: '2030-01-08' },
      id = randomUUID();
    expect(() => PlanningDto.calendar(range)).toThrow('explicitly');
    expect(
      PlanningDto.calendar({
        ...range,
        allTeams: 'false',
        crewIds: '',
        includeUnassigned: 'false',
      }),
    ).toMatchObject({ allTeams: false, crewIds: [], includeUnassigned: false });
    expect(() => PlanningDto.calendar({ ...range, allTeams: 'true', crewIds: id })).toThrow(
      'not both',
    );
    expect(() => PlanningDto.calendar({ ...range, allTeams: 'false', crewIds: [id, id] })).toThrow(
      'duplicate',
    );
    expect(() =>
      PlanningDto.calendar({ ...range, allTeams: 'true', futureStatus: 'COMPLETED' }),
    ).toThrow('unsupported');
  });
  it('accepts split and weekend working windows and rejects overlap, overnight and overlimit lists', () => {
    const weeklyWindows = [
      { weekday: 6, startTime: '08:00', endTime: '12:00' },
      { weekday: 6, startTime: '13:00', endTime: '18:00' },
    ];
    const input = { expectedVersion: 1, weeklyWindows, travelBufferMinutes: 30 };
    expect(PlanningDto.config(input).weeklyWindows).toEqual(weeklyWindows);
    expect(() =>
      PlanningDto.config({
        ...input,
        weeklyWindows: [...weeklyWindows, { weekday: 6, startTime: '11:59', endTime: '13:00' }],
      }),
    ).toThrow('overlap');
    expect(() =>
      PlanningDto.config({
        ...input,
        weeklyWindows: [{ weekday: 6, startTime: '20:00', endTime: '08:00' }],
      }),
    ).toThrow('midnight');
    const maximum = Array.from({ length: 49 }, (_, index) => ({
      weekday: (index % 7) + 1,
      startTime: `${String(Math.floor(index / 7) * 2).padStart(2, '0')}:00`,
      endTime: `${String(Math.floor(index / 7) * 2 + 1).padStart(2, '0')}:00`,
    }));
    expect(PlanningDto.config({ ...input, weeklyWindows: maximum }).weeklyWindows).toHaveLength(49);
    expect(() =>
      PlanningDto.config({ ...input, weeklyWindows: [...maximum, weeklyWindows[0]] }),
    ).toThrow('49');
    for (const travelBufferMinutes of [-1, 181, 0.5])
      expect(() => PlanningDto.config({ ...input, travelBufferMinutes })).toThrow();
  });
  it('requires cancellation/absence reasons and valid absence order', () => {
    expect(() => PlanningDto.cancel({ expectedVersion: 1, reason: ' ' })).toThrow();
    expect(() =>
      PlanningDto.unavailable({
        localStart: '2030-01-08T12:00',
        localEnd: '2030-01-07T12:00',
        reason: 'Fixture',
      }),
    ).toThrow();
    expect(() => PlanningDto.unavailableUpdate({})).toThrow();
    expect(() => PlanningDto.templateUpdate({ code: 'RENAME-STABLE-CODE' })).toThrow('unsupported');
  });
});
