import type {
  AcceptanceDocumentRecord,
  AcceptanceSlotRecord,
  BackofficeAcceptanceResponse,
  CrewAcceptanceResponse,
  IssueResponse,
  SignAcceptanceCommand,
} from '@furniture-delivery/contracts';
import { request as httpRequest } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { AcceptanceSnapshot } from '../src/acceptance/acceptance-snapshot.entity';
import { SignatureConfirmation } from '../src/acceptance/signature-confirmation.entity';
import { ExceptionReview } from '../src/acceptance/exception-review.entity';
import { canonicalAcceptance } from '../src/acceptance/acceptance-payload';
import * as pngDecoder from '../src/acceptance/signature-png';
import { Crew } from '../src/crews/crew.entity';
import { CrewMember } from '../src/identity/crew-member.entity';
import { User } from '../src/identity/user.entity';
import { AuthSession } from '../src/identity/auth-session.entity';
import { ActivityLog } from '../src/orders/activity-log.entity';
import { EvidenceReceipt } from '../src/evidence/evidence-receipt.entity';
import {
  createEvidenceFixture,
  evidenceJson as json,
  freshOperation,
  safeEvidence,
  type EvidenceActor,
  type EvidenceContext,
  type EvidenceFixture,
} from './evidence-fixture';
import {
  animatedSignaturePng,
  bytesHash,
  completedAcceptanceVisit,
  completeAcceptanceTasks,
  finishAcceptanceTeam,
  setAcceptanceQuantities,
  signatureForm,
  syntheticSignature,
} from './acceptance-fixture';

