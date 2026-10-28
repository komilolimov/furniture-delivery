import { describe, expect, it } from 'vitest';
import {
  completionHistoryFixture,
  completionReadinessFixture,
  completedReadinessFixture,
  completionRecordFixture,
} from '../test/completion-fixture';
import {
  isCompletionHistoryResponse,
  isCompletionOperationResponse,
  isCompletionReadinessResponse,
} from './completion-guards';
describe('M7 completion contracts require real server decision fields', () => {
  it('accepts independent physical and acknowledgement readiness and actual current completion', () => {
    expect(isCompletionReadinessResponse({ readiness: completionReadinessFixture })).toBe(true);
    expect(isCompletionReadinessResponse({ readiness: completedReadinessFixture })).toBe(true);
    expect(isCompletionHistoryResponse(completionHistoryFixture)).toBe(true);
  });
  it('rejects malformed readiness, unrecognized blockers and invalid versions instead of trusting a lone canComplete flag', () => {
    for (const patch of [
      { orderVersion: 0 },
      { orderVersion: '12' },
      { physicalReady: 'true' },
      { confirmationsReady: null },
      { snapshotIds: [1] },
      { currentCompletion: { id: 'fake' } },
      { blockers: [{ code: 'IGNORE_EVERYTHING', message: 'forged' }] },
      { blockers: [{ code: 'OPEN_ISSUES', message: 'Problem', issueId: 2 }] },
    ])
      expect(
        isCompletionReadinessResponse({ readiness: { ...completionReadinessFixture, ...patch } }),
      ).toBe(false);
    expect(isCompletionReadinessResponse({ canComplete: true })).toBe(false);
  });
  it('checks durable receipt and append-only history metadata, including reopen source and timestamps', () => {
    expect(
      isCompletionOperationResponse({
        readiness: completionReadinessFixture,
        receipt: {
          id: 'receipt',
          action: 'ORDER_COMPLETE',
          resultId: 'completion',
          createdAt: '2030-01-07T12:00:00.000Z',
        },
      }),
    ).toBe(true);
    expect(
      isCompletionOperationResponse({
        readiness: completionReadinessFixture,
        receipt: { id: 'receipt' },
      }),
    ).toBe(false);
    const event = {
      id: 'reopen',
      orderId: 'order',
      completionId: 'completion',
      actorId: 'dispatcher',
      createdAt: '2030-01-07T12:00:00.000Z',
      reason: 'New review',
      source: 'MANUAL',
      sourceId: null,
    };
    expect(
      isCompletionHistoryResponse({
        ...completionHistoryFixture,
        completions: [completionRecordFixture],
        reopenEvents: [event],
      }),
    ).toBe(true);
    expect(
      isCompletionHistoryResponse({
        ...completionHistoryFixture,
        reopenEvents: [{ ...event, source: 'PAYMENT' }],
      }),
    ).toBe(false);
    expect(
      isCompletionHistoryResponse({
        ...completionHistoryFixture,
        completions: [{ ...completionRecordFixture, createdAt: 'invalid' }],
      }),
    ).toBe(false);
  });
});
