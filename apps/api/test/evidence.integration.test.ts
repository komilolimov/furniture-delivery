import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CrewAssignmentResponse,
  EvidenceResponse,
  ExecutionNoteResponse,
  IssueResponse,
  IssueListResponse,
} from '@furniture-delivery/contracts';
import {
  createEvidenceFixture,
  evidenceJson as json,
  freshOperation,
  safeEvidence,
  type EvidenceFixture,
} from './evidence-fixture';

const fixedNow = '2030-01-07T08:00:00.000Z';
const issueInput = (itemIds: string[] = []) => ({
  operationKey: freshOperation(),
  type: 'DAMAGE',
  description: 'Fictional damage to supplied furniture',
  reportedSource: 'CUSTOMER',
  itemIds,
  notes: 'Customer reports damage before assembly',
});
describe('M5 notes/issues against isolated Compose PostgreSQL', () => {
  let f: EvidenceFixture;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(fixedNow));
    f = await createEvidenceFixture('m5_notes', (config, root) => ({
      ...config,
      storage: { root },
    }));
  }, 30000);
  beforeEach(() => {
    vi.setSystemTime(new Date(fixedNow));
  });
  afterAll(async () => {
    await f?.close();
    vi.useRealTimers();
  });
  it('derives crew provenance and visibility, forbids evidence before departure and rejects foreign nested IDs', async () => {
    const ctx = await f.context(),
      foreign = await f.context(),
      actor = ctx.actors[0]![0]!,
      id = ctx.assignmentIds[0]!;
    const note = { operationKey: freshOperation(), text: 'Observed furniture condition' };
    expect((await f.call(actor, f.path(id, '/notes'), 'POST', note)).status).toBe(403);
    expect((await f.call(actor, f.path(id, '/issues'), 'POST', issueInput())).status).toBe(403);
    await f.depart(ctx);
    for (const patch of [
      { authorId: f.dispatcher.user.id },
      { assignmentId: foreign.assignmentIds[0] },
      { orderId: foreign.order.id },
      { visibility: 'BACKOFFICE_ONLY' },
      { createdAt: '2000-01-01T00:00:00Z' },
    ])
      expect(
        (await f.call(actor, f.path(id, '/notes'), 'POST', { ...note, ...patch })).status,
      ).toBe(400);
    const created = await json<ExecutionNoteResponse>(
      await f.call(actor, f.path(id, '/notes'), 'POST', note),
    );
    expect(created.note).toMatchObject({
      orderId: ctx.order.id,
      appointmentId: ctx.appointmentId,
      assignmentId: id,
      visibility: 'CREW_VISIBLE',
      authorId: actor.user.id,
      text: note.text,
    });
    safeEvidence(created);
    expect(
      (
        await f.call(actor, f.path(id, '/notes'), 'POST', {
          ...note,
          operationKey: freshOperation(),
          itemId: foreign.order.items[0]!.id,
        })
      ).status,
    ).toBe(404);
    expect(
      (await f.call(actor, f.path(id, '/issues'), 'POST', issueInput([foreign.order.items[0]!.id])))
        .status,
    ).toBe(404);
    expect(
      (await f.call(actor, f.path(foreign.assignmentIds[0]!, '/issues'), 'POST', issueInput()))
        .status,
    ).toBe(404);
    expect(
      (await f.call(actor, f.path(id, '/issues'), 'POST', { ...issueInput(), type: 'UNKNOWN' }))
        .status,
    ).toBe(400);
    expect(
      (await f.call(actor, f.path(id, '/issues'), 'POST', { ...issueInput(), description: ' ' }))
        .status,
    ).toBe(400);
  });
  it('replays a historical backoffice item note after the item was logically removed before departure', async () => {
    const ctx = await f.context(),
      item = ctx.order.items[0]!,
      body = {
        operationKey: freshOperation(),
        itemId: item.id,
        text: 'Historical observation before planning changes',
      };
    const saved = await json<ExecutionNoteResponse>(
      await f.call(f.dispatcher, '/orders/' + ctx.order.id + '/notes', 'POST', body),
    );
    const current = await f.orders.detail(ctx.order.id);
    await f.orders.update(
      ctx.order.id,
      {
        expectedVersion: current.version,
        items: current.items
          .filter((value) => value.id !== item.id)
          .map((value) => ({
            id: value.id,
            description: value.description,
            quantity: value.quantity,
            configuration: value.configuration,
            ambient: value.ambient,
            notes: value.notes,
            requiresAssembly: value.requiresAssembly,
            sortOrder: value.sortOrder,
          })),
      },
      f.dispatcher.user.id,
    );
    const before = await f.history(ctx.order.id),
      replayed = await json<ExecutionNoteResponse>(
        await f.call(f.dispatcher, '/orders/' + ctx.order.id + '/notes', 'POST', body),
      );
    expect(replayed.note).toEqual(saved.note);
    expect(replayed.receipt?.id).toBe(saved.receipt?.id);
    expect(await f.history(ctx.order.id)).toBe(before);
  });
  it('commits one append-only note for concurrent identical commands and rejects changed key reuse', async () => {
    const ctx = await f.context(),
      actor = ctx.actors[0]![0]!,
      id = ctx.assignmentIds[0]!;
    await f.depart(ctx);
    const body = {
        operationKey: freshOperation(),
        text: '  Crew observed a long access staircase\nSecond line remains literal.  ',
      },
      before = await f.history(ctx.order.id);
    const responses = await f.overlap(
      'delivery_order',
      ctx.order.id,
      () => f.call(actor, f.path(id, '/notes'), 'POST', body),
      () => f.call(actor, f.path(id, '/notes'), 'POST', body),
    );
    const [a, b] = await Promise.all(responses.map((r) => json<ExecutionNoteResponse>(r)));
    expect(a!.note.id).toBe(b!.note.id);
    expect(a!.receipt?.id).toBe(b!.receipt?.id);
    expect(a!.note.text).toBe(body.text.trim());
    expect(await f.history(ctx.order.id)).toBe(before + 1);
    const read = await json<EvidenceResponse>(await f.call(actor, f.path(id, '/evidence')));
    expect(read.notes).toHaveLength(1);
    expect(read.notes[0]).toEqual(a!.note);
    safeEvidence(read);
    expect(
      (await f.call(actor, f.path(id, '/notes'), 'POST', { ...body, text: 'Changed contents' }))
        .status,
    ).toBe(409);
    expect(
      (
        await f.call(actor, f.path(id, '/notes/' + a!.note.id), 'PATCH', {
          text: 'Overwrite immutable evidence',
        })
      ).status,
    ).toBe(404);
    const receipt = await json<ExecutionNoteResponse>(
      await f.call(actor, f.path(id, '/notes'), 'POST', { ...body, text: body.text.trim() }),
    );
    expect(receipt.note).toEqual(a!.note);
    expect(await f.history(ctx.order.id)).toBe(before + 1);
  });
  it('creates a multi-item issue once under concurrent retry and preserves its author, source and timeline', async () => {
    const ctx = await f.context(),
      actor = ctx.actors[0]![0]!,
      id = ctx.assignmentIds[0]!;
    await f.start(ctx);
    const body = issueInput(ctx.order.items.map((i) => i.id)),
      before = await f.history(ctx.order.id);
    const responses = await f.overlap(
      'delivery_order',
      ctx.order.id,
      () => f.call(actor, f.path(id, '/issues'), 'POST', body),
      () => f.call(actor, f.path(id, '/issues'), 'POST', body),
    );
    const [a, b] = await Promise.all(responses.map((r) => json<IssueResponse>(r)));
    expect(a!.issue.id).toBe(b!.issue.id);
    expect(a!.receipt?.id).toBe(b!.receipt?.id);
    expect(a!.issue).toMatchObject({
      status: 'OPEN',
      version: 1,
      authorId: actor.user.id,
      reportedSource: 'CUSTOMER',
      visibility: 'CREW_VISIBLE',
      assignmentId: id,
      appointmentId: ctx.appointmentId,
    });
    expect(new Set(a!.issue.itemIds)).toEqual(new Set(body.itemIds));
    expect(a!.issue.events.some((e) => e.kind === 'CREATED' && e.actorId === actor.user.id)).toBe(
      true,
    );
    expect(await f.history(ctx.order.id)).toBe(before + 1);
    safeEvidence(a);
    expect(
      (await f.call(actor, f.path(id, '/issues'), 'POST', { ...body, type: 'MISSING_PARTS' }))
        .status,
    ).toBe(409);
    expect(
      (
        await f.call(
          actor,
          '/orders/' + ctx.order.id + '/issues/' + a!.issue.id + '/resolve',
          'POST',
          { operationKey: freshOperation(), expectedVersion: 1, reason: 'Crew cannot resolve' },
        )
      ).status,
    ).toBe(403);
    const list = await json<IssueListResponse>(
      await f.call(f.dispatcher, '/issues?status=OPEN&type=DAMAGE&page=1&pageSize=100'),
    );
    expect(list.issues.map((i) => i.id)).toContain(a!.issue.id);
    expect(list.total).toBeGreaterThanOrEqual(1);
    expect((await f.call(actor, '/issues?status=OPEN')).status).toBe(403);
  });
  it('resolves/reopens with current versions and replays the original command as a fresh projection without undoing newer state', async () => {
    const ctx = await f.context(),
      actor = ctx.actors[0]![0]!,
      id = ctx.assignmentIds[0]!;
    await f.depart(ctx);
    const created = await json<IssueResponse>(
      await f.call(actor, f.path(id, '/issues'), 'POST', issueInput()),
    );
    const root = '/orders/' + ctx.order.id + '/issues/' + created.issue.id;
    expect(
      (
        await f.call(f.dispatcher, root + '/resolve', 'POST', {
          operationKey: freshOperation(),
          expectedVersion: 1,
          reason: ' ',
        })
      ).status,
    ).toBe(400);
    const body = {
      operationKey: freshOperation(),
      expectedVersion: 1,
      reason: 'Replaced defective part',
    };
    const resolved = await json<IssueResponse>(
      await f.call(f.dispatcher, root + '/resolve', 'POST', body),
    );
    expect(resolved.issue).toMatchObject({
      status: 'RESOLVED',
      version: 2,
      resolvedBy: f.dispatcher.user.id,
      resolution: body.reason,
    });
    const reopened = await json<IssueResponse>(
      await f.call(f.dispatcher, root + '/reopen', 'POST', {
        operationKey: freshOperation(),
        expectedVersion: 2,
        reason: 'Replacement still defective',
      }),
    );
    expect(reopened.issue).toMatchObject({
      status: 'OPEN',
      version: 3,
      resolvedBy: null,
      resolvedAt: null,
      resolution: null,
    });
    const before = await f.history(ctx.order.id),
      replay = await json<IssueResponse>(
        await f.call(f.dispatcher, root + '/resolve', 'POST', body),
      );
    expect(replay.issue).toEqual(reopened.issue);
    expect(replay.receipt?.id).toBe(resolved.receipt?.id);
    expect(await f.history(ctx.order.id)).toBe(before);
    expect(
      (
        await f.call(f.dispatcher, root + '/resolve', 'POST', {
          ...body,
          reason: 'Changed key payload',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.call(f.dispatcher, root + '/resolve', 'POST', {
          operationKey: freshOperation(),
          expectedVersion: 1,
          reason: 'Stale form',
        })
      ).status,
    ).toBe(409);
    const noteBody = { operationKey: freshOperation(), text: 'Append a follow-up explanation' };
    const note = await json<IssueResponse>(
      await f.call(f.dispatcher, root + '/notes', 'POST', noteBody),
    );
    expect(
      note.issue.events.filter((e) => e.kind === 'NOTE' && e.text === noteBody.text),
    ).toHaveLength(1);
    const noteRetry = await json<IssueResponse>(
      await f.call(f.dispatcher, root + '/notes', 'POST', noteBody),
    );
    expect(noteRetry.issue).toEqual(note.issue);
    const kinds = note.issue.events.filter((e) => e.kind !== 'NOTE').map((e) => e.kind);
    expect(kinds).toEqual(['CREATED', 'RESOLVED', 'REOPENED']);
  });
  it('serializes two dispatchers resolving the same issue and keeps unrelated versions and results untouched', async () => {
    const ctx = await f.context(),
      actor = ctx.actors[0]![0]!,
      id = ctx.assignmentIds[0]!;
    await f.start(ctx);
    let current = await f.detail(actor, id);
    const item = current.items[0]!;
    current = (
      await json<CrewAssignmentResponse>(
        await f.call(actor, f.path(id, '/items/' + item.id + '/fulfillment'), 'POST', {
          operationKey: freshOperation(),
          expectedFulfillmentVersion: item.fulfillmentVersion,
          deliveredQuantity: 1,
          assembledQuantity: 0,
        }),
      )
    ).assignment;
    const issued = await json<IssueResponse>(
      await f.call(actor, f.path(id, '/issues'), 'POST', issueInput([item.id])),
    );
    const before = await f.history(ctx.order.id),
      path = '/orders/' + ctx.order.id + '/issues/' + issued.issue.id + '/resolve',
      body = {
        operationKey: freshOperation(),
        expectedVersion: 1,
        reason: 'Resolved by dispatcher',
      };
    const results = await f.overlap(
      'delivery_order',
      ctx.order.id,
      () => f.call(f.dispatcher, path, 'POST', body),
      () => f.call(f.administrator, path, 'POST', { ...body, operationKey: freshOperation() }),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await f.history(ctx.order.id)).toBe(before + 1);
    const after = await f.detail(actor, id);
    expect(after.items).toEqual(current.items);
    expect(after.execution).toEqual(current.execution);
    expect(after.tasks).toEqual(current.tasks);
    const read = await json<EvidenceResponse>(await f.call(actor, f.path(id, '/evidence')));
    expect(read.issues.find((i) => i.id === issued.issue.id)).toMatchObject({
      status: 'RESOLVED',
      version: 2,
    });
  });
  it('does not let issue resolution remove accumulated quantities, return requirements or immutable finish reports', async () => {
    const ctx = await f.context(),
      actor = ctx.actors[0]![0]!,
      id = ctx.assignmentIds[0]!;
    let current = await f.start(ctx);
    const item = current.items[0]!;
    current = (
      await json<CrewAssignmentResponse>(
        await f.call(actor, f.path(id, '/items/' + item.id + '/fulfillment'), 'POST', {
          operationKey: freshOperation(),
          expectedFulfillmentVersion: item.fulfillmentVersion,
          deliveredQuantity: 1,
          assembledQuantity: 0,
        }),
      )
    ).assignment;
    expect(current.items.find((value) => value.id === item.id)?.deliveredQuantity).toBe(1);
    const issue = await json<IssueResponse>(
      await f.call(actor, f.path(id, '/issues'), 'POST', issueInput([item.id])),
    );
    current = await f.detail(actor, id);
    const finished = await json<CrewAssignmentResponse>(
      await f.action(actor, id, 'finish', {
        operationKey: freshOperation(),
        expectedExecutionVersion: current.execution.version,
        outcome: 'PARTIALLY_COMPLETED',
        summary: 'Some delivered, more work remains',
        reason: 'Broken fitting',
        remainingWork: 'Deliver remaining furniture and assemble',
        returnVisitRequired: true,
        returnReason: 'Bring fitting',
      }),
    );
    expect(finished.assignment.finishReport?.knownIssueIds).toContain(issue.issue.id);
    await json<IssueResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + ctx.order.id + '/issues/' + issue.issue.id + '/resolve',
        'POST',
        {
          operationKey: freshOperation(),
          expectedVersion: issue.issue.version,
          reason: 'Fitting replaced',
        },
      ),
    );
    const after = await f.detail(actor, id);
    expect(after.finishReport).toEqual(finished.assignment.finishReport);
    expect(after.items).toEqual(finished.assignment.items);
    expect(after.returnVisitRequired).toBe(true);
    const order = await f.orders.detail(ctx.order.id);
    expect(order.returnVisitRequired).toBe(true);
    expect(order.workReadyForReview).toBe(false);
    expect(order.progress).toBe('PARTIALLY_COMPLETED');
    expect(order.appointments).toHaveLength(1);
    expect(order.paidCents).toBe(0);
    const note = await json<ExecutionNoteResponse>(
      await f.call(actor, f.path(id, '/notes'), 'POST', {
        operationKey: freshOperation(),
        text: 'Additional observation after finishing',
      }),
    );
    expect(note.note.assignmentId).toBe(id);
    expect((await f.detail(actor, id)).finishReport).toEqual(finished.assignment.finishReport);
  });
  it('rolls back issue, item links, event, receipt and audit together when audit fails', async () => {
    const ctx = await f.context(),
      actor = ctx.actors[0]![0]!,
      id = ctx.assignmentIds[0]!;
    await f.depart(ctx);
    const body = issueInput(ctx.order.items.map((i) => i.id));
    await f.source.query(
      `CREATE FUNCTION "${f.schema}".reject_issue_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id='${ctx.order.id}'::uuid AND NEW.action='ISSUE_CREATED' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END $$`,
    );
    await f.source.query(
      `CREATE TRIGGER reject_issue_audit BEFORE INSERT ON "${f.schema}".activity_log FOR EACH ROW EXECUTE FUNCTION "${f.schema}".reject_issue_audit()`,
    );
    const before = await f.history(ctx.order.id);
    try {
      expect((await f.call(actor, f.path(id, '/issues'), 'POST', body)).status).toBe(500);
      for (const table of ['evidence_issue', 'evidence_receipt'])
        expect(
          await f.source.query(
            `SELECT count(*)::int AS n FROM "${f.schema}"."${table}" WHERE order_id=$1`,
            [ctx.order.id],
          ),
        ).toEqual([{ n: 0 }]);
      expect(await f.history(ctx.order.id)).toBe(before);
    } finally {
      await f.source.query(`DROP TRIGGER reject_issue_audit ON "${f.schema}".activity_log`);
      await f.source.query(`DROP FUNCTION "${f.schema}".reject_issue_audit()`);
    }
    const saved = await json<IssueResponse>(
      await f.call(actor, f.path(id, '/issues'), 'POST', body),
    );
    expect(new Set(saved.issue.itemIds)).toEqual(new Set(body.itemIds));
    expect(saved.issue.events.filter((e) => e.kind === 'CREATED')).toHaveLength(1);
    expect(await f.history(ctx.order.id)).toBe(before + 1);
  });
});
