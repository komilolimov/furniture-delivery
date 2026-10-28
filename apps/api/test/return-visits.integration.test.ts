import type {
  AppointmentResponse,
  AttachmentResponse,
  CrewAssignmentResponse,
  IssueResponse,
  PlanReturnVisitCommand,
  ReturnQueueResponse,
  ReturnRequestDetail,
  ReturnRequestResponse,
} from '@furniture-delivery/contracts';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Crew } from '../src/crews/crew.entity';
import { CrewMember } from '../src/identity/crew-member.entity';
import { User } from '../src/identity/user.entity';
import { AuthSession } from '../src/identity/auth-session.entity';
import { ReturnVisitRequest } from '../src/execution/return-visit-request.entity';
import { ReturnVisitAttempt } from '../src/execution/return-visit-attempt.entity';
import { FinishReport } from '../src/execution/finish-report.entity';
import { EvidenceReceipt } from '../src/evidence/evidence-receipt.entity';
import { Task } from '../src/planning/task.entity';
import {
  createEvidenceFixture,
  evidenceJson as json,
  freshOperation,
  safeEvidence,
  type EvidenceActor,
  type EvidenceContext,
  type EvidenceFixture,
} from './evidence-fixture';

const NOW = '2030-01-07T08:00:00.000Z';
describe('M6 explicit return-work scope, immutable attempts and dispatcher resolution', () => {
  let f: EvidenceFixture;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    f = await createEvidenceFixture('m6_return', (config, root) => ({
      ...config,
      storage: { root },
    }));
  }, 30000);
  beforeEach(() => vi.setSystemTime(new Date(NOW)));
  afterAll(async () => {
    await f?.close();
    vi.useRealTimers();
  });

  const requestPath = (id: string) => '/backoffice/return-requests/' + id;
  const read = async (id: string) =>
    (await json<ReturnRequestResponse>(await f.call(f.dispatcher, requestPath(id)))).request;
  const taskResult = async (
    actor: EvidenceActor,
    id: string,
    taskId: string,
    resultStatus: 'DONE' | 'SKIPPED',
  ) => {
    const current = await f.detail(actor, id),
      task = current.tasks.find((entry) => entry.id === taskId)!;
    return (
      await json<CrewAssignmentResponse>(
        await f.call(actor, f.path(id, '/tasks/' + taskId + '/result'), 'POST', {
          operationKey: freshOperation(),
          expectedTaskVersion: task.resultVersion,
          resultStatus,
          ...(resultStatus === 'SKIPPED' ? { reason: 'Optional fixture task not needed' } : {}),
        }),
      )
    ).assignment;
  };
  const completeTasks = async (actor: EvidenceActor, id: string) => {
    let current = await f.detail(actor, id);
    for (const task of current.tasks.filter((entry) => entry.resultStatus === 'PENDING'))
      current = await taskResult(actor, id, task.id, 'DONE');
    return current;
  };
  const fulfill = async (actor: EvidenceActor, id: string) => {
    let current = await f.detail(actor, id);
    for (const item of current.items)
      current = (
        await json<CrewAssignmentResponse>(
          await f.call(actor, f.path(id, '/items/' + item.id + '/fulfillment'), 'POST', {
            operationKey: freshOperation(),
            expectedFulfillmentVersion: item.fulfillmentVersion,
            deliveredQuantity: item.quantity,
            assembledQuantity: item.requiresAssembly ? item.quantity : 0,
          }),
        )
      ).assignment;
    return current;
  };
  const finish = async (
    actor: EvidenceActor,
    id: string,
    outcome: 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'BLOCKED',
    another = false,
  ) => {
    const current = await f.detail(actor, id);
    return (
      await json<CrewAssignmentResponse>(
        await f.action(actor, id, 'finish', {
          operationKey: freshOperation(),
          expectedExecutionVersion: current.execution.version,
          outcome,
          summary: 'Fictional ' + outcome + ' work report',
          ...(outcome !== 'COMPLETED'
            ? {
                reason: 'Fictional missing fitting',
                remainingWork: 'Finish remaining fixture assembly',
              }
            : {}),
          returnVisitRequired: another,
          ...(another ? { returnReason: 'Bring missing fixture fitting' } : {}),
        }),
      )
    ).assignment;
  };
  const partial = async (request = true, optional = false) => {
    const ctx = await f.context(),
      id = ctx.assignmentIds[0]!,
      actor = ctx.actors[0]![0]!;
    let optionalId: string | undefined;
    if (optional)
      optionalId = (
        await f.source.getRepository(Task).save({
          assignmentId: id,
          templateId: null,
          sourceTaskId: null,
          returnScopeKey: null,
          name: 'Optional fictional packaging check',
          description: 'Optional source snapshot',
          required: false,
          severity: 'LOW',
          priority: 90,
        })
      ).id;
    let current = await f.start(ctx);
    const doneId = current.tasks.find((task) => task.required)!.id;
    current = await taskResult(actor, id, doneId, 'DONE');
    if (optionalId) current = await taskResult(actor, id, optionalId, 'SKIPPED');
    await json<CrewAssignmentResponse>(
      await f.call(actor, f.path(id, '/items/' + current.items[0]!.id + '/fulfillment'), 'POST', {
        operationKey: freshOperation(),
        expectedFulfillmentVersion: current.items[0]!.fulfillmentVersion,
        deliveredQuantity: 1,
        assembledQuantity: 0,
      }),
    );
    const finished = await finish(actor, id, 'PARTIALLY_COMPLETED', request);
    return {
      ctx,
      actor,
      id,
      doneId,
      optionalId,
      finished,
      requestId: finished.returnRequests.find((entry) => entry.assignmentId === id)?.id,
    };
  };
  const planInput = (
    detail: ReturnRequestDetail,
    crews: Crew[],
    change: Partial<PlanReturnVisitCommand> = {},
  ): PlanReturnVisitCommand => ({
    operationKey: freshOperation(),
    expectedVersion: detail.request.version,
    localStart: '2030-01-07T12:00',
    durationMinutes: 60,
    crewIds: crews.map((crew) => crew.id),
    carriedTasks: detail.scopeCandidates
      .filter((task) => task.resultStatus === 'PENDING')
      .map((task, index) => ({
        sourceTaskId: task.sourceTaskId,
        crewId: crews[index % crews.length]!.id,
      })),
    newTasks: [],
    itemTargets: detail.items.map((item) => ({
      itemId: item.id,
      deliveredQuantity: item.quantity,
      assembledQuantity: item.requiresAssembly ? item.quantity : 0,
    })),
    reason: 'Explicit fictional remaining-work plan',
    notes: 'PRIVATE APPOINTMENT EVIDENCE FIXTURE',
    ...change,
  });
  const plan = (id: string, body: PlanReturnVisitCommand, actor = f.dispatcher) =>
    f.call(actor, requestPath(id) + '/plan', 'POST', body);
  const resolve = (
    detail: ReturnRequestDetail,
    actor = f.dispatcher,
    operationKey = freshOperation(),
  ) =>
    f.call(actor, requestPath(detail.request.id) + '/resolve', 'POST', {
      operationKey,
      expectedVersion: detail.request.version,
      reason: 'Dispatcher verified the explicit return scope',
    });
  const followContext = async (
    source: EvidenceContext,
    detail: ReturnRequestDetail,
    crews = source.crews,
    actors = source.actors,
  ): Promise<EvidenceContext> => {
    const visit = detail.currentAppointment!;
    const confirmation = await json<AppointmentResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + source.order.id + '/appointments/' + visit.id + '/confirm',
        'POST',
        { expectedVersion: visit.version },
      ),
      201,
    );
    return {
      order: source.order,
      crews,
      actors,
      appointmentId: visit.id,
      appointmentVersion: confirmation.appointment.version,
      assignmentIds: crews.map(
        (crew) =>
          confirmation.appointment.assignments.find(
            (assignment) => assignment.crewId === crew.id && assignment.status === 'ASSIGNED',
          )!.id,
      ),
    };
  };
  const completeFollow = async (ctx: EvidenceContext, quantities = true) => {
    for (let index = 0; index < ctx.crews.length; index++) {
      const actor = ctx.actors[index]![0]!,
        id = ctx.assignmentIds[index]!;
      await f.start(ctx, index);
      await completeTasks(actor, id);
      if (quantities && index === 0) await fulfill(actor, id);
      await finish(actor, id, 'COMPLETED');
    }
  };

  it('creates a dispatcher request for a terminal partial report without a request and never duplicates an existing source need', async () => {
    const source = await partial(false);
    expect(source.requestId).toBeUndefined();
    const input = {
      operationKey: freshOperation(),
      expectedExecutionVersion: source.finished.execution.version,
      reason: 'Dispatcher confirmed remaining fixture work',
      remainingWork: 'Deliver missing fitting and finish assembly',
    };
    const path = '/backoffice/assignments/' + source.id + '/return-request';
    const created = await json<ReturnRequestResponse>(
      await f.call(f.dispatcher, path, 'POST', input),
    );
    expect(created.request.request.status).toBe('OPEN');
    expect(created.request.sourceReport).toEqual(source.finished.finishReport);
    const replay = await json<ReturnRequestResponse>(
      await f.call(f.dispatcher, path, 'POST', input),
    );
    expect(replay.request.request.id).toBe(created.request.request.id);
    const existing = await json<ReturnRequestResponse>(
      await f.call(f.administrator, path, 'POST', { ...input, operationKey: freshOperation() }),
    );
    expect(existing.request.request.id).toBe(created.request.request.id);
    expect(
      await f.source.getRepository(ReturnVisitRequest).countBy({ assignmentId: source.id }),
    ).toBe(1);
    expect((await f.call(source.actor, path, 'POST', input)).status).toBe(403);
  });

  it('creates a distinct same-order follow-up carrying only pending scope once across several teams and preserves the original physical facts', async () => {
    const source = await partial(true, true),
      detail = await read(source.requestId!),
      extra = await f.makeCrew(),
      crews = [source.ctx.crews[0]!, extra];
    await f.orders.recordPayment(
      source.ctx.order.id,
      {
        amountCents: 25000,
        paidOn: '2030-01-07',
        method: 'CASH',
        note: 'Fictional manual payment before follow-up',
        idempotencyKey: freshOperation(),
      },
      f.dispatcher.user.id,
    );
    const financeBefore = await f.orders.dashboard(),
      orderBefore = await f.orders.detail(source.ctx.order.id);
    const report = await f.source
      .getRepository(FinishReport)
      .findOneByOrFail({ assignmentId: source.id });
    const originalTasks = await f.source.getRepository(Task).findBy({ assignmentId: source.id });
    const created = await json<ReturnRequestResponse>(
      await plan(detail.request.id, planInput(detail, crews)),
    );
    const visit = created.request.currentAppointment!;
    expect(visit.id).not.toBe(source.ctx.appointmentId);
    expect(visit.orderId).toBe(source.ctx.order.id);
    expect(visit.confirmationStatus).toBe('NEEDS_CONFIRMATION');
    expect(created.request.request.status).toBe('PLANNED');
    const tasks = visit.assignments.flatMap((assignment) => assignment.tasks);
    expect(tasks.map((task) => task.sourceTaskId).sort()).toEqual(
      detail.scopeCandidates.map((task) => task.sourceTaskId).sort(),
    );
    expect(
      tasks.some((task) => [source.doneId, source.optionalId].includes(task.sourceTaskId ?? '')),
    ).toBe(false);
    expect(new Set(tasks.map((task) => task.sourceTaskId)).size).toBe(tasks.length);
    expect(tasks.every((task) => task.resultStatus === 'PENDING')).toBe(true);
    expect(
      visit.assignments.every((assignment) => assignment.execution.status === 'NOT_STARTED'),
    ).toBe(true);
    expect(
      await f.source.getRepository(FinishReport).findOneByOrFail({ assignmentId: source.id }),
    ).toEqual(report);
    expect(await f.source.getRepository(Task).findBy({ assignmentId: source.id })).toEqual(
      originalTasks,
    );
    const original = await f.detail(source.actor, source.id);
    expect(original.items).toEqual(source.finished.items);
    expect(original.finishReport).toEqual(source.finished.finishReport);
    expect(original.execution.status).toBe('PARTIALLY_COMPLETED');
    const financeAfter = await f.orders.dashboard(),
      orderAfter = await f.orders.detail(source.ctx.order.id);
    expect([
      financeAfter.orderTotalCents,
      financeAfter.paidCents,
      financeAfter.balanceCents,
    ]).toEqual([
      financeBefore.orderTotalCents,
      financeBefore.paidCents,
      financeBefore.balanceCents,
    ]);
    expect(orderAfter.payments).toEqual(orderBefore.payments);
    expect([orderAfter.orderTotalCents, orderAfter.paidCents, orderAfter.balanceCents]).toEqual([
      orderBefore.orderTotalCents,
      orderBefore.paidCents,
      orderBefore.balanceCents,
    ]);
  });

  it('rejects missing required carry, duplicate carry, foreign targets and invented quantities without creating a partial appointment', async () => {
    const source = await partial(),
      detail = await read(source.requestId!),
      foreign = await f.context();
    const base = planInput(detail, source.ctx.crews),
      before = await f.source
        .getRepository(ReturnVisitAttempt)
        .countBy({ requestId: detail.request.id });
    for (const change of [
      { carriedTasks: [] },
      {
        carriedTasks: [base.carriedTasks[0]!, base.carriedTasks[0]!, ...base.carriedTasks.slice(1)],
      },
      {
        carriedTasks: [
          { sourceTaskId: source.doneId, crewId: source.ctx.crews[0]!.id },
          ...base.carriedTasks,
        ],
      },
      {
        itemTargets: [
          { itemId: foreign.order.items[0]!.id, deliveredQuantity: 1, assembledQuantity: 0 },
        ],
      },
      {
        itemTargets: [
          {
            itemId: detail.items[0]!.id,
            deliveredQuantity: detail.items[0]!.quantity + 1,
            assembledQuantity: 0,
          },
        ],
      },
    ])
      expect([400, 404, 409]).toContain(
        (await plan(detail.request.id, { ...base, operationKey: freshOperation(), ...change }))
          .status,
      );
    expect(
      await f.source.getRepository(ReturnVisitAttempt).countBy({ requestId: detail.request.id }),
    ).toBe(before);
    expect((await read(detail.request.id)).request.status).toBe('OPEN');
  });

  it('serializes two different planning keys to one current attempt and replays the same key without recreating visits', async () => {
    const source = await partial(),
      detail = await read(source.requestId!),
      first = planInput(detail, source.ctx.crews),
      second = planInput(detail, source.ctx.crews);
    const responses = await f.overlap(
      'delivery_order',
      source.ctx.order.id,
      () => plan(detail.request.id, first),
      () => plan(detail.request.id, second, f.administrator),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const saved = await read(detail.request.id);
    expect(saved.attempts).toHaveLength(1);
    expect(saved.attempts.filter((attempt) => attempt.current)).toHaveLength(1);
    const winner = responses[0]!.status === 200 ? first : second,
      actor = responses[0]!.status === 200 ? f.dispatcher : f.administrator;
    const replay = await json<ReturnRequestResponse>(await plan(detail.request.id, winner, actor));
    expect(replay.request.currentAppointment!.id).toBe(saved.currentAppointment!.id);
    expect(replay.request.attempts).toHaveLength(1);
    expect(
      (
        await plan(
          detail.request.id,
          { ...winner, reason: 'Changed payload on a completed operation' },
          actor,
        )
      ).status,
    ).toBe(409);
  });

  it('rechecks session expiry after waiting for the order lock before replaying a successful return-plan receipt', async () => {
    const source = await partial(),
      detail = await read(source.requestId!),
      actor = await f.makeActor('DISPATCHER'),
      input = planInput(detail, source.ctx.crews);
    const saved = await json<ReturnRequestResponse>(await plan(detail.request.id, input, actor));
    await f.source
      .getRepository(AuthSession)
      .update({ userId: actor.user.id }, { expiresAt: new Date('2030-01-07T08:01:00.000Z') });
    const held = await f.barrier('delivery_order', source.ctx.order.id),
      pending = plan(detail.request.id, input, actor);
    try {
      await f.waiters(held.pid, 1);
      vi.setSystemTime(new Date('2030-01-07T08:02:00.000Z'));
    } finally {
      await held.runner.rollbackTransaction();
      await held.runner.release();
    }
    expect((await pending).status).toBe(401);
    expect((await read(detail.request.id)).currentAppointment!.id).toBe(
      saved.request.currentAppointment!.id,
    );
    expect(
      await f.source.getRepository(ReturnVisitAttempt).countBy({ requestId: detail.request.id }),
    ).toBe(1);
  });

  it('cancel returns the need to OPEN, keeps history and prevents old replay from resurrecting a cancelled or superseded follow-up', async () => {
    const source = await partial(),
      detail = await read(source.requestId!),
      input = planInput(detail, source.ctx.crews);
    const first = (await json<ReturnRequestResponse>(await plan(detail.request.id, input))).request,
      appointment = first.currentAppointment!;
    await json<AppointmentResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + source.ctx.order.id + '/appointments/' + appointment.id + '/cancel',
        'POST',
        { expectedVersion: appointment.version, reason: 'Fictional follow-up needs a new day' },
      ),
      201,
    );
    const cancelled = await read(detail.request.id);
    expect(cancelled.request.status).toBe('OPEN');
    expect(cancelled.attempts[0]!.closedOutcome).toBe('CANCELLED');
    expect(cancelled.attempts[0]!.current).toBe(false);
    expect(
      (await json<ReturnRequestResponse>(await plan(detail.request.id, input))).request
        .currentAppointment,
    ).toBeNull();
    const second = (
      await json<ReturnRequestResponse>(
        await plan(
          detail.request.id,
          planInput(cancelled, source.ctx.crews, { localStart: '2030-01-07T15:00' }),
        ),
      )
    ).request;
    expect(second.currentAppointment!.id).not.toBe(appointment.id);
    expect(second.attempts).toHaveLength(2);
    const replay = (await json<ReturnRequestResponse>(await plan(detail.request.id, input)))
      .request;
    expect(replay.currentAppointment!.id).toBe(second.currentAppointment!.id);
    expect(replay.attempts).toHaveLength(2);
  });

  it('keeps request PLANNED through a move and rejects cancellation after any follow-up team departs', async () => {
    const source = await partial(),
      detail = await read(source.requestId!);
    const planned = (
      await json<ReturnRequestResponse>(
        await plan(detail.request.id, planInput(detail, source.ctx.crews)),
      )
    ).request;
    const visit = planned.currentAppointment!;
    const moved = await json<AppointmentResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + source.ctx.order.id + '/appointments/' + visit.id + '/reschedule',
        'POST',
        {
          operationKey: freshOperation(),
          expectedVersion: visit.version,
          localStart: '2030-01-07T14:00',
          durationMinutes: 60,
          crewIds: source.ctx.crews.map((crew) => crew.id),
          reason: 'Customer explicitly agreed to later return',
        },
      ),
    );
    expect(moved.appointment.id).toBe(visit.id);
    const reread = await read(detail.request.id);
    expect(reread.request.status).toBe('PLANNED');
    const ctx = await followContext(source.ctx, reread);
    await f.depart(ctx);
    expect(
      (
        await f.call(
          f.dispatcher,
          '/orders/' + source.ctx.order.id + '/appointments/' + ctx.appointmentId + '/cancel',
          'POST',
          { expectedVersion: ctx.appointmentVersion, reason: 'Must preserve started follow-up' },
        )
      ).status,
    ).toBe(409);
    expect((await read(detail.request.id)).request.status).toBe('PLANNED');
  });

  it('serializes follow-up departure and cancellation in both observed commit orders while preserving the request lifecycle', async () => {
    for (const departFirst of [true, false]) {
      const source = await partial(),
        detail = await read(source.requestId!);
      const planned = (
        await json<ReturnRequestResponse>(
          await plan(detail.request.id, planInput(detail, source.ctx.crews)),
        )
      ).request;
      const ctx = await followContext(source.ctx, planned),
        actor = ctx.actors[0]![0]!,
        id = ctx.assignmentIds[0]!;
      const depart = () =>
        f.action(actor, id, 'depart', {
          operationKey: freshOperation(),
          expectedExecutionVersion: 1,
          expectedAppointmentVersion: ctx.appointmentVersion,
        });
      const cancel = () =>
        f.call(
          f.dispatcher,
          '/orders/' + ctx.order.id + '/appointments/' + ctx.appointmentId + '/cancel',
          'POST',
          {
            expectedVersion: ctx.appointmentVersion,
            reason: 'Explicit fixture cancellation racing with departure',
          },
        );
      const held = await f.barrier('crew', ctx.crews[0]!.id),
        pending: Promise<Response>[] = [];
      let observed: unknown;
      try {
        pending.push((departFirst ? depart : cancel)());
        await f.waiters(held.pid, 1);
        pending.push((departFirst ? cancel : depart)());
        await f.waiters(held.pid, 2);
      } catch (error) {
        observed = error;
      } finally {
        await held.runner.rollbackTransaction();
        await held.runner.release();
      }
      const results = await Promise.allSettled(pending);
      if (observed) throw observed;
      const responses = results.map((result) => {
        if (result.status !== 'fulfilled') throw result.reason;
        return result.value;
      });
      expect(responses[0]!.status).toBe(departFirst ? 200 : 201);
      expect(responses[1]!.status).toBe(departFirst ? 409 : 404);
      expect((await read(detail.request.id)).request.status).toBe(departFirst ? 'PLANNED' : 'OPEN');
      if (departFirst) expect((await f.detail(actor, id)).execution.status).toBe('ON_THE_WAY');
      else expect((await f.call(actor, f.path(id))).status).toBe(404);
    }
  });

  it('preserves carried source provenance on a team replacement instead of restoring the full required template set', async () => {
    const source = await partial(),
      detail = await read(source.requestId!);
    const planned = (
        await json<ReturnRequestResponse>(
          await plan(detail.request.id, planInput(detail, source.ctx.crews)),
        )
      ).request,
      visit = planned.currentAppointment!,
      extra = await f.makeCrew();
    const moved = await json<AppointmentResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + source.ctx.order.id + '/appointments/' + visit.id + '/reschedule',
        'POST',
        {
          operationKey: freshOperation(),
          expectedVersion: visit.version,
          localStart: '2030-01-07T12:00',
          durationMinutes: 60,
          crewIds: [extra.id],
          reason: 'Dispatch a different free crew for this remaining scope',
        },
      ),
    );
    const active = moved.appointment.assignments.filter(
      (assignment) => assignment.status === 'ASSIGNED',
    );
    expect(active).toHaveLength(1);
    expect(active[0]!.crewId).toBe(extra.id);
    expect(active[0]!.tasks.map((task) => task.sourceTaskId).sort()).toEqual(
      detail.scopeCandidates.map((task) => task.sourceTaskId).sort(),
    );
    expect(active[0]!.tasks.some((task) => task.sourceTaskId === source.doneId)).toBe(false);
    const latest = await read(detail.request.id);
    expect(latest.attempts).toHaveLength(1);
    expect(latest.attempts[0]!.scope).toEqual(planned.attempts[0]!.scope);
    const actor = await f.makeActor('CREW_MEMBER', extra.id),
      crewRead = await f.detail(actor, active[0]!.id);
    expect(crewRead.returnContext!.scope.tasks.every((task) => task.crewId === extra.id)).toBe(
      true,
    );
    safeEvidence(crewRead);
  });

  it('reopens the same need after a failed follow-up and carries its remaining chain to another new visit without duplicate requests', async () => {
    const source = await partial(),
      original = await read(source.requestId!),
      originalReason = original.request.reason,
      originalRemaining = original.request.remainingWork;
    const planned = (
      await json<ReturnRequestResponse>(
        await plan(original.request.id, planInput(original, source.ctx.crews)),
      )
    ).request;
    const ctx = await followContext(source.ctx, planned);
    await f.start(ctx);
    const firstTask = (await f.detail(ctx.actors[0]![0]!, ctx.assignmentIds[0]!)).tasks[0]!;
    await taskResult(ctx.actors[0]![0]!, ctx.assignmentIds[0]!, firstTask.id, 'DONE');
    await finish(ctx.actors[0]![0]!, ctx.assignmentIds[0]!, 'BLOCKED', true);
    const failed = await read(original.request.id);
    expect(failed.request.status).toBe('OPEN');
    expect(failed.request.reason).toBe(originalReason);
    expect(failed.request.remainingWork).toBe(originalRemaining);
    expect(failed.attempts[0]!.closedOutcome).toBe('FAILED');
    expect(
      await f.source.getRepository(ReturnVisitRequest).countBy({ orderId: source.ctx.order.id }),
    ).toBe(1);
    expect(failed.scopeCandidates.some((task) => task.sourceTaskId === firstTask.id)).toBe(false);
    expect(
      failed.scopeCandidates.some((task) => task.sourceAppointmentId === ctx.appointmentId),
    ).toBe(true);
    const next = (
      await json<ReturnRequestResponse>(
        await plan(
          original.request.id,
          planInput(failed, source.ctx.crews, { localStart: '2030-01-07T15:00' }),
        ),
      )
    ).request;
    expect(next.currentAppointment!.id).not.toBe(ctx.appointmentId);
    expect(next.attempts).toHaveLength(2);
    const nextContext = await followContext(source.ctx, next);
    await completeFollow(nextContext);
    const ready = await read(original.request.id);
    expect(ready.readyToResolve).toBe(true);
    const resolved = (await json<ReturnRequestResponse>(await resolve(ready))).request;
    expect(resolved.request.status).toBe('RESOLVED');
    const order = await f.orders.detail(source.ctx.order.id);
    expect(order.progress).toBe('AWAITING_REVIEW');
    expect((await f.detail(source.actor, source.id)).finishReport).toEqual(
      source.finished.finishReport,
    );
  });

  it('keeps a multi-team return PLANNED until every team finishes and the dispatcher explicitly verifies scope and absolute quantities', async () => {
    const source = await partial(),
      detail = await read(source.requestId!),
      extra = await f.makeCrew(),
      crews = [source.ctx.crews[0]!, extra];
    const actors = [
      source.ctx.actors[0]!,
      [await f.makeActor('CREW_MEMBER', extra.id), await f.makeActor('CREW_MEMBER', extra.id)],
    ];
    const planned = (
      await json<ReturnRequestResponse>(await plan(detail.request.id, planInput(detail, crews)))
    ).request;
    expect((await resolve(planned)).status).toBe(409);
    const ctx = await followContext(source.ctx, planned, crews, actors);
    await f.start(ctx, 0);
    await completeTasks(ctx.actors[0]![0]!, ctx.assignmentIds[0]!);
    await fulfill(ctx.actors[0]![0]!, ctx.assignmentIds[0]!);
    await finish(ctx.actors[0]![0]!, ctx.assignmentIds[0]!, 'COMPLETED');
    const firstFinished = await read(detail.request.id);
    expect(firstFinished.request.status).toBe('PLANNED');
    expect(firstFinished.readyToResolve).toBe(false);
    expect((await f.detail(ctx.actors[1]![0]!, ctx.assignmentIds[1]!)).execution.status).toBe(
      'NOT_STARTED',
    );
    await f.start(ctx, 1);
    await completeTasks(ctx.actors[1]![0]!, ctx.assignmentIds[1]!);
    await finish(ctx.actors[1]![0]!, ctx.assignmentIds[1]!, 'COMPLETED');
    const complete = await read(detail.request.id);
    expect(complete.request.status).toBe('PLANNED');
    expect(complete.readyToResolve).toBe(true);
    expect((await resolve(complete, ctx.actors[1]![0]!)).status).toBe(403);
    const result = (await json<ReturnRequestResponse>(await resolve(complete))).request;
    expect(result.request.status).toBe('RESOLVED');
    const order = await f.orders.detail(source.ctx.order.id);
    expect(order.progress).toBe('AWAITING_REVIEW');
    expect(
      order.items.every(
        (item) =>
          item.deliveredQuantity === item.quantity &&
          item.assembledQuantity === (item.requiresAssembly ? item.quantity : 0),
      ),
    ).toBe(true);
    expect(order.execution.returnVisitRequired).toBe(false);
  });

  it('requires absolute item targets as well as completed tasks and preserves old reports when resolving a later successful attempt', async () => {
    const source = await partial(),
      detail = await read(source.requestId!);
    const planned = (
      await json<ReturnRequestResponse>(
        await plan(detail.request.id, planInput(detail, source.ctx.crews)),
      )
    ).request;
    const ctx = await followContext(source.ctx, planned);
    await completeFollow(ctx, false);
    const incomplete = await read(detail.request.id);
    expect(incomplete.readyToResolve).toBe(false);
    expect((await resolve(incomplete)).status).toBe(409);
    expect((await f.detail(source.actor, source.id)).items[0]!.deliveredQuantity).toBe(1);
    expect((await f.detail(source.actor, source.id)).finishReport).toEqual(
      source.finished.finishReport,
    );
    expect((await f.orders.detail(source.ctx.order.id)).workReadyForReview).toBe(false);
    expect(incomplete.request.status).toBe('OPEN');
    const next = planInput(incomplete, source.ctx.crews, { localStart: '2030-01-07T15:00' });
    expect(
      (await plan(incomplete.request.id, { ...next, itemTargets: next.itemTargets.slice(1) }))
        .status,
    ).toBe(409);
    expect(
      (
        await plan(incomplete.request.id, {
          ...next,
          operationKey: freshOperation(),
          itemTargets: next.itemTargets.map((target, index) =>
            index === 0 ? { ...target, deliveredQuantity: 1, assembledQuantity: 0 } : target,
          ),
        })
      ).status,
    ).toBe(409);
    const retry = await json<ReturnRequestResponse>(
      await plan(incomplete.request.id, { ...next, operationKey: freshOperation() }),
    );
    expect(retry.request.currentAppointment!.id).not.toBe(ctx.appointmentId);
  });

  it('reopens the same request when a COMPLETED follow-up explicitly needs another visit despite all accepted tasks and item targets being fulfilled', async () => {
    const source = await partial(),
      detail = await read(source.requestId!);
    const planned = (
      await json<ReturnRequestResponse>(
        await plan(detail.request.id, planInput(detail, source.ctx.crews)),
      )
    ).request;
    const ctx = await followContext(source.ctx, planned),
      actor = ctx.actors[0]![0]!,
      id = ctx.assignmentIds[0]!;
    await f.start(ctx);
    await completeTasks(actor, id);
    const current = await fulfill(actor, id);
    const terminal = await json<CrewAssignmentResponse>(
      await f.action(actor, id, 'finish', {
        operationKey: freshOperation(),
        expectedExecutionVersion: current.execution.version,
        outcome: 'COMPLETED',
        summary: 'Accepted return work completed, separate check still needed',
        returnVisitRequired: true,
        returnReason: 'A final fitting check needs a different tool',
        remainingWork: 'Perform the explicitly requested additional fitting check',
      }),
    );
    expect(terminal.assignment.execution.status).toBe('COMPLETED');
    const reopened = await read(detail.request.id);
    expect(reopened.request.status).toBe('OPEN');
    expect(reopened.attempts).toHaveLength(1);
    expect(reopened.attempts[0]!.returnRequested).toBe(true);
    expect(reopened.attempts[0]!.closedOutcome).toBe('FAILED');
    expect(reopened.request.reason).toBe(detail.request.reason);
    expect(reopened.request.remainingWork).toBe(detail.request.remainingWork);
    expect(
      await f.source.getRepository(ReturnVisitRequest).countBy({ orderId: source.ctx.order.id }),
    ).toBe(1);
    expect((await resolve(reopened)).status).toBe(409);
    const order = await f.orders.detail(source.ctx.order.id);
    expect(order.returnVisitRequired).toBe(true);
    expect(order.workReadyForReview).toBe(false);
    expect(order.progress).not.toBe('AWAITING_REVIEW');
    expect((await f.detail(source.actor, source.id)).finishReport).toEqual(
      source.finished.finishReport,
    );
  });

  it('reopens an otherwise successful attempt if historical optional PENDING work was omitted, then permits an explicit carried skip without rewriting the source', async () => {
    const source = await f.context(),
      actor = source.actors[0]![0]!,
      id = source.assignmentIds[0]!;
    const optional = await f.source.getRepository(Task).save({
      assignmentId: id,
      templateId: null,
      sourceTaskId: null,
      returnScopeKey: null,
      name: 'Optional original packaging check',
      description: 'Must receive an explicit final decision',
      required: false,
      severity: 'LOW',
      priority: 95,
    });
    const started = await f.start(source);
    await taskResult(actor, id, started.tasks.find((task) => task.required)!.id, 'DONE');
    const original = await finish(actor, id, 'PARTIALLY_COMPLETED', true),
      requestId = original.returnRequests.find((request) => request.assignmentId === id)!.id;
    const detail = await read(requestId);
    expect(
      detail.scopeCandidates.some(
        (task) => task.sourceTaskId === optional.id && task.resultStatus === 'PENDING',
      ),
    ).toBe(true);
    const input = planInput(detail, source.crews);
    input.carriedTasks = input.carriedTasks.filter((task) => task.sourceTaskId !== optional.id);
    const first = (await json<ReturnRequestResponse>(await plan(requestId, input))).request;
    const firstContext = await followContext(source, first);
    await completeFollow(firstContext);
    const reopened = await read(requestId);
    expect(reopened.request.status).toBe('OPEN');
    expect(reopened.readyToResolve).toBe(false);
    expect(reopened.attempts[0]!.closedOutcome).toBe('FAILED');
    expect(reopened.scopeCandidates.map((task) => task.sourceTaskId)).toEqual([optional.id]);
    expect((await resolve(reopened)).status).toBe(409);
    expect((await f.orders.detail(source.order.id)).workReadyForReview).toBe(false);
    const next = (
      await json<ReturnRequestResponse>(
        await plan(
          requestId,
          planInput(reopened, source.crews, { localStart: '2030-01-07T15:00' }),
        ),
      )
    ).request;
    const nextContext = await followContext(source, next),
      nextActor = nextContext.actors[0]![0]!,
      nextId = nextContext.assignmentIds[0]!;
    const nextStarted = await f.start(nextContext);
    expect(nextStarted.tasks).toHaveLength(1);
    expect(nextStarted.tasks[0]!.required).toBe(false);
    await taskResult(nextActor, nextId, nextStarted.tasks[0]!.id, 'SKIPPED');
    await finish(nextActor, nextId, 'COMPLETED');
    const ready = await read(requestId);
    expect(ready.readyToResolve).toBe(true);
    expect((await json<ReturnRequestResponse>(await resolve(ready))).request.request.status).toBe(
      'RESOLVED',
    );
    const order = await f.orders.detail(source.order.id);
    expect(order.progress).toBe('AWAITING_REVIEW');
    expect(order.workReadyForReview).toBe(true);
    expect(
      (await f.source.getRepository(Task).findOneByOrFail({ id: optional.id })).resultStatus,
    ).toBe('PENDING');
    expect((await f.detail(actor, id)).finishReport).toEqual(original.finishReport);
  });

  it('keeps issue resolution independent of return resolution and never hides a future visit or another open need', async () => {
    const source = await partial(),
      detail = await read(source.requestId!);
    const issue = await json<IssueResponse>(
      await f.call(f.dispatcher, '/orders/' + source.ctx.order.id + '/issues', 'POST', {
        operationKey: freshOperation(),
        type: 'MISSING_PARTS',
        description: 'Fictional independent issue',
        reportedSource: 'CUSTOMER',
        visibility: 'CREW_VISIBLE',
      }),
    );
    const planned = (
      await json<ReturnRequestResponse>(
        await plan(detail.request.id, planInput(detail, source.ctx.crews)),
      )
    ).request;
    const ctx = await followContext(source.ctx, planned);
    await completeFollow(ctx);
    const ready = await read(detail.request.id);
    await json<ReturnRequestResponse>(await resolve(ready));
    let order = await f.orders.detail(source.ctx.order.id);
    expect(order.workReadyForReview).toBe(false);
    expect(order.openIssueCount).toBe(1);
    await json<IssueResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + source.ctx.order.id + '/issues/' + issue.issue.id + '/resolve',
        'POST',
        {
          operationKey: freshOperation(),
          expectedVersion: issue.issue.version,
          reason: 'Independent fixture issue verified',
        },
      ),
    );
    expect((await read(detail.request.id)).request.status).toBe('RESOLVED');
    expect((await f.orders.detail(source.ctx.order.id)).progress).toBe('AWAITING_REVIEW');
    await f.planning.create(
      source.ctx.order.id,
      {
        localStart: '2030-01-08T12:00',
        durationMinutes: 60,
        crewIds: [],
        idempotencyKey: freshOperation(),
      },
      f.dispatcher.user.id,
    );
    order = await f.orders.detail(source.ctx.order.id);
    expect(order.workReadyForReview).toBe(false);
    expect(order.progress).not.toBe('AWAITING_REVIEW');
  });

  it('authorizes follow-up context through current membership and never expands access to private source attachments or financial data', async () => {
    const source = await partial(),
      detail = await read(source.requestId!),
      extra = await f.makeCrew();
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#253950' } })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append('operationKey', freshOperation());
    form.append(
      'file',
      new Blob([new Uint8Array(png)], { type: 'image/png' }),
      'fictional-private.png',
    );
    const file = await json<AttachmentResponse>(
      await f.call(f.dispatcher, '/orders/' + source.ctx.order.id + '/attachments', 'POST', form),
    );
    const planned = (
      await json<ReturnRequestResponse>(await plan(detail.request.id, planInput(detail, [extra])))
    ).request;
    const actor = await f.makeActor('CREW_MEMBER', extra.id),
      assignment = planned.currentAppointment!.assignments.find(
        (entry) => entry.status === 'ASSIGNED',
      )!;
    const visible = await f.detail(actor, assignment.id);
    safeEvidence(visible);
    expect(visible.returnContext?.requestId).toBe(detail.request.id);
    expect(visible.returnContext?.scope.tasks.every((task) => task.crewId === extra.id)).toBe(true);
    expect((await f.call(actor, requestPath(detail.request.id))).status).toBe(403);
    expect(
      (
        await f.call(
          actor,
          f.path(assignment.id, '/attachments/' + file.attachment.id + '/content'),
        )
      ).status,
    ).toBe(404);
    await f.source
      .getRepository(CrewMember)
      .update({ userId: actor.user.id, crewId: extra.id }, { active: false });
    expect((await f.call(actor, f.path(assignment.id))).status).toBe(404);
    await f.source.getRepository(User).update(actor.user.id, { active: false });
    expect((await f.call(actor, f.path(assignment.id))).status).toBe(401);
    const queue = await json<ReturnQueueResponse>(
      await f.call(
        f.dispatcher,
        '/backoffice/return-requests?' +
          new URLSearchParams({ orderId: source.ctx.order.id, page: '1', pageSize: '20' }),
      ),
    );
    expect(queue.total).toBe(1);
    expect(queue.requests[0]!.currentAppointmentId).toBe(planned.currentAppointment!.id);
  });

  it('resolves two needs of one order independently and does not clear the neighboring request or its uncovered partial work', async () => {
    const source = await f.context({ crews: 2 }),
      ids: string[] = [];
    for (let index = 0; index < 2; index++) {
      await f.start(source, index);
      const terminal = await finish(
        source.actors[index]![0]!,
        source.assignmentIds[index]!,
        'PARTIALLY_COMPLETED',
        true,
      );
      ids.push(
        terminal.returnRequests.find(
          (request) => request.assignmentId === source.assignmentIds[index],
        )!.id,
      );
    }
    const first = await read(ids[0]!),
      second = await read(ids[1]!);
    const planned = (
      await json<ReturnRequestResponse>(
        await plan(first.request.id, planInput(first, [source.crews[0]!])),
      )
    ).request;
    const ctx = await followContext(source, planned, [source.crews[0]!], [source.actors[0]!]);
    await completeFollow(ctx);
    await json<ReturnRequestResponse>(await resolve(await read(first.request.id)));
    const remaining = await read(second.request.id);
    expect(remaining.request.status).toBe('OPEN');
    expect(remaining.request.remainingWork).toBe(second.request.remainingWork);
    const order = await f.orders.detail(source.order.id);
    expect(order.returnVisitRequired).toBe(true);
    expect(order.workReadyForReview).toBe(false);
    expect(order.progress).not.toBe('AWAITING_REVIEW');
    const queue = await json<ReturnQueueResponse>(
      await f.call(
        f.dispatcher,
        '/backoffice/return-requests?' +
          new URLSearchParams({
            status: 'OPEN',
            orderId: source.order.id,
            page: '1',
            pageSize: '20',
          }),
      ),
    );
    expect(queue.total).toBe(1);
    expect(queue.requests[0]!.request.id).toBe(second.request.id);
  });

  it('rolls back scope, appointment, request status and receipt together on audit failure', async () => {
    const source = await partial(),
      detail = await read(source.requestId!),
      input = planInput(detail, source.ctx.crews);
    await f.source.query(
      `CREATE FUNCTION "${f.schema}".reject_return_plan_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id='${source.ctx.order.id}'::uuid AND NEW.action='RETURN_VISIT_PLANNED' THEN RAISE EXCEPTION 'fixture return plan audit unavailable'; END IF; RETURN NEW; END $$`,
    );
    await f.source.query(
      `CREATE TRIGGER return_plan_audit_failure BEFORE INSERT ON "${f.schema}".activity_log FOR EACH ROW EXECUTE FUNCTION "${f.schema}".reject_return_plan_audit()`,
    );
    try {
      expect((await plan(detail.request.id, input)).status).toBe(500);
      expect((await read(detail.request.id)).request.status).toBe('OPEN');
      expect(
        await f.source.getRepository(ReturnVisitAttempt).countBy({ requestId: detail.request.id }),
      ).toBe(0);
      expect(
        await f.source
          .getRepository(EvidenceReceipt)
          .countBy({ orderId: source.ctx.order.id, action: 'RETURN_VISIT_PLANNED' }),
      ).toBe(0);
    } finally {
      await f.source.query(`DROP TRIGGER return_plan_audit_failure ON "${f.schema}".activity_log`);
      await f.source.query(`DROP FUNCTION "${f.schema}".reject_return_plan_audit()`);
    }
    const saved = await json<ReturnRequestResponse>(await plan(detail.request.id, input));
    expect(saved.request.request.status).toBe('PLANNED');
    expect(saved.request.attempts).toHaveLength(1);
  });
});
