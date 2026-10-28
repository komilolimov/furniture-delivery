import type {
  AcceptanceDocumentRecord,
  AppointmentResponse,
  ApplyRescheduleCommand,
  ApplyRescheduleResponse,
  AttachmentResponse,
  BackofficeAcceptanceResponse,
  CompleteOrderCommand,
  CompletionHistoryResponse,
  CompletionOperationResponse,
  CompletionReadinessResponse,
  CrewAssignmentListResponse,
  CrewAssignmentResponse,
  DashboardResponse,
  EstimateResponse,
  IssueRecord,
  IssueResponse,
  OrderResponse,
  PaymentResponse,
  PlanReturnVisitCommand,
  ReturnRequestResponse,
  RiskBoardResponse,
  SlotSearchResponse,
} from '@furniture-delivery/contracts';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeHub } from '../src/realtime/realtime-hub';
import {
  acknowledgeAcceptanceVisit,
  bytesHash,
  completeAcceptanceTasks,
  finishAcceptanceTeam,
  setAcceptanceQuantities,
} from './acceptance-fixture';
import {
  createEvidenceFixture,
  evidenceOrderInput,
  evidenceJson as json,
  freshOperation,
  safeEvidence,
  type EvidenceActor,
  type EvidenceContext,
  type EvidenceFixture,
} from './evidence-fixture';
import { connectTestStream, untilTestCondition } from './stream-client';

const NOW = '2030-01-07T08:00:00.000Z';

