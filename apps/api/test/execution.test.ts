import { describe, expect, it } from 'vitest';
import { ExecutionDto } from '../src/execution/execution.dto';
import { resolveOrderProgress, type ProgressFacts } from '../src/execution/execution-state';

const facts = (patch: Partial<ProgressFacts> = {}): ProgressFacts => ({
  plannedProgress: 'ASSIGNED',
  hasActiveExecution: false,
  volumeReady: false,
  hasCompletedWork: false,
  hasPartialOutcome: false,
  hasBlockedOutcome: false,
  openIssueCount: 0,
  openReturnCount: 0,
  ...patch,
});
describe('M5 progress precedence independently of finances', () => {
  it.each(['INBOX', 'PLANNED', 'ASSIGNED'] as const)(
    'preserves untouched M4 %s',
    (plannedProgress) => {
      expect(resolveOrderProgress(facts({ plannedProgress }))).toEqual({
        progress: plannedProgress,
        workReadyForReview: false,
        openIssueCount: 0,
        returnVisitRequired: false,
      });
    },
  );
  it('prioritizes active work even when volume and issues/returns otherwise suggest review', () => {
    expect(
      resolveOrderProgress(
        facts({
          hasActiveExecution: true,
          volumeReady: true,
          hasCompletedWork: true,
          openIssueCount: 2,
          openReturnCount: 2,
        }),
      ),
    ).toEqual({
      progress: 'IN_PROGRESS',
      workReadyForReview: false,
      openIssueCount: 2,
      returnVisitRequired: true,
    });
  });
  it('permits review only with complete volume, no active work and no issue/return blocker', () => {
    expect(resolveOrderProgress(facts({ volumeReady: true, hasCompletedWork: true }))).toEqual({
      progress: 'AWAITING_REVIEW',
      workReadyForReview: true,
      openIssueCount: 0,
      returnVisitRequired: false,
    });
    for (const patch of [
      { openIssueCount: 1 },
      { openReturnCount: 1 },
      { openIssueCount: 2, openReturnCount: 1 },
    ]) {
      expect(
        resolveOrderProgress(facts({ volumeReady: true, hasCompletedWork: true, ...patch })),
      ).toMatchObject({ progress: 'REQUIRES_ATTENTION', workReadyForReview: false });
    }
  });
  it('does not disguise partial, blocked or unresolved historical work as a fresh planning state', () => {
    for (const patch of [
      { hasCompletedWork: true },
      { hasPartialOutcome: true },
      { hasCompletedWork: true, hasBlockedOutcome: true, openReturnCount: 1 },
    ])
      expect(resolveOrderProgress(facts(patch))).toMatchObject({
        progress: 'PARTIALLY_COMPLETED',
        workReadyForReview: false,
      });
    for (const patch of [
      { hasBlockedOutcome: true },
      { openIssueCount: 1 },
      { openReturnCount: 1 },
    ])
      expect(resolveOrderProgress(facts(patch))).toMatchObject({
        progress: 'REQUIRES_ATTENTION',
        workReadyForReview: false,
      });
  });
});

describe('M5 command boundary validation', () => {
  const base = { operationKey: 'unit-operation-001', expectedExecutionVersion: 1 };
  const finish = {
    ...base,
    outcome: 'PARTIALLY_COMPLETED',
    summary: 'Remaining assembly',
    reason: 'Missing fittings',
    remainingWork: 'Assemble table',
    returnVisitRequired: true,
    returnReason: 'Bring fittings',
  };
  it('rejects client identity, times, direct status and inappropriate version domains', () => {
    for (const key of [
      'actorId',
      'crewId',
      'orderId',
      'departedAt',
      'actualEndAt',
      'executionStatus',
      'expectedVersion',
    ])
      expect(() => ExecutionDto.command({ ...base, [key]: 'forged' })).toThrow();
    expect(() => ExecutionDto.depart({ ...base, expectedAppointmentVersion: 0 })).toThrow();
    for (const operationKey of ['', 'short', '../path-key', 'key with spaces', 'a'.repeat(101)])
      expect(() => ExecutionDto.command({ ...base, operationKey })).toThrow();
    expect(ExecutionDto.depart({ ...base, expectedAppointmentVersion: 3 })).toEqual({
      ...base,
      expectedAppointmentVersion: 3,
    });
  });
  it('keeps partial/blocked and return reasons explicit and bounded', () => {
    expect(ExecutionDto.finish(finish)).toEqual(finish);
    for (const field of ['summary', 'reason', 'remainingWork', 'returnReason'])
      expect(() => ExecutionDto.finish({ ...finish, [field]: ' ' })).toThrow();
    expect(() => ExecutionDto.finish({ ...finish, returnVisitRequired: 'true' })).toThrow();
    expect(() =>
      ExecutionDto.finish({ ...finish, outcome: 'COMPLETED', summary: 'a'.repeat(4001) }),
    ).toThrow();
    expect(() => ExecutionDto.finish({ ...finish, outcome: 'REOPENED' })).toThrow();
    expect(() => ExecutionDto.finish({ ...finish, summary: 'Invalid\0summary' })).toThrow();
    expect(
      ExecutionDto.finish({ ...finish, outcome: 'BLOCKED', returnVisitRequired: false }),
    ).toMatchObject({ outcome: 'BLOCKED' });
  });
  it('validates safe absolute quantities and independent checklist versions', () => {
    const input = {
      operationKey: base.operationKey,
      expectedFulfillmentVersion: 2,
      deliveredQuantity: 2,
      assembledQuantity: 1,
    };
    expect(ExecutionDto.fulfillment(input)).toEqual({ ...input, reason: undefined });
    for (const value of [-1, 0.1, 10001, Number.MAX_SAFE_INTEGER, NaN, Infinity])
      expect(() => ExecutionDto.fulfillment({ ...input, deliveredQuantity: value })).toThrow();
    expect(() => ExecutionDto.fulfillment({ ...input, expectedExecutionVersion: 1 })).toThrow();
    expect(
      ExecutionDto.task({
        operationKey: base.operationKey,
        expectedTaskVersion: 2,
        resultStatus: 'DONE',
      }),
    ).toMatchObject({ expectedTaskVersion: 2, resultStatus: 'DONE' });
    expect(() =>
      ExecutionDto.task({
        operationKey: base.operationKey,
        expectedTaskVersion: 2,
        resultStatus: 'COMPLETED',
      }),
    ).toThrow();
  });
  it('bounds server list pagination and rejects device timezone/foreign crew filters', () => {
    expect(ExecutionDto.query({})).toEqual({ view: 'today', page: 1, pageSize: 20 });
    expect(ExecutionDto.query({ view: 'open', page: '2', pageSize: '100' })).toEqual({
      view: 'open',
      page: 2,
      pageSize: 100,
    });
    for (const query of [
      { view: 'all' },
      { page: '0' },
      { page: '1.5' },
      { pageSize: '101' },
      { page: ['1', '2'] },
      { timeZone: 'Asia/Tokyo' },
      { crewId: 'foreign' },
    ])
      expect(() => ExecutionDto.query(query)).toThrow();
  });
});
