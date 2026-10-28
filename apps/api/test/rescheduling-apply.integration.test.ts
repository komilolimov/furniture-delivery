import type {
  ApplyRescheduleCommand,
  ApplyRescheduleResponse,
  SlotSearchResponse,
} from '@furniture-delivery/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EvidenceReceipt } from '../src/evidence/evidence-receipt.entity';
import { User } from '../src/identity/user.entity';
import { AuthSession } from '../src/identity/auth-session.entity';
import { Appointment } from '../src/planning/appointment.entity';
import { CrewAssignment } from '../src/planning/crew-assignment.entity';
import {
  createEvidenceFixture,
  evidenceJson as json,
  freshOperation,
  type EvidenceContext,
  type EvidenceFixture,
} from './evidence-fixture';

const NOW = '2030-01-07T08:00:00.000Z';

describe('M6 explicit rescheduling rechecks mutable forecasts inside real PostgreSQL transactions', () => {
  let f: EvidenceFixture;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    f = await createEvidenceFixture('m6_schedule', (config, root) => ({
      ...config,
      storage: { root },
    }));
  }, 30000);
  beforeEach(() => vi.setSystemTime(new Date(NOW)));
  afterAll(async () => {
    await f?.close();
    vi.useRealTimers();
  });

  const path = (ctx: EvidenceContext) =>
    '/orders/' + ctx.order.id + '/appointments/' + ctx.appointmentId;
  const command = (
    ctx: EvidenceContext,
    change: Partial<ApplyRescheduleCommand> = {},
  ): ApplyRescheduleCommand => ({
    operationKey: freshOperation(),
    expectedVersion: ctx.appointmentVersion,
    localStart: '2030-01-07T13:00',
    durationMinutes: 60,
    crewIds: ctx.crews.map((crew) => crew.id),
    reason: 'Explicit fictional rescheduling decision',
    ...change,
  });
  const apply = (ctx: EvidenceContext, body: ApplyRescheduleCommand, actor = f.dispatcher) =>
    f.call(actor, path(ctx) + '/reschedule', 'POST', body);
  const find = (ctx: EvidenceContext, earliestLocal = '2030-01-07T13:00') =>
    f.call(
      f.dispatcher,
      '/planning/available-windows?' +
        new URLSearchParams({
          context: 'APPOINTMENT',
          orderId: ctx.order.id,
          appointmentId: ctx.appointmentId,
          earliestLocal,
          durationMinutes: '60',
          crewIds: ctx.crews.map((crew) => crew.id).join(','),
          alternativeCrews: 'false',
        }),
    );
  const ordered = async (
    ctx: EvidenceContext,
    first: () => Promise<Response>,
    second: () => Promise<Response>,
  ) => {
    const held = await f.barrier('crew', ctx.crews[0]!.id),
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
    const results = await Promise.allSettled(operations);
    if (observed) throw observed;
    return results.map((result) => {
      if (result.status !== 'fulfilled') throw result.reason;
      return result.value;
    });
  };

  it('preserves visit, assignment and snapshot IDs, resets time confirmation and safely replays without reverting a subsequent move', async () => {
    const ctx = await f.context({ crews: 2 }),
      before = await f.planning.detail(ctx.order.id, ctx.appointmentId);
    const first = command(ctx),
      moved = await json<ApplyRescheduleResponse>(await apply(ctx, first));
    expect(moved.appointment.id).toBe(ctx.appointmentId);
    expect(moved.appointment.confirmationStatus).toBe('NEEDS_CONFIRMATION');
    expect(
      moved.appointment.assignments.map((a) => [a.id, a.tasks.map((task) => task.id)]),
    ).toEqual(before.appointment.assignments.map((a) => [a.id, a.tasks.map((task) => task.id)]));
    const newer = await json<ApplyRescheduleResponse>(
      await apply(
        ctx,
        command(ctx, {
          expectedVersion: moved.appointment.version,
          localStart: '2030-01-07T16:00',
        }),
      ),
    );
    const count = await f.history(ctx.order.id),
      replay = await json<ApplyRescheduleResponse>(await apply(ctx, first));
    expect(replay.appointment).toEqual(newer.appointment);
    expect(replay.receipt.id).toBe(moved.receipt.id);
    expect(await f.history(ctx.order.id)).toBe(count);
    expect((await apply(ctx, { ...first, reason: 'Changed payload for an old key' })).status).toBe(
      409,
    );
    expect((await apply(ctx, command(ctx))).status).toBe(409);
  });

  it('uses the M4 logical assignment lifecycle for team-only replacement without resetting the confirmed time', async () => {
    const ctx = await f.context(),
      other = await f.makeCrew();
    const result = await json<ApplyRescheduleResponse>(
      await apply(ctx, command(ctx, { localStart: '2030-01-07T09:00', crewIds: [other.id] })),
    );
    expect(result.appointment.confirmationStatus).toBe('CONFIRMED');
    const old = await f.source
      .getRepository(CrewAssignment)
      .findOneByOrFail({ id: ctx.assignmentIds[0]! });
    expect(old.status).toBe('CANCELLED');
    const current = result.appointment.assignments.filter(
      (assignment) => assignment.status === 'ASSIGNED',
    );
    expect(current).toHaveLength(1);
    expect(current[0]!.crewId).toBe(other.id);
    expect(current[0]!.id).not.toBe(old.id);
  });

  it('lets two dispatchers inspect the same free slot but only one reserve it under the shared crew lock', async () => {
    const first = await f.context({ localStart: '2030-01-07T09:00' }),
      second = await f.context({
        existingCrews: first.crews,
        existingActors: first.actors,
        localStart: '2030-01-07T16:00',
      });
    const firstSearch = await json<SlotSearchResponse>(await find(first)),
      secondSearch = await json<SlotSearchResponse>(await find(second));
    expect(firstSearch.candidates[0]!.localStart).toBe('2030-01-07T13:00');
    expect(secondSearch.candidates[0]!.localStart).toBe('2030-01-07T13:00');
    const result = await f.overlap(
      'crew',
      first.crews[0]!.id,
      () => apply(first, command(first)),
      () => apply(second, command(second), f.administrator),
    );
    expect(result.map((response) => response.status).sort()).toEqual([200, 409]);
    const visits = await f.source.getRepository(Appointment).findBy({ orderId: first.order.id });
    const otherVisits = await f.source
      .getRepository(Appointment)
      .findBy({ orderId: second.order.id });
    expect(
      [...visits, ...otherVisits].filter(
        (visit) => visit.plannedStartAt.toISOString() === '2030-01-07T12:00:00.000Z',
      ),
    ).toHaveLength(1);
  });

  it('rejects a stale suggestion after an estimate changes and rolls back every crew and the original reservation', async () => {
    const ctx = await f.context({ crews: 2, localStart: '2030-01-07T16:00' });
    const busy = await f.context({
      existingCrews: [ctx.crews[0]!],
      existingActors: [ctx.actors[0]!],
      localStart: '2030-01-07T09:00',
    });
    await f.depart(busy);
    const proposed = await json<SlotSearchResponse>(await find(ctx));
    expect(proposed.candidates[0]!.localStart).toBe('2030-01-07T13:00');
    await json(
      await f.call(busy.actors[0]![0]!, f.path(busy.assignmentIds[0]!, '/estimate'), 'POST', {
        operationKey: freshOperation(),
        expectedEstimateVersion: 1,
        localFinish: '2030-01-07T14:00',
        reason: 'New fixture forecast after search',
      }),
    );
    const before = await f.planning.detail(ctx.order.id, ctx.appointmentId),
      history = await f.history(ctx.order.id);
    expect((await apply(ctx, command(ctx))).status).toBe(409);
    expect(await f.planning.detail(ctx.order.id, ctx.appointmentId)).toEqual(before);
    expect(await f.history(ctx.order.id)).toBe(history);
  });

  it('rechecks new unavailability and a late actual finish after search rather than trusting a previously displayed candidate', async () => {
    const absent = await f.context({ localStart: '2030-01-07T16:00' });
    await json<SlotSearchResponse>(await find(absent));
    expect(
      (
        await f.call(f.dispatcher, '/crews/' + absent.crews[0]!.id + '/unavailability', 'POST', {
          localStart: '2030-01-07T13:00',
          localEnd: '2030-01-07T14:30',
          reason: 'Exception created after the search',
        })
      ).status,
    ).toBe(201);
    expect((await apply(absent, command(absent))).status).toBe(409);
    const ctx = await f.context({ localStart: '2030-01-07T16:00' }),
      busy = await f.context({ existingCrews: ctx.crews, existingActors: ctx.actors });
    await f.start(busy);
    await json<SlotSearchResponse>(await find(ctx, '2030-01-07T14:30'));
    vi.setSystemTime(new Date('2030-01-07T13:10:00.000Z'));
    const detail = await f.detail(busy.actors[0]![0]!, busy.assignmentIds[0]!);
    await json(
      await f.action(busy.actors[0]![0]!, detail.id, 'finish', {
        operationKey: freshOperation(),
        expectedExecutionVersion: detail.execution.version,
        outcome: 'PARTIALLY_COMPLETED',
        summary: 'Late factual finish',
        reason: 'Fixture delay',
        remainingWork: 'Remaining fixture work',
        returnVisitRequired: true,
        returnReason: 'Additional fixture work',
      }),
    );
    expect((await apply(ctx, command(ctx, { localStart: '2030-01-07T14:30' }))).status).toBe(409);
    expect(
      (await f.planning.detail(ctx.order.id, ctx.appointmentId)).appointment.plannedStartAt,
    ).toBe('2030-01-07T15:00:00.000Z');
  });

  it('serializes depart against reschedule in both observed lock orders without rewriting started work', async () => {
    for (const departFirst of [true, false]) {
      const ctx = await f.context(),
        id = ctx.assignmentIds[0]!,
        actor = ctx.actors[0]![0]!;
      const depart = () =>
        f.action(actor, id, 'depart', {
          operationKey: freshOperation(),
          expectedExecutionVersion: 1,
          expectedAppointmentVersion: ctx.appointmentVersion,
        });
      const move = () => apply(ctx, command(ctx));
      const responses = await ordered(
        ctx,
        departFirst ? depart : move,
        departFirst ? move : depart,
      );
      expect(responses.map((response) => response.status)).toEqual([200, 409]);
      const saved = await f.detail(actor, id);
      expect(saved.execution.status).toBe(departFirst ? 'ON_THE_WAY' : 'NOT_STARTED');
      expect(saved.plannedStartAt).toBe(
        departFirst ? '2030-01-07T08:00:00.000Z' : '2030-01-07T12:00:00.000Z',
      );
    }
  });

  it('rejects a reschedule whose session expired while waiting for the crew lock', async () => {
    const ctx = await f.context(),
      actor = await f.makeActor('DISPATCHER');
    await f.source
      .getRepository(AuthSession)
      .update({ userId: actor.user.id }, { expiresAt: new Date('2030-01-07T08:01:00.000Z') });
    const held = await f.barrier('crew', ctx.crews[0]!.id),
      pending = apply(ctx, command(ctx), actor);
    try {
      await f.waiters(held.pid, 1);
      vi.setSystemTime(new Date('2030-01-07T08:02:00.000Z'));
    } finally {
      await held.runner.rollbackTransaction();
      await held.runner.release();
    }
    expect((await pending).status).toBe(401);
    expect((await f.planning.detail(ctx.order.id, ctx.appointmentId)).appointment.version).toBe(
      ctx.appointmentVersion,
    );
  });

  it('checks current role and authorization before replay and atomically rolls back a failed audit with its receipt', async () => {
    const ctx = await f.context(),
      input = command(ctx);
    await f.source.query(
      `CREATE FUNCTION "${f.schema}".reject_m6_reschedule_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id='${ctx.order.id}'::uuid THEN RAISE EXCEPTION 'fixture reschedule audit unavailable'; END IF; RETURN NEW; END $$`,
    );
    await f.source.query(
      `CREATE TRIGGER m6_reschedule_audit_failure BEFORE INSERT ON "${f.schema}".activity_log FOR EACH ROW EXECUTE FUNCTION "${f.schema}".reject_m6_reschedule_audit()`,
    );
    const before = await f.planning.detail(ctx.order.id, ctx.appointmentId);
    try {
      expect((await apply(ctx, input)).status).toBe(500);
      expect(await f.planning.detail(ctx.order.id, ctx.appointmentId)).toEqual(before);
      expect(
        await f.source
          .getRepository(EvidenceReceipt)
          .countBy({ orderId: ctx.order.id, action: 'APPOINTMENT_RESCHEDULED' }),
      ).toBe(0);
    } finally {
      await f.source.query(
        `DROP TRIGGER m6_reschedule_audit_failure ON "${f.schema}".activity_log`,
      );
      await f.source.query(`DROP FUNCTION "${f.schema}".reject_m6_reschedule_audit()`);
    }
    const moved = await json<ApplyRescheduleResponse>(await apply(ctx, input));
    expect(moved.appointment.version).toBe(ctx.appointmentVersion + 1);
    expect((await apply(ctx, input, ctx.actors[0]![0]!)).status).toBe(403);
    await f.source.getRepository(User).update(f.dispatcher.user.id, { role: 'CREW_MEMBER' });
    try {
      expect((await apply(ctx, input)).status).toBe(403);
    } finally {
      await f.source.getRepository(User).update(f.dispatcher.user.id, { role: 'DISPATCHER' });
    }
  });
});