describe('M8 HTTP workflows on real isolated PostgreSQL and private storage; not browser E2E', () => {
  let f: EvidenceFixture, hub: RealtimeHub;
  const streams: Awaited<ReturnType<typeof connectTestStream>>[] = [];
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    f = await createEvidenceFixture('m8_workflow', (config, root) => ({
      ...config,
      storage: { ...config.storage, root },
    }));
    hub = f.app.get(RealtimeHub);
  });
  beforeEach(() => vi.setSystemTime(new Date(NOW)));
  afterEach(async () => {
    await Promise.all(streams.splice(0).map((stream) => stream.close()));
    if (hub)
      await untilTestCondition(
        () => hub.inspect().connections === 0 && hub.inspect().authInFlight === 0,
      );
  });
  afterAll(async () => {
    await f?.close();
    vi.useRealTimers();
  });

  const appointmentPath = (ctx: EvidenceContext) =>
    '/orders/' + ctx.order.id + '/appointments/' + ctx.appointmentId;
  const acceptancePath = (ctx: EvidenceContext) => appointmentPath(ctx) + '/acceptance';
  const order = async (id: string) =>
    (await json<OrderResponse>(await f.call(f.dispatcher, '/orders/' + id))).order;
  const readiness = async (id: string) =>
    (
      await json<CompletionReadinessResponse>(
        await f.call(f.dispatcher, '/orders/' + id + '/completion-readiness'),
      )
    ).readiness;
  const dashboard = async () => json<DashboardResponse>(await f.call(f.dispatcher, '/dashboard'));
  const returnPath = (id: string) => '/backoffice/return-requests/' + id;
  const readReturn = async (id: string) =>
    (await json<ReturnRequestResponse>(await f.call(f.dispatcher, returnPath(id)))).request;
  const readAcceptance = async (ctx: EvidenceContext) =>
    (await json<BackofficeAcceptanceResponse>(await f.call(f.dispatcher, acceptancePath(ctx))))
      .acceptance.current!;

  /** Only actors/teams are fixture preparation. All order/planning/execution actions use HTTP. */
  async function context(
    options: { crews?: number; source?: EvidenceContext; localStart?: string } = {},
  ): Promise<EvidenceContext> {
    const crews =
      options.source?.crews ??
      (await Promise.all(Array.from({ length: options.crews ?? 1 }, () => f.makeCrew())));
    const actors =
      options.source?.actors ??
      (await Promise.all(crews.map(async (crew) => [await f.makeActor('CREW_MEMBER', crew.id)])));
    const input = evidenceOrderInput();
    const created = await json<OrderResponse>(
      await f.call(f.dispatcher, '/orders', 'POST', {
        ...input,
        customerName: 'Synthetic M8 workflow customer',
        orderTotalCents: 10000,
        items: [{ ...input.items[0]!, description: 'Synthetic M8 assembly table', quantity: 2 }],
      }),
      201,
    );
    const planned = await json<AppointmentResponse>(
      await f.call(f.dispatcher, '/orders/' + created.order.id + '/appointments', 'POST', {
        idempotencyKey: freshOperation(),
        localStart: options.localStart ?? '2030-01-07T09:00',
        durationMinutes: 60,
        crewIds: crews.map((crew) => crew.id),
        notes: 'PRIVATE APPOINTMENT EVIDENCE FIXTURE',
      }),
      201,
    );
    const confirmed = await json<AppointmentResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + created.order.id + '/appointments/' + planned.appointment.id + '/confirm',
        'POST',
        { expectedVersion: planned.appointment.version },
      ),
      201,
    );
    return {
      order: confirmed.order,
      appointmentId: confirmed.appointment.id,
      appointmentVersion: confirmed.appointment.version,
      crews,
      actors,
      assignmentIds: crews.map(
        (crew) =>
          confirmed.appointment.assignments.find(
            (assignment) => assignment.crewId === crew.id && assignment.status === 'ASSIGNED',
          )!.id,
      ),
    };
  }
  async function confirmFollow(
    source: EvidenceContext,
    appointment: AppointmentResponse['appointment'],
  ): Promise<EvidenceContext> {
    const result = await json<AppointmentResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + source.order.id + '/appointments/' + appointment.id + '/confirm',
        'POST',
        { expectedVersion: appointment.version },
      ),
      201,
    );
    return {
      ...source,
      appointmentId: result.appointment.id,
      appointmentVersion: result.appointment.version,
      assignmentIds: source.crews.map(
        (crew) =>
          result.appointment.assignments.find(
            (assignment) => assignment.status === 'ASSIGNED' && assignment.crewId === crew.id,
          )!.id,
      ),
    };
  }
  async function complete(id: string, command?: CompleteOrderCommand) {
    const input = command ?? {
      operationKey: freshOperation(),
      expectedVersion: (await readiness(id)).orderVersion,
      reason: 'Dispatcher explicitly verified the synthetic workflow result',
    };
    return {
      input,
      result: await json<CompletionOperationResponse>(
        await f.call(f.dispatcher, '/orders/' + id + '/complete', 'POST', input),
      ),
    };
  }
  async function resolveIssue(orderId: string, issue: IssueRecord) {
    return json<IssueResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + orderId + '/issues/' + issue.id + '/resolve',
        'POST',
        {
          operationKey: freshOperation(),
          expectedVersion: issue.version,
          reason: 'Dispatcher verified the fictional fitting issue resolution',
        },
      ),
    );
  }
  async function photo(actor: EvidenceActor, assignmentId: string, itemId: string) {
    const bytes = await sharp({
      create: { width: 12, height: 12, channels: 3, background: '#394893' },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append('operationKey', freshOperation());
    form.append('proofType', 'MISSING_PARTS');
    form.append('itemId', itemId);
    form.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
      'synthetic-table-proof.png',
    );
    return (
      await json<AttachmentResponse>(
        await f.call(actor, f.path(assignmentId, '/attachments'), 'POST', form),
      )
    ).attachment;
  }
  async function stream(actor: EvidenceActor) {
    const opened = await connectTestStream(f.base, actor.cookie);
    streams.push(opened);
    expect(opened.response.status).toBe(200);
    expect(await opened.take('ready')).toBeDefined();
    return opened;
  }
  async function closeStreams() {
    await Promise.all(streams.splice(0).map((opened) => opened.close()));
    await untilTestCondition(
      () => hub.inspect().connections === 0 && hub.inspect().authInFlight === 0,
    );
  }
  const finance = (value: DashboardResponse) => [
    value.orderTotalCents,
    value.paidCents,
    value.balanceCents,
  ];

  it('creates through HTTP, performs a two-team visit with shared absolute quantities, observes SSE/refetch, signs the immutable result and explicitly closes without financial fanout', async () => {
    const baseline = await dashboard(),
      ctx = await context({ crews: 2 }),
      first = ctx.actors[0]![0]!,
      second = ctx.actors[1]![0]!,
      id = ctx.assignmentIds[0]!,
      secondId = ctx.assignmentIds[1]!;
    const paymentInput = {
      amountCents: 4000,
      paidOn: '2030-01-07',
      method: 'CASH',
      idempotencyKey: freshOperation(),
    };
    const paid = await json<PaymentResponse>(
      await f.call(f.dispatcher, '/orders/' + ctx.order.id + '/payments', 'POST', paymentInput),
      201,
    );
    const paymentReplay = await json<PaymentResponse>(
      await f.call(f.dispatcher, '/orders/' + ctx.order.id + '/payments', 'POST', paymentInput),
      201,
    );
    expect(paymentReplay.payment.id).toBe(paid.payment.id);
    expect(paymentReplay.order.payments).toHaveLength(1);
    const mistaken = await json<PaymentResponse>(
      await f.call(f.dispatcher, '/orders/' + ctx.order.id + '/payments', 'POST', {
        ...paymentInput,
        amountCents: 1000,
        idempotencyKey: freshOperation(),
      }),
      201,
    );
    await json<PaymentResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + ctx.order.id + '/payments/' + mistaken.payment.id + '/void',
        'POST',
        { reason: 'Fictional manual entry correction retains ledger history' },
      ),
      201,
    );
    const initialFirst = await f.start(ctx, 0),
      initialSecond = await f.start(ctx, 1);
    expect(initialFirst.tasks.length).toBeGreaterThan(0);
    expect(
      initialSecond.tasks
        .map((task) => task.id)
        .some((taskId) => initialFirst.tasks.some((task) => task.id === taskId)),
    ).toBe(false);
    const crewStream = await stream(second),
      dispatcherStream = await stream(f.dispatcher),
      item = initialFirst.items[0]!;
    const quantityInput = {
      operationKey: freshOperation(),
      expectedFulfillmentVersion: item.fulfillmentVersion,
      deliveredQuantity: 1,
      assembledQuantity: 0,
    };
    const quantity = await json<CrewAssignmentResponse>(
      await f.call(first, f.path(id, '/items/' + item.id + '/fulfillment'), 'POST', quantityInput),
    );
    await hub.flush();
    const crewHint = await crewStream.take('invalidate'),
      backofficeHint = await dispatcherStream.take('invalidate');
    expect(crewHint?.data.topics).toContain('crew-work');
    expect(backofficeHint?.data.topics).toContain('orders');
    for (const hint of [crewHint, backofficeHint])
      expect(Object.keys(hint!.data).sort()).toEqual(['emittedAt', 'eventId', 'topics']);
    const canonical = await f.detail(second, secondId);
    safeEvidence(canonical);
    expect(canonical.items[0]).toMatchObject({
      id: item.id,
      quantity: 2,
      deliveredQuantity: 1,
      assembledQuantity: 0,
    });
    expect((await order(ctx.order.id)).items[0]).toMatchObject({
      deliveredQuantity: 1,
      assembledQuantity: 0,
    });
    const retry = await json<CrewAssignmentResponse>(
      await f.call(first, f.path(id, '/items/' + item.id + '/fulfillment'), 'POST', quantityInput),
    );
    expect(retry.receipt?.id).toBe(quantity.receipt?.id);
    expect(retry.assignment.items[0]!.deliveredQuantity).toBe(1);
    await closeStreams();
    const task = initialFirst.tasks[0]!;
    await json<CrewAssignmentResponse>(
      await f.call(first, f.path(id, '/tasks/' + task.id + '/result'), 'POST', {
        operationKey: freshOperation(),
        expectedTaskVersion: task.resultVersion,
        resultStatus: 'DONE',
      }),
    );
    expect(
      (await f.detail(second, secondId)).tasks.find((candidate) => candidate.name === task.name)!
        .resultStatus,
    ).toBe('PENDING');
    await completeAcceptanceTasks(f, first, id);
    await completeAcceptanceTasks(f, second, secondId);
    await setAcceptanceQuantities(f, first, id);
    // The second team records the same accumulated totals, rather than adding another two units.
    await setAcceptanceQuantities(f, second, secondId);
    const firstFinished = await finishAcceptanceTeam(f, ctx, 0);
    expect(firstFinished.execution.status).toBe('COMPLETED');
    expect((await f.detail(second, secondId)).execution.status).toBe('IN_PROGRESS');
    expect((await readiness(ctx.order.id)).canComplete).toBe(false);
    const secondFinished = await finishAcceptanceTeam(f, ctx, 1);
    expect(secondFinished.finishReport!.id).not.toBe(firstFinished.finishReport!.id);
    const unsigned = await readiness(ctx.order.id);
    expect(unsigned.physicalReady).toBe(true);
    expect(unsigned.confirmationsReady).toBe(false);
    const doc = await acknowledgeAcceptanceVisit(f, ctx);
    safeEvidence(doc);
    expect(doc.slots.map((slot) => slot.status)).toEqual(['SIGNED', 'SIGNED', 'SIGNED']);
    expect(doc.snapshot.payload.teams.map((team) => team.finishReportId).sort()).toEqual(
      [firstFinished.finishReport!.id, secondFinished.finishReport!.id].sort(),
    );
    expect(new Set(doc.slots.map((slot) => slot.confirmation!.snapshotHash))).toEqual(
      new Set([doc.snapshot.hash]),
    );
    const ready = await readiness(ctx.order.id);
    expect(ready.canComplete).toBe(true);
    expect(ready.signatureIds).toHaveLength(3);
    const closed = await complete(ctx.order.id);
    expect(closed.result.readiness.currentCompletion!.readiness.snapshotIds).toEqual([
      doc.snapshot.id,
    ]);
    const current = await order(ctx.order.id);
    expect(current.progress).toBe('COMPLETED');
    expect(current.items[0]).toMatchObject({
      quantity: 2,
      deliveredQuantity: 2,
      assembledQuantity: 2,
    });
    expect(current.payments).toHaveLength(2);
    expect(current.paidCents).toBe(4000);
    expect(current.balanceCents).toBe(6000);
    expect(current.paymentStatus).toBe('PARTIALLY_PAID');
    expect((await readAcceptance(ctx)).snapshot).toEqual(doc.snapshot);
    const after = await dashboard();
    expect(finance(after)).toEqual([
      baseline.orderTotalCents + 10000,
      baseline.paidCents + 4000,
      baseline.balanceCents + 6000,
    ]);
    expect(after.completedCount).toBe(baseline.completedCount + 1);
  });

  it('moves only an unstarted at-risk next visit after preview, then explicitly plans and resolves residual return work while retaining the partial report and both visit signatures', async () => {
    const source = await context(),
      actor = source.actors[0]![0]!,
      id = source.assignmentIds[0]!;
    const next = await context({ source, localStart: '2030-01-07T11:00' });
    await f.start(source);
    vi.setSystemTime(new Date('2030-01-07T09:15:00.000Z'));
    const beforeEstimate = await f.detail(actor, id);
    const estimated = await json<EstimateResponse>(
      await f.call(actor, f.path(id, '/estimate'), 'POST', {
        operationKey: freshOperation(),
        expectedEstimateVersion: beforeEstimate.execution.estimateVersion,
        localFinish: '2030-01-07T11:00',
        reason: 'Crew reports a synthetic assembly delay',
      }),
    );
    expect(estimated.estimatedFinishAt).toBe('2030-01-07T10:00:00.000Z');
    expect(
      (
        await f.call(f.dispatcher, appointmentPath(source) + '/reschedule', 'POST', {
          operationKey: freshOperation(),
          expectedVersion: source.appointmentVersion,
          localStart: '2030-01-07T16:00',
          durationMinutes: 60,
          crewIds: source.crews.map((crew) => crew.id),
          reason: 'An active visit must retain its original plan',
        })
      ).status,
    ).toBe(409);
    const active = await f.detail(actor, id);
    expect(active.plannedStartAt).toBe(beforeEstimate.plannedStartAt);
    expect(active.plannedEndAt).toBe(beforeEstimate.plannedEndAt);
    expect(active.execution.actualEndAt).toBeNull();
    const risks = await json<RiskBoardResponse>(
      await f.call(
        f.dispatcher,
        '/planning/risks?' +
          new URLSearchParams({
            from: '2030-01-07',
            to: '2030-01-08',
            crewIds: source.crews[0]!.id,
            allTeams: 'false',
          }),
      ),
    );
    expect(
      risks.risks
        .find((visit) => visit.appointmentId === next.appointmentId)!
        .reasons.some(
          (reason) =>
            reason.code === 'NEXT_VISIT_AT_RISK' &&
            reason.sourceAppointmentId === source.appointmentId,
        ),
    ).toBe(true);
    const beforePreview = await json<AppointmentResponse>(
      await f.call(f.dispatcher, appointmentPath(next)),
    );
    const candidates = await json<SlotSearchResponse>(
      await f.call(
        f.dispatcher,
        '/planning/available-windows?' +
          new URLSearchParams({
            context: 'APPOINTMENT',
            orderId: next.order.id,
            appointmentId: next.appointmentId,
            earliestLocal: '2030-01-07T11:00',
            from: '2030-01-07',
            to: '2030-01-08',
            durationMinutes: '60',
            crewIds: source.crews[0]!.id,
            alternativeCrews: 'false',
          }),
      ),
    );
    const preview = candidates.candidates[0]!;
    expect(preview.localStart).toBe('2030-01-07T11:30');
    expect(preview.basis).toBe('ESTIMATE');
    const afterPreview = await json<AppointmentResponse>(
      await f.call(f.dispatcher, appointmentPath(next)),
    );
    expect(afterPreview.appointment).toEqual(beforePreview.appointment);
    expect(afterPreview.order.activity).toEqual(beforePreview.order.activity);
    const applyInput: ApplyRescheduleCommand = {
      operationKey: freshOperation(),
      expectedVersion: beforePreview.appointment.version,
      localStart: preview.localStart,
      durationMinutes: preview.durationMinutes,
      crewIds: preview.crewIds,
      reason: 'Dispatcher explicitly confirms the non-reserving search preview',
    };
    const moved = await json<ApplyRescheduleResponse>(
      await f.call(f.dispatcher, appointmentPath(next) + '/reschedule', 'POST', applyInput),
    );
    expect(moved.appointment.id).toBe(next.appointmentId);
    expect(moved.appointment.confirmationStatus).toBe('NEEDS_CONFIRMATION');
    expect(moved.appointment.confirmedAt).toBeNull();
    expect(
      moved.appointment.assignments
        .flatMap((assignment) => assignment.tasks.map((task) => task.id))
        .sort(),
    ).toEqual(
      beforePreview.appointment.assignments
        .flatMap((assignment) => assignment.tasks.map((task) => task.id))
        .sort(),
    );
    const movedRetry = await json<ApplyRescheduleResponse>(
      await f.call(f.dispatcher, appointmentPath(next) + '/reschedule', 'POST', applyInput),
    );
    expect(movedRetry.appointment).toEqual(moved.appointment);
    expect(movedRetry.receipt.id).toBe(moved.receipt.id);
    const firstTask = active.tasks[0]!;
    await json<CrewAssignmentResponse>(
      await f.call(actor, f.path(id, '/tasks/' + firstTask.id + '/result'), 'POST', {
        operationKey: freshOperation(),
        expectedTaskVersion: firstTask.resultVersion,
        resultStatus: 'DONE',
      }),
    );
    await setAcceptanceQuantities(f, actor, id, false);
    const attachment = await photo(actor, id, active.items[0]!.id);
    const issue = await json<IssueResponse>(
      await f.call(actor, f.path(id, '/issues'), 'POST', {
        operationKey: freshOperation(),
        type: 'MISSING_PARTS',
        description: 'Synthetic missing table fitting requires another visit',
        reportedSource: 'CREW',
        itemIds: [active.items[0]!.id],
        attachmentIds: [attachment.id],
      }),
    );
    const partial = await finishAcceptanceTeam(f, source, 0, 'PARTIALLY_COMPLETED', true),
      originalReport = partial.finishReport!;
    expect(partial.execution.actualEndAt).toBe('2030-01-07T09:15:00.000Z');
    expect(new Date(partial.execution.actualEndAt!).getTime()).toBeGreaterThan(
      new Date(partial.plannedEndAt).getTime(),
    );
    expect(originalReport.quantities[0]).toMatchObject({
      deliveredQuantity: 1,
      assembledQuantity: 0,
    });
    expect(originalReport.attachmentIds).toContain(attachment.id);
    expect(originalReport.knownIssueIds).toContain(issue.issue.id);
    const requestId = partial.returnRequests.find((request) => request.assignmentId === id)!.id,
      need = await readReturn(requestId);
    expect(need.request.status).toBe('OPEN');
    expect(need.sourceReport).toEqual(originalReport);
    const residual = need.scopeCandidates.filter((task) => task.resultStatus === 'PENDING');
    expect(residual.length).toBeGreaterThan(0);
    const plan: PlanReturnVisitCommand = {
      operationKey: freshOperation(),
      expectedVersion: need.request.version,
      localStart: '2030-01-07T15:00',
      durationMinutes: 60,
      crewIds: source.crews.map((crew) => crew.id),
      carriedTasks: residual.map((task) => ({
        sourceTaskId: task.sourceTaskId,
        crewId: source.crews[0]!.id,
      })),
      newTasks: [],
      itemTargets: need.items.map((item) => ({
        itemId: item.id,
        deliveredQuantity: item.quantity,
        assembledQuantity: item.requiresAssembly ? item.quantity : 0,
      })),
      reason: 'Dispatcher explicitly plans only unfinished tasks and absolute item targets',
    };
    const planned = (
      await json<ReturnRequestResponse>(
        await f.call(f.dispatcher, returnPath(requestId) + '/plan', 'POST', plan),
      )
    ).request;
    expect(planned.request.status).toBe('PLANNED');
    expect(planned.currentAppointment!.orderId).toBe(source.order.id);
    expect(planned.currentAppointment!.id).not.toBe(source.appointmentId);
    expect(planned.attempts).toHaveLength(1);
    const resolvedIssue = await resolveIssue(source.order.id, issue.issue);
    expect(resolvedIssue.issue.status).toBe('RESOLVED');
    expect((await readReturn(requestId)).request.status).toBe('PLANNED');
    expect((await f.detail(actor, id)).items[0]).toMatchObject({
      deliveredQuantity: 1,
      assembledQuantity: 0,
    });
    const follow = await confirmFollow(source, planned.currentAppointment!),
      followId = follow.assignmentIds[0]!;
    const initialFollow = await f.detail(actor, followId);
    expect(initialFollow.tasks.map((task) => task.sourceTaskId).sort()).toEqual(
      residual.map((task) => task.sourceTaskId).sort(),
    );
    expect(initialFollow.tasks.some((task) => task.sourceTaskId === firstTask.id)).toBe(false);
    expect(initialFollow.returnContext!.requestId).toBe(requestId);
    vi.setSystemTime(new Date('2030-01-07T14:00:00.000Z'));
    await f.start(follow);
    await completeAcceptanceTasks(f, actor, followId);
    await setAcceptanceQuantities(f, actor, followId);
    await finishAcceptanceTeam(f, follow);
    const readyReturn = await readReturn(requestId);
    expect(readyReturn.request.status).toBe('PLANNED');
    expect(readyReturn.readyToResolve).toBe(true);
    expect((await readiness(source.order.id)).blockers.map((blocker) => blocker.code)).toContain(
      'RETURN_REQUIRED',
    );
    const resolved = await json<ReturnRequestResponse>(
      await f.call(f.dispatcher, returnPath(requestId) + '/resolve', 'POST', {
        operationKey: freshOperation(),
        expectedVersion: readyReturn.request.version,
        reason: 'Dispatcher verifies all explicit residual scope and accumulated targets',
      }),
    );
    expect(resolved.request.request.status).toBe('RESOLVED');
    const followDoc = await acknowledgeAcceptanceVisit(f, follow),
      missingSource = await readiness(source.order.id);
    expect(missingSource.physicalReady).toBe(true);
    expect(missingSource.canComplete).toBe(false);
    expect(
      missingSource.blockers.some(
        (blocker) =>
          blocker.appointmentId === source.appointmentId && blocker.code === 'MISSING_SNAPSHOT',
      ),
    ).toBe(true);
    const sourceDoc = await acknowledgeAcceptanceVisit(f, source);
    expect(sourceDoc.snapshot.payload.teams[0]!.quantities[0]).toMatchObject({
      deliveredQuantity: 1,
      assembledQuantity: 0,
    });
    const ready = await readiness(source.order.id);
    expect(ready.canComplete).toBe(true);
    expect(ready.snapshotIds.sort()).toEqual([sourceDoc.snapshot.id, followDoc.snapshot.id].sort());
    expect(ready.coverageRequestIds).toContain(requestId);
    const closed = await complete(source.order.id);
    expect(closed.result.readiness.currentCompletion!.readiness.snapshotIds).toHaveLength(2);
    expect((await order(source.order.id)).progress).toBe('COMPLETED');
    const historical = await f.detail(actor, id);
    expect(historical.execution.status).toBe('PARTIALLY_COMPLETED');
    expect(historical.finishReport).toEqual(originalReport);
    expect(historical.plannedEndAt).toBe(beforeEstimate.plannedEndAt);
    expect(historical.items[0]).toMatchObject({
      quantity: 2,
      deliveredQuantity: 2,
      assembledQuantity: 2,
    });
    expect((await readAcceptance(source)).snapshot).toEqual(sourceDoc.snapshot);
    expect((await readAcceptance(follow)).snapshot).toEqual(followDoc.snapshot);
  });

  it('automatically reopens for a real post-close issue, refuses resurrection by old Complete retry and prevents foreign file/signature/finance reads', async () => {
    const ctx = await context(),
      actor = ctx.actors[0]![0]!,
      id = ctx.assignmentIds[0]!;
    await f.start(ctx);
    const file = await photo(actor, id, ctx.order.items[0]!.id);
    await completeAcceptanceTasks(f, actor, id);
    await setAcceptanceQuantities(f, actor, id);
    await finishAcceptanceTeam(f, ctx);
    const doc: AcceptanceDocumentRecord = await acknowledgeAcceptanceVisit(f, ctx),
      closed = await complete(ctx.order.id),
      completionId = closed.result.readiness.currentCompletion!.id;
    const opened = await json<IssueResponse>(
      await f.call(actor, f.path(id, '/issues'), 'POST', {
        operationKey: freshOperation(),
        type: 'DAMAGE',
        description: 'Synthetic post-completion damage needs dispatcher review',
        reportedSource: 'CREW',
        itemIds: [ctx.order.items[0]!.id],
        attachmentIds: [file.id],
      }),
    );
    expect(opened.issue.status).toBe('OPEN');
    const reopened = await readiness(ctx.order.id);
    expect(reopened.currentCompletion).toBeNull();
    expect(reopened.canComplete).toBe(false);
    expect(
      reopened.blockers.some(
        (blocker) => blocker.code === 'OPEN_ISSUES' && blocker.issueId === opened.issue.id,
      ),
    ).toBe(true);
    const retry = await complete(ctx.order.id, closed.input);
    expect(retry.result.receipt?.id).toBe(closed.result.receipt?.id);
    expect(retry.result.readiness.currentCompletion).toBeNull();
    const resolved = await resolveIssue(ctx.order.id, opened.issue);
    expect(resolved.issue.status).toBe('RESOLVED');
    const afterResolve = await readiness(ctx.order.id);
    expect(afterResolve.currentCompletion).toBeNull();
    expect(afterResolve.canComplete).toBe(true);
    expect((await order(ctx.order.id)).progress).toBe('AWAITING_REVIEW');
    const afterOldRetry = await complete(ctx.order.id, closed.input);
    expect(afterOldRetry.result.readiness.currentCompletion).toBeNull();
    const history = await json<CompletionHistoryResponse>(
      await f.call(f.dispatcher, '/orders/' + ctx.order.id + '/completion-history'),
    );
    expect(history.currentCompletionId).toBeNull();
    expect(history.completions).toHaveLength(1);
    expect(history.completions[0]!.id).toBe(completionId);
    expect(history.reopenEvents).toHaveLength(1);
    expect(history.reopenEvents[0]).toMatchObject({
      source: 'ISSUE',
      sourceId: opened.issue.id,
      completionId,
    });
    const foreign = await context({ localStart: '2030-01-07T13:00' }),
      stranger = foreign.actors[0]![0]!,
      strangerId = foreign.assignmentIds[0]!;
    const ownImage = await f.call(actor, file.contentUrl.replace(/^\/api/, ''));
    expect(ownImage.status).toBe(200);
    expect(ownImage.headers.get('content-type')).toBe('image/webp');
    expect((await ownImage.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(
      (await f.call(stranger, f.path(strangerId, '/attachments/' + file.id + '/content'))).status,
    ).toBe(404);
    expect((await f.call(stranger, file.contentUrl.replace(/^\/api/, ''))).status).toBe(404);
    expect((await f.call(undefined, file.contentUrl.replace(/^\/api/, ''))).status).toBe(401);
    const signature = doc.slots.find((slot) => slot.kind === 'CREW')!.confirmation!,
      signaturePath = '/acceptance/' + doc.snapshot.id + '/signatures/' + signature.id + '/content';
    const ownSignature = await f.call(actor, signaturePath);
    expect(ownSignature.status).toBe(200);
    expect(ownSignature.headers.get('content-type')).toBe('image/png');
    expect(bytesHash(new Uint8Array(await ownSignature.arrayBuffer()))).toBe(signature.imageDigest);
    expect((await f.call(stranger, signaturePath)).status).toBe(404);
    expect((await f.call(undefined, signaturePath)).status).toBe(401);
    for (const employee of [actor, stranger]) {
      expect((await f.call(employee, '/orders/' + ctx.order.id)).status).toBe(403);
      expect((await f.call(employee, '/dashboard')).status).toBe(403);
      expect(
        (
          await f.call(employee, '/orders/' + ctx.order.id + '/payments', 'POST', {
            amountCents: 1,
            paidOn: '2030-01-07',
            method: 'CASH',
            idempotencyKey: freshOperation(),
          })
        ).status,
      ).toBe(403);
    }
    const ownDetail = await f.detail(actor, id);
    safeEvidence(ownDetail);
    expect(ownDetail.orderProgress).toBe('AWAITING_REVIEW');
    const list = await json<CrewAssignmentListResponse>(
      await f.call(stranger, '/crew/assignments?view=open&page=1&pageSize=20'),
    );
    safeEvidence(list);
    expect(list.assignments.some((assignment) => assignment.orderId === ctx.order.id)).toBe(false);
    expect((await readAcceptance(ctx)).snapshot).toEqual(doc.snapshot);
  });
});
