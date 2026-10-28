import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AcceptanceDto } from '../src/acceptance/acceptance.dto';
import { canonicalAcceptance } from '../src/acceptance/acceptance-payload';

const command = { operationKey: 'acceptance-unit-operation', expectedVersion: 2 };
const sign = {
  ...command,
  consent: true,
  customerName: '  Synthetic signer  ',
  customerRelation: '  Representative  ',
};
describe('M7 canonical historical document and strict acceptance inputs', () => {
  it('sorts object keys at every level while preserving meaningful report order and values', () => {
    const left = {
      teams: [
        { quantities: [1, 2], outcome: 'PARTIALLY_COMPLETED' },
        { outcome: 'COMPLETED', quantities: [2, 2] },
      ],
      address: { city: 'Roma', line: 'Synthetic address' },
      schemaVersion: 1,
    };
    const right = {
      schemaVersion: 1,
      address: { line: 'Synthetic address', city: 'Roma' },
      teams: [
        { outcome: 'PARTIALLY_COMPLETED', quantities: [1, 2] },
        { quantities: [2, 2], outcome: 'COMPLETED' },
      ],
    };
    const canonical = canonicalAcceptance(left);
    expect(canonical).toBe(canonicalAcceptance(right));
    expect(JSON.parse(canonical)).toEqual(left);
    const digest = (text: string) => createHash('sha256').update(text).digest('hex');
    expect(digest(canonical)).toBe(digest(canonicalAcceptance(right)));
    expect(digest(canonicalAcceptance({ ...left, teams: [...left.teams].reverse() }))).not.toBe(
      digest(canonical),
    );
    expect(() => canonicalAcceptance({ field: undefined })).toThrow();
  });

  it('accepts one explicit consent and declared customer details, never trusted authors, times, results or image JSON', () => {
    expect(AcceptanceDto.sign(sign)).toEqual({
      ...sign,
      customerName: 'Synthetic signer',
      customerRelation: 'Representative',
    });
    for (const consent of [undefined, false, 'true', 1])
      expect(() => AcceptanceDto.sign({ ...sign, consent })).toThrow();
    for (const field of [
      'actorId',
      'capturedByUserId',
      'recordedAt',
      'snapshotHash',
      'signerName',
      'assignmentId',
      'signature',
      'png',
      'base64',
      'canComplete',
      'orderTotalCents',
    ])
      expect(() => AcceptanceDto.sign({ ...sign, [field]: 'forged' })).toThrow();
    for (const customerName of ['', ' ', 'bad\0name', 'x'.repeat(201), null, 3])
      expect(() => AcceptanceDto.sign({ ...sign, customerName })).toThrow();
  });

  it('bounds the multipart JSON envelope and rejects additional metadata fields, malformed payloads and non-integer versions', () => {
    expect(AcceptanceDto.signature({ payload: JSON.stringify(sign) })).toEqual(
      AcceptanceDto.sign(sign),
    );
    for (const body of [
      {},
      { payload: sign },
      { payload: 'invalid-json' },
      { payload: 'null' },
      { payload: '[]' },
      { payload: ' '.repeat(8193) },
      { payload: JSON.stringify(sign), extra: 'forged' },
    ])
      expect(() => AcceptanceDto.signature(body)).toThrow();
    for (const patch of [
      { expectedVersion: 0 },
      { expectedVersion: 1.1 },
      { expectedVersion: '2' },
      { expectedVersion: 2147483647 },
      { operationKey: '../unsafe' },
      { operationKey: '' },
      { operationKey: 'x'.repeat(101) },
    ])
      expect(() => AcceptanceDto.sign({ ...sign, ...patch })).toThrow();
  });

  it('records refusal or absence as a reasoned slot-specific operation without accepting a signed status', () => {
    for (const kind of ['REFUSED', 'ABSENT', 'UNABLE_TO_SIGN'])
      expect(
        AcceptanceDto.absence({ ...command, kind, reason: '  Synthetic explanation  ' }),
      ).toEqual({ ...command, kind, reason: 'Synthetic explanation' });
    for (const patch of [
      { kind: 'SIGNED' },
      { kind: '' },
      { reason: '' },
      { reason: 'bad\0reason' },
      { reason: 'x'.repeat(4001) },
      { status: 'SIGNED' },
      { approved: true },
      { png: 'forged' },
    ])
      expect(() =>
        AcceptanceDto.absence({
          ...command,
          kind: 'ABSENT',
          reason: 'Synthetic absence',
          ...patch,
        }),
      ).toThrow();
  });

  it('requires independent review and invalidation reasons without forged decisions or timestamps', () => {
    expect(
      AcceptanceDto.review({ ...command, decision: 'APPROVED', reason: '  Reason considered  ' }),
    ).toEqual({ ...command, decision: 'APPROVED', reason: 'Reason considered' });
    for (const patch of [
      { decision: 'SIGNED' },
      { decision: true },
      { reason: '' },
      { reason: 'bad\0reason' },
      { reviewedAt: '2030-01-07T08:00:00Z' },
      { reviewerId: 'forged' },
    ])
      expect(() =>
        AcceptanceDto.review({
          ...command,
          decision: 'REJECTED',
          reason: 'Explicit decision',
          ...patch,
        }),
      ).toThrow();
    expect(
      AcceptanceDto.invalidate({ ...command, reason: '  Correct the prepared document  ' }),
    ).toEqual({ ...command, reason: 'Correct the prepared document' });
    expect(() => AcceptanceDto.invalidate({ ...command, reason: '' })).toThrow();
    expect(() =>
      AcceptanceDto.invalidate({
        ...command,
        reason: 'Correction',
        invalidatedAt: '2030-01-07T08:00:00Z',
      }),
    ).toThrow();
  });

  it('makes prepare an explicit minimal POST command and rejects a client-supplied snapshot or hash', () => {
    expect(AcceptanceDto.prepare({ operationKey: command.operationKey })).toEqual({
      operationKey: command.operationKey,
    });
    for (const field of [
      'payload',
      'snapshot',
      'hash',
      'snapshotHash',
      'createdBy',
      'createdAt',
      'version',
      'orderId',
    ])
      expect(() =>
        AcceptanceDto.prepare({ operationKey: command.operationKey, [field]: 'forged' }),
      ).toThrow();
    expect(() => AcceptanceDto.prepare({ operationKey: '../unsafe' })).toThrow();
  });
});
