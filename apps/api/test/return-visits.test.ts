import { describe, expect, it } from 'vitest';
import { ReturnVisitsDto } from '../src/return-visits/return-visits.dto';

const crewA = 'bd140c00-6699-4b75-9239-5beffbb305b9';
const crewB = 'a0238e78-2218-43f9-a1b2-3dd01113c589';
const taskId = 'bdb7956f-00a7-4850-aaf1-5f53004a59ed';
const itemId = 'e5873836-d4bb-4917-adab-67aa86fd9485';
const plan = () => ({
  operationKey: 'return-unit-operation',
  expectedVersion: 3,
  localStart: '2030-01-07T12:00',
  durationMinutes: 90,
  crewIds: [crewA, crewB],
  carriedTasks: [{ sourceTaskId: taskId, crewId: crewA }],
  newTasks: [
    {
      crewId: crewB,
      name: '  Inspect replaced fitting  ',
      description: '  New work scope  ',
      required: true,
      severity: 'HIGH',
      priority: 35,
      reason: '  A new integrity check is required  ',
    },
  ],
  itemTargets: [{ itemId, deliveredQuantity: 2, assembledQuantity: 1 }],
  reason: '  Dispatcher confirmed remaining work  ',
  notes: '  Internal fixture clarification  ',
});

