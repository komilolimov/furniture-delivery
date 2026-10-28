import { readdir } from 'node:fs/promises';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AttachmentResponse,
  CrewAssignmentResponse,
  EvidenceResponse,
  ExecutionNoteResponse,
  IssueResponse,
} from '@furniture-delivery/contracts';
import { Crew } from '../src/crews/crew.entity';
import { CrewMember } from '../src/identity/crew-member.entity';
import { PrivateStorage } from '../src/evidence/private-storage';
import { OrderDto } from '../src/orders/orders.dto';
import { seedCrews } from '../src/database/demo-crews';
import { demoUsers, seedIdentity } from '../src/database/demo-identity';
import { seedOrders } from '../src/database/demo-orders';
import { User } from '../src/identity/user.entity';
import { seedPlanningDefaults } from '../src/database/demo-planning';
import {
  createEvidenceFixture,
  evidenceJson as json,
  freshOperation,
  safeEvidence,
  type EvidenceActor,
  type EvidenceFixture,
} from './evidence-fixture';

const now = '2030-01-07T08:00:00.000Z';
const issueInput = (visibility?: 'BACKOFFICE_ONLY' | 'CREW_VISIBLE') => ({
  operationKey: freshOperation(),
  type: 'MISSING_PARTS',
  description: 'Fictional fitting issue',
  reportedSource: 'CREW',
  ...(visibility ? { visibility } : {}),
});
describe('M5 evidence cross-module authorization, history and financial isolation', () => {
  let f: EvidenceFixture, png: Buffer;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
    f = await createEvidenceFixture('m5_cross', (config, root) => ({
      ...config,
      storage: { root },
    }));
    png = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#875223' } })
      .png()
      .toBuffer();
  }, 30000);
  beforeEach(() => {
    vi.setSystemTime(new Date(now));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await f?.close();
    vi.useRealTimers();
  });
  function form(
    fields: Record<string, string>,
    content = png,
    name = 'fixture.png',
    type = 'image/png',
  ) {
    const value = new FormData();
    for (const [key, text] of Object.entries(fields)) value.append(key, text);
    value.append('file', new Blob([new Uint8Array(content)], { type }), name);
    return value;
  }
  const upload = (
    actor: EvidenceActor,
    path: string,
    metadata: Record<string, string>,
    content = png,
    name = 'fixture.png',
    type = 'image/png',
  ) => f.call(actor, path, 'POST', form(metadata, content, name, type));
  const contentPath = (url: string) => url.replace(/^\/api/, '');
  async function bytes(
    actor: EvidenceActor | undefined,
    url: string,
    headers: Record<string, string> = {},
    method = 'GET',
  ) {
    return f.call(actor, contentPath(url), method, undefined, headers);
  }
  async function countOrderFiles(orderId: string) {
    return (await f.source.query(
      `SELECT count(*)::int AS n FROM "${f.schema}".attachment WHERE order_id=$1`,
      [orderId],
    )) as { n: number }[];
  }
  it('keeps default-private files and notes private even through public issue parents and alternate assignment/thumbnail URLs', async () => {
    const ctx = await f.context({ crews: 2 }),
      foreign = await f.context(),
      actor = ctx.actors[0]![0]!,
      other = ctx.actors[1]![0]!,
      id = ctx.assignmentIds[0]!;
    await f.depart(ctx);
    const privateFile = await json<AttachmentResponse>(
      await upload(f.dispatcher, '/orders/' + ctx.order.id + '/attachments', {
        operationKey: freshOperation(),
      }),
    );
    expect(privateFile.attachment.visibility).toBe('BACKOFFICE_ONLY');
    const publicFile = await json<AttachmentResponse>(
      await upload(actor, f.path(id, '/attachments'), {
        operationKey: freshOperation(),
        proofType: 'DELIVERY',
      }),
    );
    const privateNote = await json<ExecutionNoteResponse>(
      await f.call(f.dispatcher, '/orders/' + ctx.order.id + '/notes', 'POST', {
        operationKey: freshOperation(),
        text: 'Private dispatcher-only clarification',
      }),
    );
    expect(privateNote.note.visibility).toBe('BACKOFFICE_ONLY');
    const foreignFile = await json<AttachmentResponse>(
      await upload(f.dispatcher, '/orders/' + foreign.order.id + '/attachments', {
        operationKey: freshOperation(),
        visibility: 'CREW_VISIBLE',
      }),
    );
    const read = await json<EvidenceResponse>(await f.call(actor, f.path(id, '/evidence')));
    safeEvidence(read);
    expect(read.attachments.map((a) => a.id)).toEqual([publicFile.attachment.id]);
    expect(read.notes).toEqual([]);
    expect(
      (await bytes(actor, f.path(id, '/attachments/' + privateFile.attachment.id + '/content')))
        .status,
    ).toBe(404);
    expect(
      (await bytes(actor, f.path(id, '/attachments/' + privateFile.attachment.id + '/thumbnail')))
        .status,
    ).toBe(404);
    expect(
      (await bytes(actor, f.path(id, '/attachments/' + foreignFile.attachment.id + '/content')))
        .status,
    ).toBe(404);
    expect((await bytes(actor, privateFile.attachment.contentUrl)).status).toBe(403);
    expect(
      (
        await f.call(actor, f.path(id, '/issues'), 'POST', {
          ...issueInput(),
          attachmentIds: [privateFile.attachment.id],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await f.call(f.dispatcher, '/orders/' + ctx.order.id + '/issues', 'POST', {
          ...issueInput('CREW_VISIBLE'),
          attachmentIds: [privateFile.attachment.id],
        })
      ).status,
    ).toBe(404);
    const link = await json<IssueResponse>(
      await f.call(actor, f.path(id, '/issues'), 'POST', {
        ...issueInput(),
        attachmentIds: [publicFile.attachment.id],
      }),
    );
    expect(link.issue.attachmentIds).toEqual([publicFile.attachment.id]);
    const permitted = await bytes(
      other,
      f.path(ctx.assignmentIds[1]!, '/attachments/' + publicFile.attachment.id + '/content'),
    );
    expect(permitted.status).toBe(200);
    expect(permitted.headers.get('content-type')).toBe('image/webp');
    expect(permitted.headers.get('x-content-type-options')).toBe('nosniff');
    expect(permitted.headers.get('cache-control')).toContain('no-store');
    expect((await permitted.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
  it('rechecks session and membership for old content, thumbnail, HEAD/Range and receipt URLs', async () => {
    const ctx = await f.context(),
      actor = ctx.actors[0]![0]!,
      second = ctx.actors[0]![1]!,
      id = ctx.assignmentIds[0]!;
    await f.depart(ctx);
    const key = freshOperation(),
      saved = await json<AttachmentResponse>(
        await upload(second, f.path(id, '/attachments'), {
          operationKey: key,
          proofType: 'ASSEMBLY',
        }),
      );
    expect((await bytes(actor, saved.attachment.contentUrl)).status).toBe(200);
    expect((await f.call(actor, '/auth/logout', 'POST')).status).toBe(200);
    for (const method of ['GET', 'HEAD'])
      expect(
        (await bytes(actor, saved.attachment.contentUrl, { Range: 'bytes=0-7' }, method)).status,
      ).toBe(401);
    expect((await bytes(actor, saved.attachment.thumbnailUrl!)).status).toBe(401);
    expect(
      (
        await upload(actor, f.path(id, '/attachments'), {
          operationKey: key,
          proofType: 'ASSEMBLY',
        })
      ).status,
    ).toBe(401);
    expect((await bytes(second, saved.attachment.contentUrl)).status).toBe(200);
    const other = await f.makeCrew();
    await f.source.getRepository(CrewMember).update({ userId: second.user.id }, { active: false });
    await f.source
      .getRepository(CrewMember)
      .save({ userId: second.user.id, crewId: other.id, active: true });
    for (const method of ['GET', 'HEAD'])
      expect(
        (await bytes(second, saved.attachment.contentUrl, { Range: 'bytes=0-7' }, method)).status,
      ).toBe(404);
    expect((await bytes(second, saved.attachment.thumbnailUrl!)).status).toBe(404);
    expect(
      (
        await upload(second, f.path(id, '/attachments'), {
          operationKey: key,
          proofType: 'ASSEMBLY',
        })
      ).status,
    ).toBe(404);
    expect(await countOrderFiles(ctx.order.id)).toEqual([{ n: 1 }]);
  });
  it('serializes upload preflight behind User before Crew and rejects a concurrently transferred member without publishing bytes', async () => {
    const ctx = await f.context(),
      actor = ctx.actors[0]![0]!,
      id = ctx.assignmentIds[0]!,
      other = await f.makeCrew();
    await f.depart(ctx);
    const held = await f.barrier('app_user', actor.user.id),
      request = upload(actor, f.path(id, '/attachments'), {
        operationKey: freshOperation(),
        proofType: 'DELIVERY',
      });
    let observation: unknown;
    try {
      await f.waiters(held.pid, 1);
      for (const crewId of [ctx.crews[0]!.id, other.id].sort())
        await held.runner.manager
          .getRepository(Crew)
          .findOne({ where: { id: crewId }, lock: { mode: 'pessimistic_write' } });
      await held.runner.manager
        .getRepository(CrewMember)
        .update({ userId: actor.user.id }, { active: false });
      await held.runner.manager
        .getRepository(CrewMember)
        .save({ userId: actor.user.id, crewId: other.id, active: true });
      await held.runner.commitTransaction();
    } catch (error) {
      observation = error;
      if (held.runner.isTransactionActive) await held.runner.rollbackTransaction();
    } finally {
      await held.runner.release();
    }
    const response = await request;
    if (observation) throw observation;
    expect(response.status).toBe(404);
    expect(await countOrderFiles(ctx.order.id)).toEqual([{ n: 0 }]);
    expect(
      await f.source.query(
        `SELECT count(*)::int AS n FROM "${f.schema}".evidence_receipt WHERE order_id=$1`,
        [ctx.order.id],
      ),
    ).toEqual([{ n: 0 }]);
  });
  it('reauthorizes after real validation and removes only its staged files when membership is lost before publication', async () => {
    const ctx = await f.context(),
      actor = ctx.actors[0]![0]!,
      id = ctx.assignmentIds[0]!,
      other = await f.makeCrew();
    await f.depart(ctx);
    const storage = f.app.get(PrivateStorage),
      validate = storage.validate.bind(storage);
    let resume!: () => void, ready!: () => void;
    const paused = new Promise<void>((resolve) => {
        ready = resolve;
      }),
      release = new Promise<void>((resolve) => {
        resume = resolve;
      });
    vi.spyOn(storage, 'validate').mockImplementation(async (...args) => {
      const result = await validate(...args);
      ready();
      await release;
      return result;
    });
    const before = await readdir(f.storageRoot + '/final').catch(() => []),
      request = upload(actor, f.path(id, '/attachments'), {
        operationKey: freshOperation(),
        proofType: 'DELIVERY',
      });
    let observation: unknown;
    try {
      await Promise.race([
        paused,
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error('Real image validation did not reach the controlled publication barrier'),
              ),
            1500,
          ),
        ),
      ]);
      await f.source.transaction(async (manager) => {
        await manager
          .getRepository(CrewMember)
          .update({ userId: actor.user.id }, { active: false });
        await manager
          .getRepository(CrewMember)
          .save({ userId: actor.user.id, crewId: other.id, active: true });
      });
    } catch (error) {
      observation = error;
    } finally {
      resume();
    }
    const response = await request;
    if (observation) throw observation;
    expect(response.status).toBe(404);
    expect(await countOrderFiles(ctx.order.id)).toEqual([{ n: 0 }]);
    expect(await readdir(f.storageRoot + '/final')).toEqual(before);
    expect(await readdir(f.storageRoot + '/staging')).toEqual([]);
    expect(await readdir(f.storageRoot + '/validated')).toEqual([]);
  });
  it('freezes only visible finish references while later evidence and withdrawal preserve the original snapshot', async () => {
    const ctx = await f.context(),
      actor = ctx.actors[0]![0]!,
      id = ctx.assignmentIds[0]!;
    await f.start(ctx);
    const issue = await json<IssueResponse>(
      await f.call(actor, f.path(id, '/issues'), 'POST', issueInput()),
    );
    const privateIssue = await json<IssueResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + ctx.order.id + '/issues',
        'POST',
        issueInput('BACKOFFICE_ONLY'),
      ),
    );
    const visible = await json<AttachmentResponse>(
      await upload(actor, f.path(id, '/attachments'), {
        operationKey: freshOperation(),
        proofType: 'MISSING_PARTS',
        issueId: issue.issue.id,
      }),
    );
    const hidden = await json<AttachmentResponse>(
      await upload(f.dispatcher, '/orders/' + ctx.order.id + '/attachments', {
        operationKey: freshOperation(),
      }),
    );
    const current = await f.detail(actor, id);
    expect(current.openIssueCount).toBe(1);
    expect((await f.orders.detail(ctx.order.id)).openIssueCount).toBe(2);
    const finished = await json<CrewAssignmentResponse>(
      await f.action(actor, id, 'finish', {
        operationKey: freshOperation(),
        expectedExecutionVersion: current.execution.version,
        outcome: 'PARTIALLY_COMPLETED',
        summary: 'Missing fitting',
        reason: 'Fitting missing',
        remainingWork: 'Assemble remaining furniture',
        returnVisitRequired: true,
        returnReason: 'Bring fitting',
      }),
    );
    const snapshot = finished.assignment.finishReport!;
    expect(snapshot.knownIssueIds).toContain(issue.issue.id);
    expect(snapshot.knownIssueIds).not.toContain(privateIssue.issue.id);
    expect(snapshot.attachmentIds).toContain(visible.attachment.id);
    expect(snapshot.attachmentIds).not.toContain(hidden.attachment.id);
    safeEvidence(finished);
    const appended = await json<AttachmentResponse>(
      await upload(actor, f.path(id, '/attachments'), {
        operationKey: freshOperation(),
        proofType: 'OTHER',
      }),
    );
    await json<IssueResponse>(await f.call(actor, f.path(id, '/issues'), 'POST', issueInput()));
    const withdrawn = await json<AttachmentResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + ctx.order.id + '/attachments/' + visible.attachment.id + '/withdraw',
        'POST',
        { operationKey: freshOperation(), reason: 'Superseded evidence image' },
      ),
    );
    expect(withdrawn.attachment.withdrawnAt).not.toBeNull();
    expect((await bytes(actor, visible.attachment.contentUrl)).status).toBe(404);
    expect((await bytes(actor, visible.attachment.thumbnailUrl!)).status).toBe(404);
    const after = await f.detail(actor, id);
    expect(after.finishReport).toEqual(snapshot);
    expect(after.openIssueCount).toBe(2);
    expect(after.returnVisitRequired).toBe(true);
    expect((await f.orders.detail(ctx.order.id)).execution.finishReports[0]).toEqual(snapshot);
    const resolved = await json<IssueResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + ctx.order.id + '/issues/' + issue.issue.id + '/resolve',
        'POST',
        {
          operationKey: freshOperation(),
          expectedVersion: issue.issue.version,
          reason: 'Fitting replaced without cancelling the remaining visit',
        },
      ),
    );
    expect(resolved.issue.status).toBe('RESOLVED');
    const fileBefore = new Uint8Array(
      await (await bytes(actor, appended.attachment.contentUrl)).arrayBuffer(),
    );
    // The complete normal seed must preserve resolved issues, content, withdrawals and immutable reports.
    const rows = async () => {
      const output: Record<string, unknown> = {};
      for (const table of [
        'attachment',
        'evidence_issue',
        'issue_event',
        'issue_item',
        'issue_attachment',
        'execution_note',
        'evidence_receipt',
        'finish_report',
        'return_visit_request',
        'crew_assignment',
        'task',
        'order_item',
        'activity_log',
      ])
        output[table] = await f.source.query(
          `SELECT md5(row_to_json(t)::text) AS digest FROM "${f.schema}"."${table}" t ORDER BY digest`,
        );
      return output;
    };
    await seedCrews(f.source, 'test');
    for (const { crewCode, ...user } of demoUsers) {
      const saved = await f.source
        .getRepository(User)
        .save({ ...user, active: true, passwordHash: f.dispatcher.user.passwordHash });
      if (crewCode) {
        const crew = await f.source.getRepository(Crew).findOneByOrFail({ code: crewCode });
        await f.source
          .getRepository(CrewMember)
          .save({ userId: saved.id, crewId: crew.id, active: true });
      }
    }
    const seed = async () => {
      await seedCrews(f.source, 'test');
      await seedIdentity(f.source, 'test');
      await seedOrders(f.source, 'test');
      await seedPlanningDefaults(f.source, 'test');
    };
    await seed();
    const before = await rows();
    await seed();
    expect(await rows()).toEqual(before);
    await seed();
    expect(await rows()).toEqual(before);
    const fileAfter = await bytes(actor, appended.attachment.contentUrl);
    expect(fileAfter.status).toBe(200);
    expect(new Uint8Array(await fileAfter.arrayBuffer())).toEqual(fileBefore);
    expect((await f.detail(actor, id)).finishReport).toEqual(snapshot);
    expect((await f.detail(actor, id)).returnVisitRequired).toBe(true);
  });
  it('does not multiply financial totals when issues, links, files and teams fan out across an order', async () => {
    const before = await f.orders.dashboard(),
      ctx = await f.context({ crews: 2 }),
      actor = ctx.actors[0]![0]!,
      id = ctx.assignmentIds[0]!;
    await f.start(ctx);
    for (const amountCents of [1000, 2000])
      await f.orders.recordPayment(
        ctx.order.id,
        OrderDto.payment({
          amountCents,
          paidOn: '2030-01-07',
          method: 'CASH',
          idempotencyKey: freshOperation(),
        }),
        f.dispatcher.user.id,
      );
    for (let n = 0; n < 2; n++) {
      const photo = await json<AttachmentResponse>(
        await upload(actor, f.path(id, '/attachments'), {
          operationKey: freshOperation(),
          proofType: 'DAMAGE',
        }),
      );
      await json<IssueResponse>(
        await f.call(actor, f.path(id, '/issues'), 'POST', {
          ...issueInput(),
          itemIds: ctx.order.items.map((i) => i.id),
          attachmentIds: [photo.attachment.id],
        }),
      );
    }
    const order = await f.orders.detail(ctx.order.id),
      after = await f.orders.dashboard();
    expect(order).toMatchObject({
      orderTotalCents: 100000,
      paidCents: 3000,
      balanceCents: 97000,
      openIssueCount: 2,
      progress: 'IN_PROGRESS',
    });
    expect(after.orderTotalCents - before.orderTotalCents).toBe(100000);
    expect(after.paidCents - before.paidCents).toBe(3000);
    expect(after.balanceCents - before.balanceCents).toBe(97000);
    const result = await f.orders.list({
      search: order.number,
      hasOpenIssues: true,
      page: 1,
      pageSize: 20,
    });
    expect(result.total).toBe(1);
    expect(result.orders[0]).toMatchObject({
      id: order.id,
      progress: order.progress,
      paidCents: 3000,
      openIssueCount: 2,
    });
    const calendar = await f.planning.calendar({
      from: '2030-01-07',
      to: '2030-01-08',
      allTeams: true,
      crewIds: [],
      includeUnassigned: true,
    });
    expect(calendar.appointments.filter((a) => a.id === ctx.appointmentId)).toHaveLength(1);
    expect(calendar.appointments.find((a) => a.id === ctx.appointmentId)?.execution).toMatchObject({
      orderProgress: order.progress,
      workReadyForReview: order.workReadyForReview,
      openIssueCount: order.openIssueCount,
      returnVisitRequired: order.returnVisitRequired,
      activeCount: 1,
      notStartedCount: 1,
    });
    safeEvidence(await f.detail(actor, id));
  });
});
