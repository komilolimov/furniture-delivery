import { describe, expect, it } from 'vitest';
import { completeCommand, reopenCommand } from '../src/completion/completion.controller';

const input = {
  operationKey: 'completion-unit-key',
  expectedVersion: 7,
  reason: '  Explicit operational decision  ',
};
const completionId = 'ba40a7d9-7e75-4e8b-9e14-8fb159421e66';
describe('M7 explicit completion and reopen command boundaries', () => {
  it('requires a bounded current order version, durable operation key and nonempty reason', () => {
    expect(completeCommand(input)).toEqual({ ...input, reason: 'Explicit operational decision' });
    for (const patch of [
      { expectedVersion: 0 },
      { expectedVersion: 1.5 },
      { expectedVersion: '7' },
      { expectedVersion: 2147483647 },
      { operationKey: '../unsafe' },
      { operationKey: '' },
      { operationKey: 'x'.repeat(101) },
      { reason: '' },
      { reason: 'bad\0reason' },
      { reason: 'x'.repeat(4001) },
    ])
      expect(() => completeCommand({ ...input, ...patch })).toThrow();
  });

  it('never trusts client completion state, readiness, actor, timestamp or financial authority', () => {
    for (const field of [
      'canComplete',
      'physicalReady',
      'confirmationsReady',
      'status',
      'progress',
      'actorId',
      'createdAt',
      'snapshotIds',
      'signatureIds',
      'currentCompletionId',
      'paidCents',
      'orderTotalCents',
    ])
      expect(() => completeCommand({ ...input, [field]: true })).toThrow();
    for (const value of [null, [], 3, 'payload']) expect(() => completeCommand(value)).toThrow();
  });

  it('binds reopen to one expected completion ID without accepting a client-supplied new state', () => {
    expect(reopenCommand({ ...input, expectedCompletionId: completionId })).toEqual({
      ...input,
      expectedCompletionId: completionId,
      reason: 'Explicit operational decision',
    });
    for (const patch of [
      { expectedCompletionId: undefined },
      { expectedCompletionId: 'foreign' },
      { expectedCompletionId: null },
      { expectedVersion: 0 },
      { reason: '' },
      { source: 'ISSUE' },
      { sourceId: completionId },
      { reopenedAt: '2030-01-07T08:00:00Z' },
    ])
      expect(() =>
        reopenCommand({ ...input, expectedCompletionId: completionId, ...patch }),
      ).toThrow();
  });

  it('rejects unsupported metadata rather than allowing an arbitrary status patch or historical record replacement', () => {
    expect(() => completeCommand({ ...input, completion: { id: completionId } })).toThrow();
    expect(() =>
      reopenCommand({
        ...input,
        expectedCompletionId: completionId,
        expectedSnapshotHash: 'a'.repeat(64),
      }),
    ).toThrow();
    expect(() =>
      reopenCommand({ ...input, expectedCompletionId: completionId, resetQuantities: true }),
    ).toThrow();
    expect(() =>
      reopenCommand({ ...input, expectedCompletionId: completionId, deleteSignatures: true }),
    ).toThrow();
  });
});
