import type {
  BackofficeAcceptanceResponse,
  CompleteOrderCommand,
  CompletionHistoryResponse,
  CompletionOperationResponse,
  CompletionReadinessResponse,
  IssueResponse,
  OrderResponse,
  PaymentResponse,
  PlanReturnVisitCommand,
  ReturnRequestResponse,
  AppointmentResponse,
} from '@furniture-delivery/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompletionRecord } from '../src/completion/completion-record.entity';
import { User } from '../src/identity/user.entity';
import { AuthSession } from '../src/identity/auth-session.entity';
import { EvidenceReceipt } from '../src/evidence/evidence-receipt.entity';
import { Issue } from '../src/evidence/issue.entity';
import { Appointment } from '../src/planning/appointment.entity';
import {
  acknowledgeAcceptanceVisit,
  completedAcceptanceVisit,
  completeAcceptanceTasks,
  finishAcceptanceTeam,
  setAcceptanceQuantities,
  signatureForm,
  syntheticSignature,
} from './acceptance-fixture';
import {
  createEvidenceFixture,
  evidenceOrderInput,
  evidenceJson as json,
  freshOperation,
  type EvidenceContext,
  type EvidenceFixture,
} from './evidence-fixture';

const NOW = '2030-01-07T08:00:00.000Z';
describe('M7 explicit order completion and reopen serialize with current operational obligations', () => {
  let f: EvidenceFixture;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    f = await createEvidenceFixture('m7_complete', (config, root) => ({
      ...config,
      storage: { root },
    }));
  }, 30000);
  beforeEach(() => vi.setSystemTime(new Date(NOW)));
  afterAll(async () => {
    await f?.close();
    vi.useRealTimers();
  });
  const readiness = async (id: string, actor = f.dispatcher) =>
    (
      await json<CompletionReadinessResponse>(
        await f.call(actor, '/orders/' + id + '/completion-readiness'),
      )
    ).readiness;
  const history = async (id: string) =>
    await json<CompletionHistoryResponse>(
      await f.call(f.dispatcher, '/orders/' + id + '/completion-history'),
    );
  const command = async (id: string): Promise<CompleteOrderCommand> => ({
    operationKey: freshOperation(),
    expectedVersion: (await readiness(id)).orderVersion,
    reason: 'Dispatcher explicitly verified this fictional order result',
  });
  const complete = async (id: string, body?: CompleteOrderCommand, actor = f.dispatcher) =>
    f.call(actor, '/orders/' + id + '/complete', 'POST', body ?? (await command(id)));
  const reopen = async (id: string, reason = 'Explicit fictional operational reopening') => {
    const state = await readiness(id);
    return f.call(f.dispatcher, '/orders/' + id + '/reopen', 'POST', {
      operationKey: freshOperation(),
      expectedVersion: state.orderVersion,
      expectedCompletionId: state.currentCompletion!.id,
      reason,
    });
  };
  const readyVisit = async (teams = 1, exception = false) => {
    const ctx = await completedAcceptanceVisit(f, teams),
      doc = await acknowledgeAcceptanceVisit(f, ctx, exception);
    expect((await readiness(ctx.order.id)).canComplete).toBe(true);
    return { ctx, doc };
  };
  const issue = (ctx: EvidenceContext) =>
    f.call(ctx.actors[0]![0]!, f.path(ctx.assignmentIds[0]!, '/issues'), 'POST', {
      operationKey: freshOperation(),
      type: 'DAMAGE',
      description: 'Synthetic damage reported honestly after work',
      reportedSource: 'CREW',
    });
  async function ordered(
    orderId: string,
    first: () => Promise<Response>,
    second: () => Promise<Response>,
  ) {
    const held = await f.barrier('delivery_order', orderId),
      operations: Promise<Response>[] = [];
    let observed: unknown;
    try {
      operations.push(first());
      await f.waiters(held.pid, 1);
      operations.push(second());
      await f.waiters(held.pid, 2);
    } catch (error) {
      observed = error;
    } finally {
      await held.runner.rollbackTransaction();
      await held.runner.release();
    }
    const settled = await Promise.allSettled(operations);
    if (observed) throw observed;
    return settled.map((result) => {
      if (result.status !== 'fulfilled') throw result.reason;
      return result.value;
    });
  }

  it('separates physical readiness from acknowledgements and refuses a fully paid empty order or an unsigned finished visit', async () => {
    const empty = await f.orders.create(evidenceOrderInput(), f.dispatcher.user.id);
    await f.orders.recordPayment(
      empty.id,
      {
        amountCents: empty.orderTotalCents,
        paidOn: '2030-01-07',
        method: 'CASH',
        idempotencyKey: freshOperation(),
      },
      f.dispatcher.user.id,
    );
    const none = await readiness(empty.id);
    expect(none.canComplete).toBe(false);
    expect(none.physicalReady).toBe(false);
    expect(none.blockers.map((blocker) => blocker.code)).toContain('NO_VISITS');
    expect((await complete(empty.id)).status).toBe(409);
    const ctx = await completedAcceptanceVisit(f),
      unsigned = await readiness(ctx.order.id);
    expect(unsigned.physicalReady).toBe(true);
    expect(unsigned.confirmationsReady).toBe(false);
    expect(unsigned.canComplete).toBe(false);
    expect(
      unsigned.blockers.some(
        (blocker) =>
          blocker.code === 'MISSING_SNAPSHOT' && blocker.appointmentId === ctx.appointmentId,
      ),
    ).toBe(true);
    const doc = (
      await json<BackofficeAcceptanceResponse>(
        await f.call(
          f.dispatcher,
          '/orders/' + ctx.order.id + '/appointments/' + ctx.appointmentId + '/acceptance',
          'POST',
          { operationKey: freshOperation() },
        ),
      )
    ).acceptance.current!;
    const missing = await readiness(ctx.order.id);
    expect(
      missing.blockers
        .filter((blocker) => blocker.code === 'MISSING_CONFIRMATION')
        .map((blocker) => blocker.slotId)
        .sort(),
    ).toEqual(doc.slots.map((slot) => slot.id).sort());
    expect((await complete(ctx.order.id)).status).toBe(409);
  });

  it('explicitly completes performed work with debt, preserves payment ledger and keeps contact/price/payment changes independent of the signed result', async () => {
    const { ctx, doc } = await readyVisit(2),
      before = await f.orders.detail(ctx.order.id);
    const result = await json<CompletionOperationResponse>(await complete(ctx.order.id));
    expect(result.readiness.currentCompletion).toMatchObject({
      orderId: ctx.order.id,
      actorId: f.dispatcher.user.id,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    expect(result.readiness.currentCompletion!.readiness.snapshotIds).toEqual([doc.snapshot.id]);
    const completed = await f.orders.detail(ctx.order.id);
    expect(completed.progress).toBe('COMPLETED');
    expect(completed.paymentStatus).toBe('UNPAID');
    expect(completed.payments).toEqual(before.payments);
    const payment = await f.orders.recordPayment(
      ctx.order.id,
      {
        amountCents: 25000,
        paidOn: '2030-01-07',
        method: 'CASH',
        idempotencyKey: freshOperation(),
      },
      f.dispatcher.user.id,
    );
    await f.orders.voidPayment(
      ctx.order.id,
      payment.payment.id,
      'Fictional erroneous manual entry',
      f.dispatcher.user.id,
    );
    const fresh = await f.orders.detail(ctx.order.id);
    await f.orders.update(
      ctx.order.id,
      {
        expectedVersion: fresh.version,
        orderTotalCents: 110000,
        contactName: 'Synthetic new contact',
        internalNotes: 'Private operational clarification after completion',
      },
      f.dispatcher.user.id,
    );
    expect((await f.orders.detail(ctx.order.id)).progress).toBe('COMPLETED');
    const document = await json<BackofficeAcceptanceResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + ctx.order.id + '/appointments/' + ctx.appointmentId + '/acceptance',
      ),
    );
    expect(document.acceptance.current!.snapshot).toEqual(doc.snapshot);
    expect((await readiness(ctx.order.id)).currentCompletion!.id).toBe(
      result.readiness.currentCompletion!.id,
    );
  });

  it('reports concrete physical blockers for active/unstarted/unassigned work, uncovered results, remaining quantities/tasks, issues and return needs', async () => {
    const ctx = await f.context();
    expect((await readiness(ctx.order.id)).blockers.map((blocker) => blocker.code)).toContain(
      'UNSTARTED_VISIT',
    );
    await f.depart(ctx);
    expect((await readiness(ctx.order.id)).blockers.map((blocker) => blocker.code)).toContain(
      'ACTIVE_EXECUTION',
    );
    const terminal = await finishAcceptanceTeam(f, ctx, 0, 'BLOCKED', true);
    const opened = await json<IssueResponse>(await issue(ctx));
    await f.planning.create(
      ctx.order.id,
      {
        localStart: '2030-01-08T12:00',
        durationMinutes: 60,
        crewIds: [],
        idempotencyKey: freshOperation(),
      },
      f.dispatcher.user.id,
    );
    const state = await readiness(ctx.order.id),
      codes = state.blockers.map((blocker) => blocker.code);
    for (const code of [
      'UNASSIGNED_VISIT',
      'UNCOVERED_EXECUTION',
      'INCOMPLETE_TASKS',
      'INCOMPLETE_ITEMS',
      'OPEN_ISSUES',
      'RETURN_REQUIRED',
    ])
      expect(codes).toContain(code);
    expect(state.blockers.some((blocker) => blocker.issueId === opened.issue.id)).toBe(true);
    expect(
      state.blockers.some((blocker) => blocker.requestId === terminal.returnRequests[0]!.id),
    ).toBe(true);
    expect(state.canComplete).toBe(false);
    expect((await complete(ctx.order.id)).status).toBe(409);
  });

  it('keeps an existing completion and its signatures valid through HTTP payment, VOID, valid price and nonmaterial contact/internal-note changes', async () => {
    const { ctx, doc } = await readyVisit(),
      closed = await json<CompletionOperationResponse>(await complete(ctx.order.id)),
      record = closed.readiness.currentCompletion!;
    const signatureFacts = doc.slots.map((slot) => ({
      slotId: slot.id,
      confirmationId: slot.confirmation!.id,
      snapshotHash: slot.confirmation!.snapshotHash,
      imageDigest: slot.confirmation!.imageDigest,
    }));
    const initialVersion = closed.readiness.orderVersion,
      path = '/orders/' + ctx.order.id;
    const paid = await json<PaymentResponse>(
      await f.call(f.dispatcher, path + '/payments', 'POST', {
        amountCents: 25000,
        paidOn: '2030-01-07',
        method: 'CASH',
        idempotencyKey: freshOperation(),
        note: 'Synthetic manual payment after physical closure',
      }),
      201,
    );
    expect(paid.payment.status).toBe('RECORDED');
    expect(paid.order.paidCents).toBe(25000);
    expect(paid.order.balanceCents).toBe(75000);
    expect(paid.order.progress).toBe('COMPLETED');
    const voided = await json<PaymentResponse>(
      await f.call(f.dispatcher, path + '/payments/' + paid.payment.id + '/void', 'POST', {
        reason: 'Synthetic correction retains the manual ledger entry',
      }),
      201,
    );
    expect(voided.payment.id).toBe(paid.payment.id);
    expect(voided.payment.status).toBe('VOIDED');
    expect(voided.payment.amountCents).toBe(25000);
    expect(voided.order.payments).toHaveLength(1);
    expect(voided.order.paidCents).toBe(0);
    expect(voided.order.balanceCents).toBe(100000);
    expect(voided.order.progress).toBe('COMPLETED');
    const priced = await json<OrderResponse>(
      await f.call(f.dispatcher, path, 'PATCH', {
        expectedVersion: voided.order.version,
        orderTotalCents: 110000,
      }),
    );
    expect(priced.order.orderTotalCents).toBe(110000);
    expect(priced.order.paidCents).toBe(0);
    expect(priced.order.balanceCents).toBe(110000);
    expect(priced.order.progress).toBe('COMPLETED');
    const edited = await json<OrderResponse>(
      await f.call(f.dispatcher, path, 'PATCH', {
        expectedVersion: priced.order.version,
        contactName: 'Synthetic updated contact',
        internalNotes: 'Private follow-up clarification after signed closure',
      }),
    );
    expect(edited.order.contactName).toBe('Synthetic updated contact');
    expect(edited.order.progress).toBe('COMPLETED');
    expect(edited.order.payments[0]!.status).toBe('VOIDED');
    const current = await readiness(ctx.order.id);
    expect(current.orderVersion).toBeGreaterThan(initialVersion);
    expect(current.currentCompletion).toEqual(record);
    expect(current.blockers.map((blocker) => blocker.code)).toEqual(['ALREADY_COMPLETED']);
    const after = (
      await json<BackofficeAcceptanceResponse>(
        await f.call(f.dispatcher, path + '/appointments/' + ctx.appointmentId + '/acceptance'),
      )
    ).acceptance.current!;
    expect(after.snapshot).toEqual(doc.snapshot);
    expect(
      after.slots.map((slot) => ({
        slotId: slot.id,
        confirmationId: slot.confirmation!.id,
        snapshotHash: slot.confirmation!.snapshotHash,
        imageDigest: slot.confirmation!.imageDigest,
      })),
    ).toEqual(signatureFacts);
    const decisions = await history(ctx.order.id);
    expect(decisions.currentCompletionId).toBe(record.id);
    expect(decisions.completions).toEqual([record]);
    expect(decisions.reopenEvents).toEqual([]);
  });

  it('serializes two valid complete commands into one effective completion and safely retries the winner', async () => {
    const { ctx } = await readyVisit(),
      first = await command(ctx.order.id),
      second = { ...first, operationKey: freshOperation() };
    const responses = await f.overlap(
      'delivery_order',
      ctx.order.id,
      () => complete(ctx.order.id, first),
      () => complete(ctx.order.id, second, f.administrator),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await f.source.getRepository(CompletionRecord).countBy({ orderId: ctx.order.id })).toBe(
      1,
    );
    const winner = responses[0]!.status === 200 ? first : second,
      actor = responses[0]!.status === 200 ? f.dispatcher : f.administrator;
    const count = await f.history(ctx.order.id),
      replay = await json<CompletionOperationResponse>(await complete(ctx.order.id, winner, actor));
    expect(replay.readiness.currentCompletion).not.toBeNull();
    expect(await f.history(ctx.order.id)).toBe(count);
    expect(
      (
        await complete(
          ctx.order.id,
          { ...winner, reason: 'Changed metadata under an already committed key' },
          actor,
        )
      ).status,
    ).toBe(409);
  });

  it('preserves immutable completion and signature history through reopen/reclose and never resurrects an older completion through replay', async () => {
    const { ctx, doc } = await readyVisit(),
      input = await command(ctx.order.id),
      first = await json<CompletionOperationResponse>(await complete(ctx.order.id, input)),
      record = first.readiness.currentCompletion!;
    const before = await f.detail(ctx.actors[0]![0]!, ctx.assignmentIds[0]!);
    const reopened = await json<CompletionOperationResponse>(await reopen(ctx.order.id));
    expect(reopened.readiness.currentCompletion).toBeNull();
    expect((await f.orders.detail(ctx.order.id)).progress).toBe('AWAITING_REVIEW');
    const late = await json<CompletionOperationResponse>(await complete(ctx.order.id, input));
    expect(late.receipt?.id).toBe(first.receipt?.id);
    expect(late.readiness.currentCompletion).toBeNull();
    const second = await json<CompletionOperationResponse>(await complete(ctx.order.id));
    expect(second.readiness.currentCompletion!.id).not.toBe(record.id);
    const oldAgain = await json<CompletionOperationResponse>(await complete(ctx.order.id, input));
    expect(oldAgain.readiness.currentCompletion!.id).toBe(second.readiness.currentCompletion!.id);
    const events = await history(ctx.order.id);
    expect(events.completions).toHaveLength(2);
    expect(events.reopenEvents).toHaveLength(1);
    expect(events.completions.find((entry) => entry.id === record.id)).toEqual(record);
    expect(events.reopenEvents[0]!.source).toBe('MANUAL');
    const after = await f.detail(ctx.actors[0]![0]!, ctx.assignmentIds[0]!);
    expect(after.finishReport).toEqual(before.finishReport);
    expect(after.tasks).toEqual(before.tasks);
    expect(after.items).toEqual(before.items);
    expect(
      (
        await json<BackofficeAcceptanceResponse>(
          await f.call(
            f.dispatcher,
            '/orders/' + ctx.order.id + '/appointments/' + ctx.appointmentId + '/acceptance',
          ),
        )
      ).acceptance.current!.snapshot,
    ).toEqual(doc.snapshot);
  });

  it('serializes a new complete command against manual reopen in both observed commit orders without silently reclosing', async () => {
    for (const reopenFirst of [true, false]) {
      const { ctx } = await readyVisit();
      const closed = await json<CompletionOperationResponse>(await complete(ctx.order.id)),
        current = closed.readiness.currentCompletion!,
        input = await command(ctx.order.id);
      const open = () =>
        f.call(f.dispatcher, '/orders/' + ctx.order.id + '/reopen', 'POST', {
          operationKey: freshOperation(),
          expectedVersion: closed.readiness.orderVersion,
          expectedCompletionId: current.id,
          reason: 'Explicit manual reopening races with a separate complete command',
        });
      const done = () => complete(ctx.order.id, input);
      const responses = await ordered(
        ctx.order.id,
        reopenFirst ? open : done,
        reopenFirst ? done : open,
      );
      expect(responses.map((response) => response.status)).toEqual(
        reopenFirst ? [200, 409] : [409, 200],
      );
      const state = await readiness(ctx.order.id);
      expect(state.currentCompletion).toBeNull();
      expect(state.canComplete).toBe(true);
      expect((await f.orders.detail(ctx.order.id)).progress).toBe('AWAITING_REVIEW');
      const decisions = await history(ctx.order.id);
      expect(decisions.completions).toEqual([current]);
      expect(decisions.reopenEvents).toHaveLength(1);
      expect(decisions.currentCompletionId).toBeNull();
    }
  });

  it('serializes an old successful complete replay against manual reopen in both observed commit orders without resurrecting its completion', async () => {
    for (const reopenFirst of [true, false]) {
      const { ctx } = await readyVisit(),
        input = await command(ctx.order.id);
      const closed = await json<CompletionOperationResponse>(await complete(ctx.order.id, input)),
        current = closed.readiness.currentCompletion!;
      const open = () =>
        f.call(f.dispatcher, '/orders/' + ctx.order.id + '/reopen', 'POST', {
          operationKey: freshOperation(),
          expectedVersion: closed.readiness.orderVersion,
          expectedCompletionId: current.id,
          reason: 'Manual reopen races with a lost-response complete retry',
        });
      const replay = () => complete(ctx.order.id, input);
      const responses = await ordered(
        ctx.order.id,
        reopenFirst ? open : replay,
        reopenFirst ? replay : open,
      );
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const repeated = await json<CompletionOperationResponse>(responses[reopenFirst ? 1 : 0]!);
      expect(repeated.receipt?.id).toBe(closed.receipt?.id);
      if (reopenFirst) expect(repeated.readiness.currentCompletion).toBeNull();
      else expect(repeated.readiness.currentCompletion!.id).toBe(current.id);
      const final = await readiness(ctx.order.id),
        decisions = await history(ctx.order.id);
      expect(final.currentCompletion).toBeNull();
      expect(decisions.currentCompletionId).toBeNull();
      expect(decisions.completions).toEqual([current]);
      expect(decisions.reopenEvents).toHaveLength(1);
    }
  });

  it('serializes create issue and complete in both observed commit orders, keeping the issue and atomically reopening a just-completed order', async () => {
    for (const completeFirst of [true, false]) {
      const { ctx } = await readyVisit(),
        input = await command(ctx.order.id),
        done = () => complete(ctx.order.id, input),
        report = () => issue(ctx);
      const result = await ordered(
        ctx.order.id,
        completeFirst ? done : report,
        completeFirst ? report : done,
      );
      expect(result[0]!.status).toBe(200);
      expect(result[1]!.status).toBe(completeFirst ? 200 : 409);
      const order = await f.orders.detail(ctx.order.id);
      expect(order.progress).not.toBe('COMPLETED');
      expect(order.openIssueCount).toBe(1);
      const events = await history(ctx.order.id);
      expect(events.currentCompletionId).toBeNull();
      expect(events.completions).toHaveLength(completeFirst ? 1 : 0);
      if (completeFirst) {
        expect(events.reopenEvents[0]!.source).toBe('ISSUE');
        expect(events.reopenEvents[0]!.sourceId).toBeTruthy();
      }
    }
  });

  it('serializes reopen issue and complete in both observed commit orders, and resolving the issue never automatically closes the order again', async () => {
    for (const completeFirst of [true, false]) {
      const ctx = await completedAcceptanceVisit(f),
        opened = await json<IssueResponse>(await issue(ctx));
      const path = '/orders/' + ctx.order.id + '/issues/' + opened.issue.id;
      const resolved = await json<IssueResponse>(
        await f.call(f.dispatcher, path + '/resolve', 'POST', {
          operationKey: freshOperation(),
          expectedVersion: opened.issue.version,
          reason: 'Synthetic initial damage considered',
        }),
      );
      await acknowledgeAcceptanceVisit(f, ctx);
      const input = await command(ctx.order.id),
        done = () => complete(ctx.order.id, input),
        report = () =>
          f.call(f.dispatcher, path + '/reopen', 'POST', {
            operationKey: freshOperation(),
            expectedVersion: resolved.issue.version,
            reason: 'Synthetic damage needs reconsideration',
          });
      const responses = await ordered(
        ctx.order.id,
        completeFirst ? done : report,
        completeFirst ? report : done,
      );
      expect(responses[0]!.status).toBe(200);
      expect(responses[1]!.status).toBe(completeFirst ? 200 : 409);
      expect((await f.orders.detail(ctx.order.id)).progress).not.toBe('COMPLETED');
      const current = await f.source.getRepository(Issue).findOneByOrFail({ id: opened.issue.id });
      await json<IssueResponse>(
        await f.call(f.dispatcher, path + '/resolve', 'POST', {
          operationKey: freshOperation(),
          expectedVersion: current.version,
          reason: 'Synthetic damage reconsidered',
        }),
      );
      expect((await f.orders.detail(ctx.order.id)).progress).toBe('AWAITING_REVIEW');
      expect((await readiness(ctx.order.id)).currentCompletion).toBeNull();
    }
  });

  it('serializes new planning against complete in both commit orders and never leaves a completed order with newly added unfinished work', async () => {
    for (const completeFirst of [true, false]) {
      const { ctx } = await readyVisit(),
        input = await command(ctx.order.id),
        done = () => complete(ctx.order.id, input);
      const create = () =>
        f.call(f.dispatcher, '/orders/' + ctx.order.id + '/appointments', 'POST', {
          localStart: '2030-01-08T12:00',
          durationMinutes: 60,
          crewIds: ctx.crews.map((crew) => crew.id),
          idempotencyKey: freshOperation(),
        });
      const responses = await ordered(
        ctx.order.id,
        completeFirst ? done : create,
        completeFirst ? create : done,
      );
      expect(responses[0]!.status).toBe(completeFirst ? 200 : 201);
      expect(responses[1]!.status).toBe(409);
      expect(await f.source.getRepository(Appointment).countBy({ orderId: ctx.order.id })).toBe(
        completeFirst ? 1 : 2,
      );
      expect((await f.orders.detail(ctx.order.id)).progress === 'COMPLETED').toBe(completeFirst);
    }
  });

  it('serializes a newly requested return obligation against completion and requires explicit reopen before adding work to a completed order', async () => {
    for (const completeFirst of [true, false]) {
      const { ctx } = await readyVisit(),
        assignment = await f.detail(ctx.actors[0]![0]!, ctx.assignmentIds[0]!),
        input = await command(ctx.order.id),
        done = () => complete(ctx.order.id, input);
      const request = () =>
        f.call(
          f.dispatcher,
          '/backoffice/assignments/' + assignment.id + '/return-request',
          'POST',
          {
            operationKey: freshOperation(),
            expectedExecutionVersion: assignment.execution.version,
            reason: 'Explicit additional fixture obligation',
            remainingWork: 'Perform an extra fitting check',
          },
        );
      const responses = await ordered(
        ctx.order.id,
        completeFirst ? done : request,
        completeFirst ? request : done,
      );
      expect(responses[0]!.status).toBe(200);
      expect(responses[1]!.status).toBe(409);
      expect((await f.orders.detail(ctx.order.id)).progress === 'COMPLETED').toBe(completeFirst);
    }
  });

  it('serializes the actual return-plan endpoint against completion in both observed commit orders while OPEN and PLANNED needs keep closure blocked', async () => {
    for (const planFirst of [true, false]) {
      const { ctx } = await readyVisit(),
        source = await f.detail(ctx.actors[0]![0]!, ctx.assignmentIds[0]!);
      const created = await json<ReturnRequestResponse>(
        await f.call(
          f.dispatcher,
          '/backoffice/assignments/' + source.id + '/return-request',
          'POST',
          {
            operationKey: freshOperation(),
            expectedExecutionVersion: source.execution.version,
            reason: 'An explicit additional fitting inspection is needed',
            remainingWork: 'Inspect the replacement fitting with a separate tool',
          },
        ),
      );
      const request = created.request.request;
      expect(request.status).toBe('OPEN');
      const before = await readiness(ctx.order.id);
      expect(before.canComplete).toBe(false);
      expect(
        before.blockers.some(
          (blocker) => blocker.code === 'RETURN_REQUIRED' && blocker.requestId === request.id,
        ),
      ).toBe(true);
      const input = await command(ctx.order.id),
        planBody: PlanReturnVisitCommand = {
          operationKey: freshOperation(),
          expectedVersion: request.version,
          localStart: '2030-01-07T12:00',
          durationMinutes: 60,
          crewIds: ctx.crews.map((crew) => crew.id),
          carriedTasks: [],
          newTasks: [
            {
              crewId: ctx.crews[0]!.id,
              name: 'Inspect replacement fitting',
              description: 'New explicit text work after the original completed participation',
              required: true,
              severity: 'MEDIUM',
              priority: 50,
              reason: 'A distinct inspection requires another visit',
            },
          ],
          itemTargets: [],
          reason: 'Dispatcher explicitly plans this still-open need',
        };
      const plan = () =>
          f.call(
            f.dispatcher,
            '/backoffice/return-requests/' + request.id + '/plan',
            'POST',
            planBody,
          ),
        done = () => complete(ctx.order.id, input);
      // OPEN already forbids closure: the fixture must not forge a completed order with an open need.
      const responses = await ordered(
        ctx.order.id,
        planFirst ? plan : done,
        planFirst ? done : plan,
      );
      expect(responses.map((response) => response.status)).toEqual(
        planFirst ? [200, 409] : [409, 200],
      );
      const planned = await json<ReturnRequestResponse>(responses[planFirst ? 0 : 1]!);
      expect(planned.request.request.status).toBe('PLANNED');
      expect(planned.request.currentAppointment).not.toBeNull();
      const after = await readiness(ctx.order.id);
      expect(after.currentCompletion).toBeNull();
      expect(after.canComplete).toBe(false);
      expect(
        after.blockers.some(
          (blocker) => blocker.code === 'RETURN_REQUIRED' && blocker.requestId === request.id,
        ),
      ).toBe(true);
      expect(
        after.blockers.some(
          (blocker) =>
            blocker.code === 'UNSTARTED_VISIT' &&
            blocker.appointmentId === planned.request.currentAppointment!.id,
        ),
      ).toBe(true);
      expect(
        await f.source.getRepository(CompletionRecord).countBy({ orderId: ctx.order.id }),
      ).toBe(0);
    }
  });

  it('serializes snapshot invalidation and completion in both commit orders, atomically reopens when necessary and requires fresh acknowledgements', async () => {
    for (const completeFirst of [true, false]) {
      const { ctx, doc } = await readyVisit(),
        input = await command(ctx.order.id),
        done = () => complete(ctx.order.id, input);
      const invalidate = () =>
        f.call(f.dispatcher, '/acceptance/' + doc.snapshot.id + '/invalidate', 'POST', {
          operationKey: freshOperation(),
          expectedVersion: doc.snapshot.version,
          reason: 'Explicitly correct the prepared fictional result',
        });
      const responses = await ordered(
        ctx.order.id,
        completeFirst ? done : invalidate,
        completeFirst ? invalidate : done,
      );
      expect(responses[0]!.status).toBe(200);
      expect(responses[1]!.status).toBe(completeFirst ? 200 : 409);
      const state = await readiness(ctx.order.id);
      expect(state.currentCompletion).toBeNull();
      expect(state.canComplete).toBe(false);
      expect(state.confirmationsReady).toBe(false);
      expect(
        state.blockers.some(
          (blocker) =>
            blocker.code === 'INVALIDATED_SNAPSHOT' || blocker.code === 'MISSING_SNAPSHOT',
        ),
      ).toBe(true);
      const events = await history(ctx.order.id);
      if (completeFirst) expect(events.reopenEvents[0]!.source).toBe('SNAPSHOT');
    }
  });

  it('keeps pending/rejected exceptions blocking, scopes approval to one requirement and never closes automatically after a concurrent approval', async () => {
    const png = await syntheticSignature();
    for (const approveFirst of [true, false]) {
      const ctx = await completedAcceptanceVisit(f),
        path = '/orders/' + ctx.order.id + '/appointments/' + ctx.appointmentId + '/acceptance';
      const doc = (
          await json<BackofficeAcceptanceResponse>(
            await f.call(f.dispatcher, path, 'POST', { operationKey: freshOperation() }),
          )
        ).acceptance.current!,
        customer = doc.slots.find((slot) => slot.kind === 'CUSTOMER')!,
        staffSlot = doc.slots.find((slot) => slot.kind === 'CREW')!;
      await json(
        await f.call(
          ctx.actors[0]![0]!,
          '/acceptance/' + doc.snapshot.id + '/slots/' + staffSlot.id + '/sign',
          'POST',
          signatureForm(
            {
              operationKey: freshOperation(),
              expectedVersion: doc.snapshot.version,
              consent: true,
            },
            png,
          ),
        ),
      );
      await json(
        await f.call(
          ctx.actors[0]![0]!,
          '/acceptance/' + doc.snapshot.id + '/slots/' + customer.id + '/absence',
          'POST',
          {
            operationKey: freshOperation(),
            expectedVersion: doc.snapshot.version,
            kind: 'REFUSED',
            reason: 'Synthetic representative declined acknowledgement',
          },
        ),
      );
      const pending = await readiness(ctx.order.id);
      expect(pending.physicalReady).toBe(true);
      expect(pending.blockers.map((blocker) => blocker.code)).toEqual(['PENDING_EXCEPTION']);
      expect(
        pending.blockers.some(
          (blocker) => blocker.code === 'PENDING_EXCEPTION' && blocker.slotId === customer.id,
        ),
      ).toBe(true);
      const input = await command(ctx.order.id),
        approve = () =>
          f.call(
            f.dispatcher,
            '/acceptance/' + doc.snapshot.id + '/slots/' + customer.id + '/review',
            'POST',
            {
              operationKey: freshOperation(),
              expectedVersion: doc.snapshot.version,
              decision: 'APPROVED',
              reason: 'Considered only this absent customer confirmation',
            },
          );
      const done = () => complete(ctx.order.id, input);
      const responses = await ordered(
        ctx.order.id,
        approveFirst ? approve : done,
        approveFirst ? done : approve,
      );
      expect(responses.map((response) => response.status)).toEqual(
        approveFirst ? [200, 409] : [409, 200],
      );
      const after = await readiness(ctx.order.id);
      expect(after.currentCompletion).toBeNull();
      expect(after.canComplete).toBe(true);
      expect(after.confirmationsReady).toBe(true);
      expect(after.blockers).toEqual([]);
      expect(
        await f.source.getRepository(CompletionRecord).countBy({ orderId: ctx.order.id }),
      ).toBe(0);
    }
    const rejectedCtx = await completedAcceptanceVisit(f),
      rejectedPath =
        '/orders/' +
        rejectedCtx.order.id +
        '/appointments/' +
        rejectedCtx.appointmentId +
        '/acceptance';
    const rejectedDoc = (
        await json<BackofficeAcceptanceResponse>(
          await f.call(f.dispatcher, rejectedPath, 'POST', { operationKey: freshOperation() }),
        )
      ).acceptance.current!,
      rejectedSlot = rejectedDoc.slots.find((slot) => slot.kind === 'CUSTOMER')!;
    await json(
      await f.call(
        rejectedCtx.actors[0]![0]!,
        '/acceptance/' + rejectedDoc.snapshot.id + '/slots/' + rejectedSlot.id + '/absence',
        'POST',
        {
          operationKey: freshOperation(),
          expectedVersion: rejectedDoc.snapshot.version,
          kind: 'ABSENT',
          reason: 'Synthetic representative unavailable',
        },
      ),
    );
    await json(
      await f.call(
        f.dispatcher,
        '/acceptance/' + rejectedDoc.snapshot.id + '/slots/' + rejectedSlot.id + '/review',
        'POST',
        {
          operationKey: freshOperation(),
          expectedVersion: rejectedDoc.snapshot.version,
          decision: 'REJECTED',
          reason: 'Synthetic exception remains unaccepted',
        },
      ),
    );
    expect(
      (await readiness(rejectedCtx.order.id)).blockers.some(
        (blocker) => blocker.code === 'REJECTED_EXCEPTION' && blocker.slotId === rejectedSlot.id,
      ),
    ).toBe(true);
    expect((await complete(rejectedCtx.order.id)).status).toBe(409);
  });

  it('rechecks disabled authority, changed roles and expired sessions after real PostgreSQL waits before committing a completion', async () => {
    const { ctx } = await readyVisit(),
      input = await command(ctx.order.id);
    for (const roleChange of [false, true]) {
      const actor = await f.makeActor('DISPATCHER');
      const held = await f.barrier('app_user', actor.user.id),
        pending = complete(ctx.order.id, input, actor);
      try {
        await f.waiters(held.pid, 1);
        await held.runner.manager
          .getRepository(User)
          .update(actor.user.id, roleChange ? { role: 'CREW_MEMBER' } : { active: false });
        await held.runner.commitTransaction();
      } finally {
        if (held.runner.isTransactionActive) await held.runner.rollbackTransaction();
        await held.runner.release();
      }
      expect((await pending).status).toBe(roleChange ? 403 : 401);
    }
    const other = await f.makeActor('DISPATCHER');
    await f.source
      .getRepository(AuthSession)
      .update({ userId: other.user.id }, { expiresAt: new Date('2030-01-07T08:01:00.000Z') });
    const order = await f.barrier('delivery_order', ctx.order.id),
      waiting = complete(ctx.order.id, input, other);
    try {
      await f.waiters(order.pid, 1);
      vi.setSystemTime(new Date('2030-01-07T08:02:00.000Z'));
    } finally {
      await order.runner.rollbackTransaction();
      await order.runner.release();
    }
    expect((await waiting).status).toBe(401);
    expect(await f.source.getRepository(CompletionRecord).countBy({ orderId: ctx.order.id })).toBe(
      0,
    );
    expect((await complete(ctx.order.id, input, ctx.actors[0]![0]!)).status).toBe(403);
  });

  it('rolls back completion pointer, immutable record and receipt on audit failure before allowing an exact safe retry', async () => {
    const { ctx } = await readyVisit(),
      input = await command(ctx.order.id),
      count = await f.history(ctx.order.id),
      receipts = await f.source.getRepository(EvidenceReceipt).countBy({ orderId: ctx.order.id });
    await f.source.query(
      `CREATE FUNCTION "${f.schema}".reject_order_completion_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id='${ctx.order.id}'::uuid THEN RAISE EXCEPTION 'fixture completion audit unavailable'; END IF; RETURN NEW; END $$`,
    );
    await f.source.query(
      `CREATE TRIGGER order_completion_audit_failure BEFORE INSERT ON "${f.schema}".activity_log FOR EACH ROW EXECUTE FUNCTION "${f.schema}".reject_order_completion_audit()`,
    );
    try {
      expect((await complete(ctx.order.id, input)).status).toBe(500);
      expect(
        await f.source.getRepository(CompletionRecord).countBy({ orderId: ctx.order.id }),
      ).toBe(0);
      expect((await readiness(ctx.order.id)).currentCompletion).toBeNull();
      expect(await f.source.getRepository(EvidenceReceipt).countBy({ orderId: ctx.order.id })).toBe(
        receipts,
      );
      expect(await f.history(ctx.order.id)).toBe(count);
    } finally {
      await f.source.query(
        `DROP TRIGGER order_completion_audit_failure ON "${f.schema}".activity_log`,
      );
      await f.source.query(`DROP FUNCTION "${f.schema}".reject_order_completion_audit()`);
    }
    expect((await complete(ctx.order.id, input)).status).toBe(200);
    expect(await f.source.getRepository(CompletionRecord).countBy({ orderId: ctx.order.id })).toBe(
      1,
    );
  });

  it('requires separate acknowledgements for both the partial source visit and successful resolved M6 return coverage without changing old reports', async () => {
    const source = await f.context(),
      actor = source.actors[0]![0]!,
      id = source.assignmentIds[0]!;
    await f.start(source);
    await setAcceptanceQuantities(f, actor, id, false);
    const original = await finishAcceptanceTeam(f, source, 0, 'PARTIALLY_COMPLETED', true),
      requestId = original.returnRequests.find((request) => request.assignmentId === id)!.id,
      route = '/backoffice/return-requests/' + requestId;
    const detail = (await json<ReturnRequestResponse>(await f.call(f.dispatcher, route))).request;
    const input: PlanReturnVisitCommand = {
      operationKey: freshOperation(),
      expectedVersion: detail.request.version,
      localStart: '2030-01-07T12:00',
      durationMinutes: 60,
      crewIds: source.crews.map((crew) => crew.id),
      carriedTasks: detail.scopeCandidates.map((task) => ({
        sourceTaskId: task.sourceTaskId,
        crewId: source.crews[0]!.id,
      })),
      newTasks: [],
      itemTargets: detail.items.map((item) => ({
        itemId: item.id,
        deliveredQuantity: item.quantity,
        assembledQuantity: item.requiresAssembly ? item.quantity : 0,
      })),
      reason: 'Explicit synthetic follow-up scope',
    };
    const planned = (
      await json<ReturnRequestResponse>(await f.call(f.dispatcher, route + '/plan', 'POST', input))
    ).request.currentAppointment!;
    expect((await readiness(source.order.id)).blockers.map((blocker) => blocker.code)).toContain(
      'RETURN_REQUIRED',
    );
    const confirmation = await json<AppointmentResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + source.order.id + '/appointments/' + planned.id + '/confirm',
        'POST',
        { expectedVersion: planned.version },
      ),
      201,
    );
    const follow: EvidenceContext = {
      ...source,
      appointmentId: planned.id,
      appointmentVersion: confirmation.appointment.version,
      assignmentIds: [
        confirmation.appointment.assignments.find((assignment) => assignment.status === 'ASSIGNED')!
          .id,
      ],
    };
    await f.start(follow);
    await completeAcceptanceTasks(f, actor, follow.assignmentIds[0]!);
    await setAcceptanceQuantities(f, actor, follow.assignmentIds[0]!);
    await finishAcceptanceTeam(f, follow);
    const ready = (await json<ReturnRequestResponse>(await f.call(f.dispatcher, route))).request;
    await json<ReturnRequestResponse>(
      await f.call(f.dispatcher, route + '/resolve', 'POST', {
        operationKey: freshOperation(),
        expectedVersion: ready.request.version,
        reason: 'Dispatcher verified source coverage explicitly',
      }),
    );
    await acknowledgeAcceptanceVisit(f, follow);
    const missingSource = await readiness(source.order.id);
    expect(missingSource.physicalReady).toBe(true);
    expect(missingSource.canComplete).toBe(false);
    expect(
      missingSource.blockers.some(
        (blocker) =>
          blocker.appointmentId === source.appointmentId && blocker.code === 'MISSING_SNAPSHOT',
      ),
    ).toBe(true);
    const sourceDoc = await acknowledgeAcceptanceVisit(f, source, true);
    expect(sourceDoc.snapshot.payload.teams[0]!.quantities[0]!.deliveredQuantity).toBe(1);
    const completed = await json<CompletionOperationResponse>(await complete(source.order.id));
    expect(completed.readiness.currentCompletion!.readiness.coverageRequestIds).toContain(
      requestId,
    );
    expect(completed.readiness.currentCompletion!.readiness.snapshotIds).toHaveLength(2);
    expect((await f.orders.detail(source.order.id)).progress).toBe('COMPLETED');
    expect((await f.detail(actor, id)).finishReport).toEqual(original.finishReport);
    expect((await f.detail(actor, id)).execution.status).toBe('PARTIALLY_COMPLETED');
  });

  it('keeps detail/list/dashboard completed state and financial aggregates consistent without multiplying joins or hiding unrelated issues', async () => {
    const { ctx } = await readyVisit(2, true),
      before = await f.orders.dashboard();
    const first = await json<CompletionOperationResponse>(await complete(ctx.order.id));
    const detail = await f.orders.detail(ctx.order.id),
      after = await f.orders.dashboard();
    expect(detail.progress).toBe('COMPLETED');
    expect(after.completedCount).toBe(before.completedCount + 1);
    expect([
      after.orderTotalCents,
      after.paidCents,
      after.balanceCents,
      after.openIssueCount,
      after.returnVisitRequiredCount,
    ]).toEqual([
      before.orderTotalCents,
      before.paidCents,
      before.balanceCents,
      before.openIssueCount,
      before.returnVisitRequiredCount,
    ]);
    await json<CompletionOperationResponse>(
      await reopen(ctx.order.id, 'Verify the dashboard follows the current completion pointer'),
    );
    const opened = await f.orders.dashboard(),
      openHistory = await history(ctx.order.id);
    expect(opened.completedCount).toBe(before.completedCount);
    expect(openHistory.completions).toHaveLength(1);
    expect(openHistory.currentCompletionId).toBeNull();
    expect((await f.orders.detail(ctx.order.id)).progress).toBe('AWAITING_REVIEW');
    const second = await json<CompletionOperationResponse>(await complete(ctx.order.id));
    expect(second.readiness.currentCompletion!.id).not.toBe(first.readiness.currentCompletion!.id);
    const reclosed = await f.orders.dashboard(),
      closedHistory = await history(ctx.order.id);
    expect(closedHistory.completions).toHaveLength(2);
    expect(closedHistory.currentCompletionId).toBe(second.readiness.currentCompletion!.id);
    expect(reclosed.completedCount).toBe(before.completedCount + 1);
    for (const dashboard of [opened, reclosed])
      expect([
        dashboard.orderTotalCents,
        dashboard.paidCents,
        dashboard.balanceCents,
        dashboard.openIssueCount,
        dashboard.returnVisitRequiredCount,
      ]).toEqual([
        before.orderTotalCents,
        before.paidCents,
        before.balanceCents,
        before.openIssueCount,
        before.returnVisitRequiredCount,
      ]);
    const list = await f.call(
      f.dispatcher,
      '/orders?' + new URLSearchParams({ progress: 'COMPLETED', page: '1', pageSize: '100' }),
    );
    expect(list.status).toBe(200);
    const result = (await list.json()) as { orders: { id: string; progress: string }[] };
    expect(
      result.orders.some((order) => order.id === ctx.order.id && order.progress === 'COMPLETED'),
    ).toBe(true);
  });
});