type AcceptanceResponse = BackofficeAcceptanceResponse | CrewAcceptanceResponse;
const NOW = '2030-01-07T08:00:00.000Z';
describe('M7 immutable visit acceptance and protected synthetic signatures on isolated PostgreSQL', () => {
  let f: EvidenceFixture, strokes: Buffer;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    f = await createEvidenceFixture('m7_accept', (config, root) => ({
      ...config,
      storage: { root },
    }));
    strokes = await syntheticSignature();
  }, 30000);
  beforeEach(() => vi.setSystemTime(new Date(NOW)));
  afterAll(async () => {
    await f?.close();
    vi.useRealTimers();
  });

  const backofficePath = (ctx: EvidenceContext) =>
    '/orders/' + ctx.order.id + '/appointments/' + ctx.appointmentId + '/acceptance';
  const read = async (ctx: EvidenceContext, actor = f.dispatcher, assignmentId?: string) =>
    await json<AcceptanceResponse>(
      await f.call(actor, assignmentId ? f.path(assignmentId, '/acceptance') : backofficePath(ctx)),
    );
  const prepare = (
    ctx: EvidenceContext,
    actor = f.dispatcher,
    assignmentId?: string,
    operationKey = freshOperation(),
  ) =>
    f.call(
      actor,
      assignmentId ? f.path(assignmentId, '/acceptance') : backofficePath(ctx),
      'POST',
      { operationKey },
    );
  const prepared = async (ctx: EvidenceContext) =>
    (await json<BackofficeAcceptanceResponse>(await prepare(ctx))).acceptance.current!;
  const slotPath = (doc: AcceptanceDocumentRecord, slot: AcceptanceSlotRecord, action: string) =>
    '/acceptance/' + doc.snapshot.id + '/slots/' + slot.id + '/' + action;
  const signBody = (
    doc: AcceptanceDocumentRecord,
    slot: AcceptanceSlotRecord,
    change: Partial<SignAcceptanceCommand> = {},
  ): SignAcceptanceCommand => ({
    operationKey: freshOperation(),
    expectedVersion: doc.snapshot.version,
    consent: true,
    ...(slot.kind === 'CUSTOMER'
      ? { customerName: 'Synthetic customer signer', customerRelation: 'Representative' }
      : {}),
    ...change,
  });
  const sign = (
    doc: AcceptanceDocumentRecord,
    slot: AcceptanceSlotRecord,
    actor: EvidenceActor,
    change: Partial<SignAcceptanceCommand> = {},
    png = strokes,
  ) =>
    f.call(
      actor,
      slotPath(doc, slot, 'sign'),
      'POST',
      signatureForm(signBody(doc, slot, change), png),
    );
  const customer = (doc: AcceptanceDocumentRecord) =>
    doc.slots.find((slot) => slot.kind === 'CUSTOMER')!;
  const staff = (doc: AcceptanceDocumentRecord, assignmentId: string) =>
    doc.slots.find((slot) => slot.assignmentId === assignmentId)!;
  const absence = (
    doc: AcceptanceDocumentRecord,
    slot: AcceptanceSlotRecord,
    actor: EvidenceActor,
    operationKey = freshOperation(),
  ) =>
    f.call(actor, slotPath(doc, slot, 'absence'), 'POST', {
      operationKey,
      expectedVersion: doc.snapshot.version,
      kind: 'ABSENT',
      reason: 'Synthetic signer was unavailable on this visit',
    });
  const review = (
    doc: AcceptanceDocumentRecord,
    slot: AcceptanceSlotRecord,
    decision: 'APPROVED' | 'REJECTED',
    actor = f.dispatcher,
    operationKey = freshOperation(),
  ) =>
    f.call(actor, slotPath(doc, slot, 'review'), 'POST', {
      operationKey,
      expectedVersion: doc.snapshot.version,
      decision,
      reason: 'Dispatcher explicitly considered this one absent confirmation',
    });
  const invalidate = (doc: AcceptanceDocumentRecord, operationKey = freshOperation()) =>
    f.call(f.dispatcher, '/acceptance/' + doc.snapshot.id + '/invalidate', 'POST', {
      operationKey,
      expectedVersion: doc.snapshot.version,
      reason: 'Correct the fictional prepared result explicitly',
    });
  const content = (doc: AcceptanceDocumentRecord, confirmationId: string, actor?: EvidenceActor) =>
    f.call(actor, '/acceptance/' + doc.snapshot.id + '/signatures/' + confirmationId + '/content');

  it('blocks a shared snapshot until all teams are terminal without preventing the first team from finishing', async () => {
    const ctx = await f.context({ crews: 2 });
    await f.start(ctx);
    await completeAcceptanceTasks(f, ctx.actors[0]![0]!, ctx.assignmentIds[0]!);
    await setAcceptanceQuantities(f, ctx.actors[0]![0]!, ctx.assignmentIds[0]!);
    await finishAcceptanceTeam(f, ctx);
    const state = await read(ctx, ctx.actors[0]![0]!, ctx.assignmentIds[0]!);
    expect(state.acceptance.canPrepare).toBe(false);
    expect(state.acceptance.preparationBlockedReason).toBeTruthy();
    expect(state.acceptance.current).toBeNull();
    expect((await prepare(ctx)).status).toBe(409);
    expect((await f.detail(ctx.actors[0]![0]!, ctx.assignmentIds[0]!)).execution.status).toBe(
      'COMPLETED',
    );
    expect((await f.detail(ctx.actors[1]![0]!, ctx.assignmentIds[1]!)).execution.status).toBe(
      'NOT_STARTED',
    );
    await f.start(ctx, 1);
    await completeAcceptanceTasks(f, ctx.actors[1]![0]!, ctx.assignmentIds[1]!);
    await finishAcceptanceTeam(f, ctx, 1);
    expect((await prepared(ctx)).slots).toHaveLength(3);
  });

  it('prepares once explicitly, keeps GET read-only and derives a canonical hash and one slot per participating team plus one customer', async () => {
    const ctx = await completedAcceptanceVisit(f, 2),
      before = await f.history(ctx.order.id);
    const empty = await read(ctx);
    expect(empty.acceptance.current).toBeNull();
    expect(empty.acceptance.canPrepare).toBe(true);
    expect(
      await f.source
        .getRepository(AcceptanceSnapshot)
        .countBy({ appointmentId: ctx.appointmentId }),
    ).toBe(0);
    expect(await f.history(ctx.order.id)).toBe(before);
    const key = freshOperation(),
      first = await json<BackofficeAcceptanceResponse>(
        await prepare(ctx, f.dispatcher, undefined, key),
      );
    const doc = first.acceptance.current!;
    expect(doc.slots.filter((slot) => slot.kind === 'CUSTOMER')).toHaveLength(1);
    expect(
      doc.slots
        .filter((slot) => slot.kind === 'CREW')
        .map((slot) => slot.assignmentId)
        .sort(),
    ).toEqual(ctx.assignmentIds.slice().sort());
    expect(doc.snapshot.hash).toBe(
      bytesHash(Buffer.from(canonicalAcceptance(doc.snapshot.payload))),
    );
    const count = await f.history(ctx.order.id);
    const replay = await json<BackofficeAcceptanceResponse>(
      await prepare(ctx, f.dispatcher, undefined, key),
    );
    expect(replay.receipt?.id).toBe(first.receipt?.id);
    expect(replay.acceptance.current).toEqual(doc);
    await prepare(ctx, f.dispatcher, undefined, freshOperation());
    await read(ctx);
    expect(
      await f.source
        .getRepository(AcceptanceSnapshot)
        .countBy({ appointmentId: ctx.appointmentId }),
    ).toBe(1);
    expect(await f.history(ctx.order.id)).toBe(count);
    safeEvidence(doc);
  });

  it('freezes each team’s report quantities separately rather than adding them or replacing the earlier report with current totals', async () => {
    const ctx = await f.context({ crews: 2 });
    await f.start(ctx);
    await completeAcceptanceTasks(f, ctx.actors[0]![0]!, ctx.assignmentIds[0]!);
    await setAcceptanceQuantities(f, ctx.actors[0]![0]!, ctx.assignmentIds[0]!, false);
    const first = await finishAcceptanceTeam(f, ctx, 0, 'PARTIALLY_COMPLETED');
    vi.setSystemTime(new Date('2030-01-07T08:10:00.000Z'));
    await f.start(ctx, 1);
    await completeAcceptanceTasks(f, ctx.actors[1]![0]!, ctx.assignmentIds[1]!);
    await setAcceptanceQuantities(f, ctx.actors[1]![0]!, ctx.assignmentIds[1]!);
    const second = await finishAcceptanceTeam(f, ctx, 1),
      doc = await prepared(ctx);
    const one = doc.snapshot.payload.teams.find(
        (team) => team.assignmentId === ctx.assignmentIds[0],
      )!,
      two = doc.snapshot.payload.teams.find((team) => team.assignmentId === ctx.assignmentIds[1])!;
    expect(one.quantities).toEqual(first.finishReport!.quantities);
    expect(two.quantities).toEqual(second.finishReport!.quantities);
    expect(one.quantities[0]!.deliveredQuantity).toBe(1);
    expect(two.quantities[0]!.deliveredQuantity).toBe(3);
    expect(one.outcome).toBe('PARTIALLY_COMPLETED');
    expect(doc.snapshot.payload.confirmation.text).toMatch(/partial|remaining/i);
    safeEvidence(doc);
  });

  it('keeps partial/blocked facts and issues unchanged after acknowledgement, and never includes private issue or evidence material in the common snapshot', async () => {
    const ctx = await f.context(),
      actor = ctx.actors[0]![0]!,
      id = ctx.assignmentIds[0]!;
    await f.depart(ctx);
    const terminal = await finishAcceptanceTeam(f, ctx, 0, 'BLOCKED', true);
    const publicIssue = await json<IssueResponse>(
      await f.call(actor, f.path(id, '/issues'), 'POST', {
        operationKey: freshOperation(),
        type: 'ACCESS_PROBLEM',
        description: 'Fictional shared access problem',
        reportedSource: 'CREW',
      }),
    );
    await json<IssueResponse>(
      await f.call(f.dispatcher, '/orders/' + ctx.order.id + '/issues', 'POST', {
        operationKey: freshOperation(),
        type: 'OTHER',
        description: 'PRIVATE FINANCIAL EVIDENCE FIXTURE',
        reportedSource: 'CUSTOMER',
        visibility: 'BACKOFFICE_ONLY',
      }),
    );
    const doc = await prepared(ctx),
      frozen = structuredClone(doc.snapshot);
    expect(doc.snapshot.payload.issues.map((issue) => issue.id)).toEqual([publicIssue.issue.id]);
    await json<AcceptanceResponse>(await sign(doc, customer(doc), actor));
    await f.call(f.dispatcher, '/orders/' + ctx.order.id + '/notes', 'POST', {
      operationKey: freshOperation(),
      text: 'PRIVATE FINANCIAL EVIDENCE FIXTURE',
    });
    await json<IssueResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + ctx.order.id + '/issues/' + publicIssue.issue.id + '/resolve',
        'POST',
        {
          operationKey: freshOperation(),
          expectedVersion: publicIssue.issue.version,
          reason: 'Synthetic shared access issue considered',
        },
      ),
    );
    const reread = await read(ctx);
    expect(reread.acceptance.current!.snapshot).toEqual(frozen);
    expect(reread.acceptance.current!.snapshot.payload.issues[0]!.status).toBe('OPEN');
    const facts = await f.detail(actor, id);
    expect(facts.finishReport).toEqual(terminal.finishReport);
    expect(facts.items).toEqual(terminal.items);
    expect(facts.tasks).toEqual(terminal.tasks);
    expect(facts.returnVisitRequired).toBe(true);
    safeEvidence(reread);
  });

  it('uses current database staff identity, independent slots and declared customer identity without exposing the other team’s staff image metadata', async () => {
    const ctx = await completedAcceptanceVisit(f, 2),
      doc = await prepared(ctx),
      own = staff(doc, ctx.assignmentIds[0]!),
      other = staff(doc, ctx.assignmentIds[1]!);
    const first = await json<CrewAcceptanceResponse>(await sign(doc, own, ctx.actors[0]![0]!));
    const signed = first.acceptance.current!.slots.find(
      (slot) => slot.id === own.id,
    )!.confirmation!;
    expect(signed.signerName).toBe(ctx.actors[0]![0]!.user.displayName);
    expect(signed.capturedByUserId).toBe(ctx.actors[0]![0]!.user.id);
    expect(signed.recordedAt).toBe(NOW);
    expect(signed.snapshotHash).toBe(doc.snapshot.hash);
    expect((await sign(doc, other, ctx.actors[0]![0]!)).status).toBe(403);
    expect((await sign(doc, other, f.dispatcher)).status).toBe(403);
    await json<CrewAcceptanceResponse>(await sign(doc, other, ctx.actors[1]![0]!));
    const customerSigned = await json<CrewAcceptanceResponse>(
      await sign(doc, customer(doc), ctx.actors[0]![0]!),
    );
    const record = customerSigned.acceptance.current!.slots.find(
      (slot) => slot.kind === 'CUSTOMER',
    )!.confirmation!;
    expect(record.signerName).toBe('Synthetic customer signer');
    expect(record.signerRelation).toBe('Representative');
    expect(record.capturedByUserId).toBe(ctx.actors[0]![0]!.user.id);
    const crewRead = await read(ctx, ctx.actors[0]![0]!, ctx.assignmentIds[0]!);
    const hidden = crewRead.acceptance.current!.slots.find((slot) => slot.id === other.id)!;
    expect(hidden.status).toBe('SIGNED');
    expect(hidden.confirmation).toBeNull();
    expect(hidden.exception).toBeNull();
    expect(hidden.canReadImage).toBe(false);
    safeEvidence(crewRead);
    expect(JSON.stringify(crewRead)).not.toMatch(/"(?:png|base64|canonical|sourceDigest)"/);
  });

  it('rejects missing name/consent/file, blank/transparent/invalid/animated/oversized PNG without storing any confirmation', async () => {
    const ctx = await completedAcceptanceVisit(f),
      doc = await prepared(ctx),
      slot = customer(doc),
      actor = ctx.actors[0]![0]!;
    expect((await sign(doc, slot, actor, { customerName: undefined })).status).toBe(400);
    const noConsent = { ...signBody(doc, slot), consent: false };
    expect(
      (await f.call(actor, slotPath(doc, slot, 'sign'), 'POST', signatureForm(noConsent, strokes)))
        .status,
    ).toBe(400);
    const noFile = new FormData();
    noFile.append('payload', JSON.stringify(signBody(doc, slot)));
    expect((await f.call(actor, slotPath(doc, slot, 'sign'), 'POST', noFile)).status).toBe(400);
    const blank = await sharp({
      create: { width: 100, height: 50, channels: 4, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const transparent = await sharp({
      create: {
        width: 100,
        height: 50,
        channels: 4,
        background: { r: 10, g: 30, b: 50, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    for (const image of [
      blank,
      transparent,
      Buffer.from('invalid synthetic image'),
      animatedSignaturePng(strokes),
      await syntheticSignature(2049, 20),
    ])
      expect((await sign(doc, slot, actor, {}, image)).status).toBe(400);
    expect((await sign(doc, slot, actor, {}, Buffer.alloc(256 * 1024 + 1))).status).toBe(413);
    expect(
      await f.source.getRepository(SignatureConfirmation).countBy({ snapshotId: doc.snapshot.id }),
    ).toBe(0);
  });

  it('rejects chunked or oversized declared requests before multipart parsing or preparing any result', async () => {
    const ctx = await completedAcceptanceVisit(f),
      actor = ctx.actors[0]![0]!,
      before = await f.history(ctx.order.id);
    for (const oversized of [false, true]) {
      const status = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          f.base + '/api/acceptance/' + freshOperation() + '/slots/' + freshOperation() + '/sign',
          {
            method: 'POST',
            headers: {
              Origin: 'http://127.0.0.1:3000',
              'X-CSRF-Protection': '1',
              Cookie: actor.cookie,
              'Content-Type': 'multipart/form-data; boundary=synthetic-signature-boundary',
              ...(oversized
                ? { 'Content-Length': String(272 * 1024 + 1) }
                : { 'Transfer-Encoding': 'chunked' }),
            },
          },
          (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode!));
          },
        );
        request.on('error', reject);
        request.setTimeout(8000, () =>
          request.destroy(new Error('The bounded signature upload request timed out')),
        );
        request.write('--synthetic-signature-boundary\r\n');
        request.end('--synthetic-signature-boundary--\r\n');
      });
      expect(status).toBe(oversized ? 413 : 411);
    }
    expect(
      await f.source
        .getRepository(AcceptanceSnapshot)
        .countBy({ appointmentId: ctx.appointmentId }),
    ).toBe(0);
    expect(await f.history(ctx.order.id)).toBe(before);
  });

  it('serializes concurrent signing by two permitted users into one PNG, one slot record and one audit effect', async () => {
    const ctx = await completedAcceptanceVisit(f),
      doc = await prepared(ctx),
      slot = customer(doc),
      before = await f.history(ctx.order.id);
    const result = await f.overlap(
      'delivery_order',
      ctx.order.id,
      () => sign(doc, slot, ctx.actors[0]![0]!),
      () => sign(doc, slot, ctx.actors[0]![1]!),
    );
    expect(result.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await f.source.getRepository(SignatureConfirmation).countBy({ slotId: slot.id })).toBe(
      1,
    );
    expect(await f.history(ctx.order.id)).toBe(before + 1);
    const rows = (await f.source.query(
      `SELECT count(*)::int AS count, sum(octet_length(png))::int AS bytes FROM "${f.schema}".signature_confirmation WHERE slot_id=$1`,
      [slot.id],
    )) as { count: number; bytes: number }[];
    expect(rows[0]!.count).toBe(1);
    expect(rows[0]!.bytes).toBeGreaterThan(0);
    expect(rows[0]!.bytes).toBeLessThanOrEqual(256 * 1024);
  });

  it('retries the exact signed operation without a second image or audit and rejects changed payload under the same key', async () => {
    const ctx = await completedAcceptanceVisit(f),
      doc = await prepared(ctx),
      slot = staff(doc, ctx.assignmentIds[0]!),
      actor = ctx.actors[0]![0]!,
      key = freshOperation();
    const first = await json<CrewAcceptanceResponse>(
        await sign(doc, slot, actor, { operationKey: key }),
      ),
      count = await f.history(ctx.order.id);
    const replay = await json<CrewAcceptanceResponse>(
      await sign(doc, slot, actor, { operationKey: key }),
    );
    expect(replay.receipt?.id).toBe(first.receipt?.id);
    expect(
      replay.acceptance.current!.slots.find((entry) => entry.id === slot.id)!.confirmation!.id,
    ).toBe(first.acceptance.current!.slots.find((entry) => entry.id === slot.id)!.confirmation!.id);
    expect(await f.history(ctx.order.id)).toBe(count);
    expect(
      (
        await sign(doc, slot, actor, {
          operationKey: key,
          customerRelation: 'Different retry metadata',
        })
      ).status,
    ).toBe(409);
    expect(await f.source.getRepository(SignatureConfirmation).countBy({ slotId: slot.id })).toBe(
      1,
    );
  });

  it('records absence separately, requires dispatcher review per slot and never lets one approved exception cover the other missing requirements', async () => {
    const ctx = await completedAcceptanceVisit(f, 2),
      doc = await prepared(ctx),
      slot = customer(doc),
      actor = ctx.actors[0]![0]!,
      key = freshOperation();
    const reported = await json<CrewAcceptanceResponse>(await absence(doc, slot, actor, key)),
      pending = reported.acceptance.current!.slots.find((entry) => entry.id === slot.id)!;
    expect(pending.status).toBe('PENDING_REVIEW');
    expect(pending.confirmation!.method).toBe('ABSENCE');
    expect(pending.confirmation!.imageDigest).toBeNull();
    expect((await review(doc, slot, 'APPROVED', actor)).status).toBe(403);
    const approved = await json<BackofficeAcceptanceResponse>(await review(doc, slot, 'APPROVED'));
    expect(approved.acceptance.current!.slots.find((entry) => entry.id === slot.id)!.status).toBe(
      'EXCEPTION_APPROVED',
    );
    expect(
      approved.acceptance
        .current!.slots.filter((entry) => entry.kind === 'CREW')
        .every((entry) => entry.status === 'MISSING'),
    ).toBe(true);
    expect(await f.source.getRepository(ExceptionReview).countBy({ slotId: slot.id })).toBe(1);
    expect((await content(doc, pending.confirmation!.id, actor)).status).toBe(404);
    expect(
      (await json<CrewAcceptanceResponse>(await absence(doc, slot, actor, key))).receipt?.id,
    ).toBe(reported.receipt?.id);
  });

  it('keeps a rejected exception distinct from a signature and requires explicit invalidation rather than silently replacing its decision', async () => {
    const ctx = await completedAcceptanceVisit(f),
      doc = await prepared(ctx),
      slot = customer(doc);
    await json<AcceptanceResponse>(await absence(doc, slot, ctx.actors[0]![0]!));
    const rejected = await json<BackofficeAcceptanceResponse>(await review(doc, slot, 'REJECTED'));
    expect(rejected.acceptance.current!.slots.find((entry) => entry.id === slot.id)!.status).toBe(
      'EXCEPTION_REJECTED',
    );
    expect((await review(doc, slot, 'APPROVED')).status).toBe(409);
    expect((await sign(doc, slot, ctx.actors[0]![0]!)).status).toBe(409);
  });

  it('checks content authorization on each read, exposes only own staff/customer images and denies transferred or logged-out users', async () => {
    const ctx = await completedAcceptanceVisit(f, 2),
      doc = await prepared(ctx),
      own = staff(doc, ctx.assignmentIds[0]!),
      actor = ctx.actors[0]![0]!;
    const signed = await json<CrewAcceptanceResponse>(await sign(doc, own, actor)),
      confirmation = signed.acceptance.current!.slots.find(
        (slot) => slot.id === own.id,
      )!.confirmation!;
    const readImage = await content(doc, confirmation.id, actor);
    expect(readImage.status).toBe(200);
    expect(readImage.headers.get('content-type')).toMatch(/^image\/png/);
    expect(readImage.headers.get('cache-control')).toMatch(/\bno-store\b/);
    expect(readImage.headers.get('x-content-type-options')).toBe('nosniff');
    expect(bytesHash(new Uint8Array(await readImage.arrayBuffer()))).toBe(confirmation.imageDigest);
    expect((await content(doc, confirmation.id, f.dispatcher)).status).toBe(200);
    expect((await content(doc, confirmation.id, ctx.actors[1]![0]!)).status).toBe(404);
    const foreign = await completedAcceptanceVisit(f),
      foreignDoc = await prepared(foreign);
    expect((await content(foreignDoc, confirmation.id, f.dispatcher)).status).toBe(404);
    await f.source
      .getRepository(CrewMember)
      .update({ userId: actor.user.id, crewId: ctx.crews[0]!.id }, { active: false });
    expect((await content(doc, confirmation.id, actor)).status).toBe(404);
    const colleague = ctx.actors[0]![1]!;
    expect((await content(doc, confirmation.id, colleague)).status).toBe(200);
    expect((await f.call(colleague, '/auth/logout', 'POST')).status).toBe(200);
    expect((await content(doc, confirmation.id, colleague)).status).toBe(401);
    expect((await content(doc, confirmation.id)).status).toBe(401);
  });

  it('permits an active member of a disabled team to acknowledge its completed work but rejects current forbidden roles and Origin/CSRF', async () => {
    const ctx = await completedAcceptanceVisit(f),
      doc = await prepared(ctx),
      slot = staff(doc, ctx.assignmentIds[0]!),
      actor = ctx.actors[0]![0]!;
    expect(
      (
        await f.call(
          actor,
          slotPath(doc, slot, 'sign'),
          'POST',
          signatureForm(signBody(doc, slot), strokes),
          { Origin: 'https://untrusted.example.invalid' },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.call(
          actor,
          slotPath(doc, slot, 'absence'),
          'POST',
          {
            operationKey: freshOperation(),
            expectedVersion: doc.snapshot.version,
            kind: 'ABSENT',
            reason: 'Synthetic absence',
          },
          { 'X-CSRF-Protection': '' },
        )
      ).status,
    ).toBe(403);
    await f.source.getRepository(Crew).update(ctx.crews[0]!.id, { active: false });
    await json<CrewAcceptanceResponse>(await sign(doc, slot, actor));
    await f.source.getRepository(User).update(actor.user.id, { active: false });
    expect((await f.call(actor, f.path(ctx.assignmentIds[0]!, '/acceptance'))).status).toBe(401);
  });

  it('rechecks session expiry after real PNG decoding and waiting for the Order lock', async () => {
    const ctx = await completedAcceptanceVisit(f),
      doc = await prepared(ctx),
      slot = customer(doc),
      actor = ctx.actors[0]![0]!;
    await f.source
      .getRepository(AuthSession)
      .update({ userId: actor.user.id }, { expiresAt: new Date('2030-01-07T08:01:00.000Z') });
    const held = await f.barrier('delivery_order', ctx.order.id),
      pending = sign(doc, slot, actor);
    try {
      await f.waiters(held.pid, 1);
      vi.setSystemTime(new Date('2030-01-07T08:02:00.000Z'));
    } finally {
      await held.runner.rollbackTransaction();
      await held.runner.release();
    }
    expect((await pending).status).toBe(401);
    expect(await f.source.getRepository(SignatureConfirmation).countBy({ slotId: slot.id })).toBe(
      0,
    );
  });

  it('rechecks membership and user activity after the real decoder returns, before any signature transaction commits', async () => {
    for (const change of ['membership', 'disabled'] as const) {
      const ctx = await completedAcceptanceVisit(f),
        doc = await prepared(ctx),
        slot = staff(doc, ctx.assignmentIds[0]!),
        actor = ctx.actors[0]![0]!;
      const realDecode = pngDecoder.decodeSignaturePng;
      let entered!: () => void, release!: () => void;
      const observed = new Promise<void>((resolve) => {
          entered = resolve;
        }),
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
      const spy = vi.spyOn(pngDecoder, 'decodeSignaturePng').mockImplementation(async (input) => {
        const decoded = await realDecode(input);
        entered();
        await gate;
        return decoded;
      });
      const pending = sign(doc, slot, actor);
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          observed,
          new Promise<never>((_, reject) => {
            deadline = setTimeout(
              () => reject(new Error('The signature must reach the bounded real decode gate')),
              1200,
            );
          }),
        ]);
        if (change === 'membership')
          await f.source
            .getRepository(CrewMember)
            .update({ userId: actor.user.id, crewId: ctx.crews[0]!.id }, { active: false });
        else await f.source.getRepository(User).update(actor.user.id, { active: false });
      } finally {
        if (deadline) clearTimeout(deadline);
        release();
        spy.mockRestore();
      }
      expect((await pending).status).toBe(change === 'membership' ? 404 : 401);
      expect(await f.source.getRepository(SignatureConfirmation).countBy({ slotId: slot.id })).toBe(
        0,
      );
    }
  });

  it('retains invalidated snapshots and old signed bytes, requires new confirmations and never revives a document through an old successful retry', async () => {
    const ctx = await completedAcceptanceVisit(f),
      doc = await prepared(ctx),
      slot = staff(doc, ctx.assignmentIds[0]!),
      actor = ctx.actors[0]![0]!,
      key = freshOperation();
    const signed = await json<CrewAcceptanceResponse>(
        await sign(doc, slot, actor, { operationKey: key }),
      ),
      confirmation = signed.acceptance.current!.slots.find(
        (entry) => entry.id === slot.id,
      )!.confirmation!;
    const invalidated = await json<BackofficeAcceptanceResponse>(await invalidate(doc));
    expect(invalidated.acceptance.current).toBeNull();
    expect(
      invalidated.acceptance.history.find((entry) => entry.snapshot.id === doc.snapshot.id)!
        .snapshot.invalidatedAt,
    ).toBe(NOW);
    expect((await content(doc, confirmation.id, actor)).status).toBe(200);
    const replay = await json<CrewAcceptanceResponse>(
      await sign(doc, slot, actor, { operationKey: key }),
    );
    expect(replay.receipt?.id).toBe(signed.receipt?.id);
    expect(replay.acceptance.current).toBeNull();
    const next = await prepared(ctx);
    expect(next.snapshot.id).not.toBe(doc.snapshot.id);
    expect(next.snapshot.version).toBe(doc.snapshot.version + 1);
    expect(
      next.slots.every(
        (entry) =>
          entry.status === 'MISSING' && entry.confirmation === null && entry.exception === null,
      ),
    ).toBe(true);
    expect(
      await f.source.getRepository(SignatureConfirmation).countBy({ snapshotId: doc.snapshot.id }),
    ).toBe(1);
  });

  it('rolls back signed PNG bytes, confirmation and durable receipt when the audit insert fails', async () => {
    const ctx = await completedAcceptanceVisit(f),
      doc = await prepared(ctx),
      slot = staff(doc, ctx.assignmentIds[0]!),
      actor = ctx.actors[0]![0]!,
      key = freshOperation();
    await f.source.query(
      `CREATE FUNCTION "${f.schema}".reject_signature_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id='${ctx.order.id}'::uuid THEN RAISE EXCEPTION 'fixture signature audit unavailable'; END IF; RETURN NEW; END $$`,
    );
    await f.source.query(
      `CREATE TRIGGER signature_audit_failure BEFORE INSERT ON "${f.schema}".activity_log FOR EACH ROW EXECUTE FUNCTION "${f.schema}".reject_signature_audit()`,
    );
    const count = await f.history(ctx.order.id),
      receipts = await f.source.getRepository(EvidenceReceipt).countBy({ orderId: ctx.order.id });
    try {
      expect((await sign(doc, slot, actor, { operationKey: key })).status).toBe(500);
      expect(
        await f.source
          .getRepository(SignatureConfirmation)
          .countBy({ snapshotId: doc.snapshot.id }),
      ).toBe(0);
      expect(await f.source.getRepository(EvidenceReceipt).countBy({ orderId: ctx.order.id })).toBe(
        receipts,
      );
      expect(await f.source.getRepository(ActivityLog).countBy({ orderId: ctx.order.id })).toBe(
        count,
      );
    } finally {
      await f.source.query(`DROP TRIGGER signature_audit_failure ON "${f.schema}".activity_log`);
      await f.source.query(`DROP FUNCTION "${f.schema}".reject_signature_audit()`);
    }
    expect((await sign(doc, slot, actor, { operationKey: key })).status).toBe(200);
    expect(await f.source.getRepository(SignatureConfirmation).countBy({ slotId: slot.id })).toBe(
      1,
    );
  });
});
