import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { EvidenceDto } from '../src/evidence/evidence.dto';
import {
  evidenceFingerprint,
  findEvidenceReceipt,
  mapEvidenceReceipt,
} from '../src/evidence/evidence-receipts';
import { EvidenceReceipt } from '../src/evidence/evidence-receipt.entity';
import { Attachment } from '../src/evidence/attachment.entity';
import { mapAttachment } from '../src/evidence/evidence-projection';
const itemA = 'bd140c00-6699-4b75-9239-5beffbb305b9',
  itemB = 'a0238e78-2218-43f9-a1b2-3dd01113c589';
const note = { operationKey: 'evidence-unit-note', text: '  Furniture checked\nPhoto follows.  ' };
const issue = {
  operationKey: 'evidence-unit-issue',
  type: 'DAMAGE',
  description: 'Table leg is damaged',
  reportedSource: 'CREW',
  itemIds: [itemA, itemB],
};
describe('M5 evidence request boundaries', () => {
  it('uses safe defaults, trims text and derives crew visibility rather than accepting authority', () => {
    expect(EvidenceDto.note(note)).toMatchObject({
      text: 'Furniture checked\nPhoto follows.',
      visibility: 'BACKOFFICE_ONLY',
    });
    expect(EvidenceDto.note(note, true)).toMatchObject({ visibility: 'CREW_VISIBLE' });
    expect(() => EvidenceDto.note({ ...note, visibility: null })).toThrow();
    for (const field of [
      'authorId',
      'orderId',
      'crewId',
      'createdAt',
      'storageKey',
      'fingerprint',
      'html',
    ])
      expect(() => EvidenceDto.note({ ...note, [field]: itemA })).toThrow();
    for (const field of ['assignmentId', 'appointmentId', 'visibility'])
      expect(() => EvidenceDto.note({ ...note, [field]: itemA }, true)).toThrow();
    expect(
      EvidenceDto.note({ ...note, assignmentId: itemA, visibility: 'CREW_VISIBLE' }),
    ).toMatchObject({ assignmentId: itemA, visibility: 'CREW_VISIBLE' });
    for (const text of ['', '  ', 'x'.repeat(4001), 'bad\0text', null, 3])
      expect(() => EvidenceDto.note({ ...note, text })).toThrow();
  });
  it('normalizes issue links and rejects duplicates, forged source and unbounded payloads', () => {
    expect(EvidenceDto.issue(issue, true)).toMatchObject({
      itemIds: [itemB, itemA],
      attachmentIds: [],
      visibility: 'CREW_VISIBLE',
    });
    expect(evidenceFingerprint(EvidenceDto.issue(issue, true))).toBe(
      evidenceFingerprint(EvidenceDto.issue({ ...issue, itemIds: [itemB, itemA] }, true)),
    );
    for (const patch of [
      { itemIds: [itemA, itemA] },
      { itemIds: ['foreign'] },
      { itemIds: [null] },
      { attachmentIds: Array.from({ length: 101 }, () => itemA) },
      { reportedSource: 'ADMIN' },
      { type: 'PAYMENT' },
      { visibility: 'PUBLIC' },
      { description: ' ' },
      { itemId: itemA },
    ])
      expect(() => EvidenceDto.issue({ ...issue, ...patch }, true)).toThrow();
    expect(() =>
      EvidenceDto.issue({ ...issue, itemIds: undefined, notes: 'x'.repeat(4001) }),
    ).toThrow();
    expect(EvidenceDto.issue({ ...issue, notes: '  ' })).toMatchObject({ notes: '' });
  });
  it('requires explicit version and reason for resolve/reopen but keeps append notes independent', () => {
    const command = {
      operationKey: 'evidence-unit-resolve',
      expectedVersion: 3,
      reason: '  Replacement supplied  ',
    };
    expect(EvidenceDto.command(command)).toEqual({ ...command, reason: 'Replacement supplied' });
    for (const patch of [
      { expectedVersion: 0 },
      { expectedVersion: 1.2 },
      { reason: '' },
      { status: 'RESOLVED' },
      { resolvedBy: itemA },
      { operationKey: '../unsafe' },
    ])
      expect(() => EvidenceDto.command({ ...command, ...patch })).toThrow();
    expect(EvidenceDto.issueNote(note)).toEqual({
      operationKey: note.operationKey,
      text: 'Furniture checked\nPhoto follows.',
    });
    expect(() => EvidenceDto.issueNote({ ...note, expectedVersion: 3 })).toThrow();
  });
  it('bounds the independent backoffice issue list and does not accept arbitrary order/member filters', () => {
    expect(EvidenceDto.query({})).toEqual({
      status: undefined,
      type: undefined,
      page: 1,
      pageSize: 20,
    });
    expect(
      EvidenceDto.query({ status: 'OPEN', type: 'DAMAGE', page: '2', pageSize: '100' }),
    ).toEqual({ status: 'OPEN', type: 'DAMAGE', page: 2, pageSize: 100 });
    for (const query of [
      { status: 'CLOSED' },
      { type: 'INTERNAL' },
      { page: '0' },
      { pageSize: '101' },
      { page: ['1', '2'] },
      { orderId: itemA },
      { crewId: itemA },
    ])
      expect(() => EvidenceDto.query(query)).toThrow();
  });
});
describe('M5 evidence receipts', () => {
  function fixture(receipt: EvidenceReceipt | null) {
    const builder = {
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(receipt),
    };
    const manager = {
      getRepository: vi.fn(() => ({ createQueryBuilder: vi.fn(() => builder) })),
    } as unknown as EntityManager;
    return { manager, builder };
  }
  const payload = { assignmentId: itemA, text: 'Same operation' };
  const receipt = Object.assign(new EvidenceReceipt(), {
    id: itemA,
    actorId: itemA,
    orderId: itemB,
    action: 'NOTE_CREATE',
    operationKey: 'private-unit-key',
    fingerprint: evidenceFingerprint(payload),
    resultId: itemB,
    createdAt: new Date('2030-06-01T08:00:00Z'),
  });
  it('matches the exact current scope and preserves canonical receipt identity', async () => {
    const { manager, builder } = fixture(receipt);
    expect(
      await findEvidenceReceipt(
        manager,
        itemA,
        itemB,
        'NOTE_CREATE',
        'private-unit-key',
        evidenceFingerprint(payload),
      ),
    ).toBe(receipt);
    expect(builder.where).toHaveBeenCalledWith(
      expect.stringContaining('receipt.orderId'),
      expect.objectContaining({
        actorId: itemA,
        orderId: itemB,
        action: 'NOTE_CREATE',
        operationKey: 'private-unit-key',
      }),
    );
    expect(mapEvidenceReceipt(receipt)).toEqual({
      id: itemA,
      action: 'NOTE_CREATE',
      resultId: itemB,
      createdAt: '2030-06-01T08:00:00.000Z',
    });
    expect(JSON.stringify(mapEvidenceReceipt(receipt))).not.toMatch(
      /fingerprint|operationKey|private-unit-key/,
    );
  });
  it('rejects changed details/target and treats missing receipt as a new operation', async () => {
    const { manager } = fixture(receipt);
    await expect(
      findEvidenceReceipt(
        manager,
        itemA,
        itemB,
        'NOTE_CREATE',
        'private-unit-key',
        evidenceFingerprint({ ...payload, assignmentId: itemB }),
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_KEY_REUSED' });
    const empty = fixture(null);
    expect(
      await findEvidenceReceipt(
        empty.manager,
        itemA,
        itemB,
        'NOTE_CREATE',
        'new-operation-key',
        evidenceFingerprint(payload),
      ),
    ).toBeNull();
  });
});

describe('M5 attachment projection privacy', () => {
  it('keeps withdrawal audit text private and derives protected content URLs from the authorized scope', () => {
    const file = Object.assign(new Attachment(), {
      id: itemA,
      orderId: itemB,
      appointmentId: null,
      assignmentId: null,
      itemId: null,
      visibility: 'CREW_VISIBLE',
      proofType: 'DAMAGE',
      kind: 'IMAGE',
      state: 'READY',
      displayName: 'damaged-table.webp',
      contentType: 'image/webp',
      sizeBytes: 120,
      width: 8,
      height: 8,
      authorId: itemA,
      createdAt: new Date('2030-06-01T08:00:00Z'),
      withdrawnAt: new Date('2030-06-01T09:00:00Z'),
      withdrawReason: 'Internal audit explanation',
      storageKey: 'private-storage-key',
      sourceHash: 'private-source-hash',
    });
    const crew = mapAttachment(file, { assignmentId: itemA });
    expect(crew.withdrawnAt).toBe('2030-06-01T09:00:00.000Z');
    expect(crew.withdrawReason).toBeNull();
    expect(crew.contentUrl).toBe(`/api/crew/assignments/${itemA}/attachments/${itemA}/content`);
    expect(JSON.stringify(crew)).not.toMatch(
      /Internal audit explanation|private-storage-key|private-source-hash|storageKey|sourceHash/,
    );
    expect(mapAttachment(file, { orderId: itemB }).withdrawReason).toBe(
      'Internal audit explanation',
    );
  });
});