describe('M6 return commands enforce runtime boundaries before transactional business rules', () => {
  it('normalizes permitted text and crew ordering while preserving explicit task and absolute item scope', () => {
    const input = plan(),
      before = structuredClone(input),
      result = ReturnVisitsDto.plan(input);
    expect(result.crewIds).toEqual([crewB, crewA]);
    expect(result.carriedTasks).toEqual([{ sourceTaskId: taskId, crewId: crewA }]);
    expect(result.newTasks[0]).toEqual({
      crewId: crewB,
      name: 'Inspect replaced fitting',
      description: 'New work scope',
      required: true,
      severity: 'HIGH',
      priority: 35,
      reason: 'A new integrity check is required',
    });
    expect(result.itemTargets).toEqual([{ itemId, deliveredQuantity: 2, assembledQuantity: 1 }]);
    expect(result.reason).toBe('Dispatcher confirmed remaining work');
    expect(result.notes).toBe('Internal fixture clarification');
    expect(input).toEqual(before);
  });

  it('rejects forged authority, result facts and unsupported keys at every nesting level', () => {
    for (const field of [
      'actorId',
      'createdAt',
      'status',
      'orderId',
      'appointmentId',
      'resolvedBy',
      'sourceReport',
      'estimatedFinishAt',
      'returnRequested',
    ])
      expect(() => ReturnVisitsDto.plan({ ...plan(), [field]: crewA })).toThrow();
    expect(() =>
      ReturnVisitsDto.plan({
        ...plan(),
        carriedTasks: [{ sourceTaskId: taskId, crewId: crewA, resultStatus: 'DONE' }],
      }),
    ).toThrow();
    expect(() =>
      ReturnVisitsDto.plan({
        ...plan(),
        newTasks: [{ ...plan().newTasks[0], templateId: taskId }],
      }),
    ).toThrow();
    expect(() =>
      ReturnVisitsDto.plan({
        ...plan(),
        itemTargets: [{ ...plan().itemTargets[0], fulfillmentVersion: 1 }],
      }),
    ).toThrow();
    for (const value of [null, [], 'payload', 3])
      expect(() => ReturnVisitsDto.plan(value)).toThrow();
  });

  it('requires bounded integer versions, explicit retry key and valid same-day Rome wall-clock windows', () => {
    for (const patch of [
      { expectedVersion: 0 },
      { expectedVersion: 1.5 },
      { expectedVersion: '3' },
      { expectedVersion: 2147483647 },
      { operationKey: '' },
      { operationKey: '../unsafe' },
      { operationKey: 'x'.repeat(101) },
      { localStart: '2030-03-31T02:30' },
      { localStart: '2030-10-27T02:30' },
      { localStart: '2030-01-07T12:00Z' },
      { localStart: '2030-01-07T23:30', durationMinutes: 60 },
      { durationMinutes: 0 },
      { durationMinutes: -1 },
      { durationMinutes: 1.1 },
      { durationMinutes: '90' },
      { durationMinutes: 1441 },
    ])
      expect(() => ReturnVisitsDto.plan({ ...plan(), ...patch })).toThrow();
  });

  it('rejects duplicate or malformed references and caps each explicit collection', () => {
    for (const patch of [
      { crewIds: [] },
      { crewIds: [crewA, crewA] },
      { crewIds: ['foreign'] },
      { crewIds: Array(51).fill(crewA) },
      {
        carriedTasks: [
          { sourceTaskId: taskId, crewId: crewA },
          { sourceTaskId: taskId, crewId: crewB },
        ],
      },
      { carriedTasks: [{ sourceTaskId: 'not-a-task', crewId: crewA }] },
      { carriedTasks: null },
      { carriedTasks: Array(101).fill(plan().carriedTasks[0]) },
      { newTasks: Array(101).fill(plan().newTasks[0]) },
      { itemTargets: [plan().itemTargets[0], plan().itemTargets[0]] },
      { itemTargets: Array(101).fill(plan().itemTargets[0]) },
    ])
      expect(() => ReturnVisitsDto.plan({ ...plan(), ...patch })).toThrow();
  });

  it('requires a separately justified new task and integral nonnegative absolute quantity targets', () => {
    for (const patch of [
      { required: 'true' },
      { required: 1 },
      { severity: 'URGENT' },
      { priority: -1 },
      { priority: 1.5 },
      { priority: 10000 },
      { name: '' },
      { name: 'x'.repeat(201) },
      { description: 'x'.repeat(4001) },
      { reason: '' },
      { reason: 'x'.repeat(4001) },
    ])
      expect(() =>
        ReturnVisitsDto.plan({ ...plan(), newTasks: [{ ...plan().newTasks[0], ...patch }] }),
      ).toThrow();
    for (const patch of [
      { itemId: 'foreign' },
      { deliveredQuantity: -1 },
      { deliveredQuantity: 0.5 },
      { deliveredQuantity: '2' },
      { assembledQuantity: -1 },
      { assembledQuantity: 2147483648 },
      { assembledQuantity: Number.POSITIVE_INFINITY },
    ])
      expect(() =>
        ReturnVisitsDto.plan({ ...plan(), itemTargets: [{ ...plan().itemTargets[0], ...patch }] }),
      ).toThrow();
  });

  it('rejects NUL characters from every newly accepted mutable text field before PostgreSQL can receive it', () => {
    for (const patch of [{ reason: 'bad\0reason' }, { notes: 'bad\0notes' }])
      expect(() => ReturnVisitsDto.plan({ ...plan(), ...patch })).toThrow();
    for (const patch of [
      { name: 'bad\0name' },
      { description: 'bad\0description' },
      { reason: 'bad\0new task reason' },
    ])
      expect(() =>
        ReturnVisitsDto.plan({ ...plan(), newTasks: [{ ...plan().newTasks[0], ...patch }] }),
      ).toThrow();
    expect(() =>
      ReturnVisitsDto.create({
        operationKey: 'return-unit-create',
        expectedExecutionVersion: 4,
        reason: 'Required return',
        remainingWork: 'bad\0remaining work',
      }),
    ).toThrow();
    expect(() =>
      ReturnVisitsDto.resolve({
        operationKey: 'return-unit-resolve',
        expectedVersion: 4,
        reason: 'bad\0resolution',
      }),
    ).toThrow();
  });

  it('requires current version and explanatory text for explicit create and resolve commands', () => {
    const input = {
      operationKey: 'return-unit-create',
      expectedExecutionVersion: 4,
      reason: '  Missing fitting  ',
      remainingWork: '  Finish assembly  ',
    };
    expect(ReturnVisitsDto.create(input)).toEqual({
      ...input,
      reason: 'Missing fitting',
      remainingWork: 'Finish assembly',
    });
    for (const patch of [
      { expectedExecutionVersion: 0 },
      { expectedExecutionVersion: 1.1 },
      { reason: '' },
      { remainingWork: '' },
      { status: 'OPEN' },
      { assignmentId: taskId },
    ])
      expect(() => ReturnVisitsDto.create({ ...input, ...patch })).toThrow();
    const resolve = {
      operationKey: 'return-unit-resolve',
      expectedVersion: 5,
      reason: '  Scope and targets verified  ',
    };
    expect(ReturnVisitsDto.resolve(resolve)).toEqual({
      ...resolve,
      reason: 'Scope and targets verified',
    });
    for (const patch of [
      { expectedVersion: 0 },
      { expectedVersion: 1.1 },
      { reason: '' },
      { status: 'RESOLVED' },
      { resolvedAt: NOW_FORGED },
    ])
      expect(() => ReturnVisitsDto.resolve({ ...resolve, ...patch })).toThrow();
  });

  it('bounds the backoffice queue and preserves explicit OPEN/PLANNED/RESOLVED filters', () => {
    expect(ReturnVisitsDto.query({})).toEqual({ page: 1, pageSize: 20 });
    for (const status of ['OPEN', 'PLANNED', 'RESOLVED'])
      expect(
        ReturnVisitsDto.query({ status, orderId: itemId, page: '2', pageSize: '100' }),
      ).toEqual({ status, orderId: itemId, page: 2, pageSize: 100 });
    for (const input of [
      { status: 'CLOSED' },
      { orderId: 'foreign' },
      { page: '0' },
      { page: '-1' },
      { page: '1.5' },
      { page: 1 },
      { pageSize: '101' },
      { pageSize: ['20'] },
      { crewId: crewA },
    ])
      expect(() => ReturnVisitsDto.query(input)).toThrow();
  });
});

const NOW_FORGED = '2030-01-07T08:00:00.000Z';
