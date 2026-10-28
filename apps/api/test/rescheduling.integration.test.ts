import type {
  AppointmentResponse,
  CrewAssignmentResponse,
  EstimateCommand,
  EstimateResponse,
  RiskBoardResponse,
  SlotSearchQuery,
  SlotSearchResponse,
} from '@furniture-delivery/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Crew } from '../src/crews/crew.entity';
import { CrewMember } from '../src/identity/crew-member.entity';
import { User } from '../src/identity/user.entity';
import { ExecutionReceipt } from '../src/execution/execution-receipt.entity';
import { Appointment } from '../src/planning/appointment.entity';
import { CrewAssignment } from '../src/planning/crew-assignment.entity';
import { CrewPlanningConfig } from '../src/planning/crew-planning-config.entity';
import { CrewUnavailability } from '../src/planning/crew-unavailability.entity';
import { localToUtc } from '../src/planning/planning-time';
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
const query = (values: Record<string, unknown>) =>
  new URLSearchParams(
    Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)]),
  ).toString();

describe('M6 estimates, risk board and read-only available windows on isolated PostgreSQL', () => {
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

  const estimate = (
    actor: EvidenceActor,
    id: string,
    change: Partial<EstimateCommand> = {},
    backoffice = false,
  ) =>
    f.call(
      actor,
      backoffice ? '/planning/assignments/' + id + '/estimate' : f.path(id, '/estimate'),
      'POST',
      {
        operationKey: freshOperation(),
        expectedEstimateVersion: 1,
        localFinish: '2030-01-07T14:00',
        reason: 'Fictional team completion forecast',
        ...change,
      },
    );
  const risk = (crewIds: string[]) =>
    f.call(
      f.dispatcher,
      '/planning/risks?' +
        query({ from: '2030-01-07', to: '2030-01-08', allTeams: false, crewIds }),
    );
  const search = (ctx: EvidenceContext, change: Partial<SlotSearchQuery> = {}) =>
    f.call(
      f.dispatcher,
      '/planning/available-windows?' +
        query({
          context: 'APPOINTMENT',
          orderId: ctx.order.id,
          appointmentId: ctx.appointmentId,
          earliestLocal: '2030-01-07T09:00',
          durationMinutes: 60,
          crewIds: ctx.crews.map((crew) => crew.id),
          alternativeCrews: false,
          ...change,
        }),
    );
  const extend = async (ctx: EvidenceContext, durationMinutes: number) => {
    const changed = await f.planning.update(
      ctx.order.id,
      ctx.appointmentId,
      {
        expectedVersion: ctx.appointmentVersion,
        durationMinutes,
        reason: 'Fictional longer visit',
      },
      f.dispatcher.user.id,
    );
    const confirmed = await f.planning.confirm(
      ctx.order.id,
      ctx.appointmentId,
      changed.appointment.version,
      f.dispatcher.user.id,
    );
    ctx.appointmentVersion = confirmed.appointment.version;
  };

  it('stores a team forecast in every active state without rewriting plan, actual facts, checklist or quantities', async () => {
    const ctx = await f.context(),
      id = ctx.assignmentIds[0]!,
      actor = ctx.actors[0]![0]!;
    let current = await f.depart(ctx);
    const before = await f.source
      .getRepository(Appointment)
      .findOneByOrFail({ id: ctx.appointmentId });
    for (const [index, next] of [null, 'arrive', 'start'].entries()) {
      if (next)
        current = (
          await json<CrewAssignmentResponse>(
            await f.action(actor, id, next, {
              operationKey: freshOperation(),
              expectedExecutionVersion: current.execution.version,
            }),
          )
        ).assignment;
      const result = await json<EstimateResponse>(
        await estimate(actor, id, { expectedEstimateVersion: index + 1 }),
      );
      expect(result.estimatedFinishAt).toBe('2030-01-07T13:00:00.000Z');
      expect(result.estimateVersion).toBe(index + 2);
      expect(result.estimateUpdatedBy).toBe(actor.user.id);
      expect(result.estimateUpdatedAt).toBe(NOW);
      safeEvidence(result);
      const reread = await f.detail(actor, id);
      expect(reread.execution.status).toBe(current.execution.status);
      expect(reread.execution.actualStartAt).toBe(current.execution.actualStartAt);
      expect(reread.execution.actualEndAt).toBeNull();
      expect(reread.execution.estimatedFinishAt).toBe(result.estimatedFinishAt);
      expect(reread.items).toEqual(current.items);
      expect(reread.tasks).toEqual(current.tasks);
    }
    expect(
      await f.source.getRepository(Appointment).findOneByOrFail({ id: ctx.appointmentId }),
    ).toEqual(before);
  });

  it('requires active execution, a reason and a strictly future valid Rome wall time, and permits explicit clearing and midnight crossing', async () => {
    const ctx = await f.context(),
      id = ctx.assignmentIds[0]!,
      actor = ctx.actors[0]![0]!;
    expect((await estimate(actor, id)).status).toBe(409);
    await f.depart(ctx);
    for (const change of [
      { reason: '' },
      { localFinish: '2030-01-07T09:00' },
      { localFinish: '2030-01-07T08:59' },
      { localFinish: '2030-03-31T02:30' },
      { localFinish: '2030-10-27T02:30' },
      { localFinish: '2030-02-30T12:00' },
      { localFinish: '2030-01-07T14:00Z' },
    ])
      expect((await estimate(actor, id, change)).status).toBe(400);
    const overnight = await json<EstimateResponse>(
      await estimate(actor, id, { localFinish: '2030-01-08T00:30' }),
    );
    expect(overnight.estimatedFinishAt).toBe('2030-01-07T23:30:00.000Z');
    const cleared = await json<EstimateResponse>(
      await estimate(actor, id, {
        expectedEstimateVersion: overnight.estimateVersion,
        localFinish: null,
        reason: 'Team cannot currently give a reliable estimate',
      }),
    );
    expect(cleared.estimatedFinishAt).toBeNull();
    expect(cleared.estimateReason).toBe('Team cannot currently give a reliable estimate');
    expect(cleared.estimateVersion).toBe(3);
  });

  it('replays an old operation without reverting a newer estimate and rejects changed payload or stale versions', async () => {
    const ctx = await f.context(),
      id = ctx.assignmentIds[0]!,
      actor = ctx.actors[0]![0]!;
    await f.depart(ctx);
    const first = {
      operationKey: freshOperation(),
      expectedEstimateVersion: 1,
      localFinish: '2030-01-07T12:00',
      reason: 'Initial completion forecast',
    };
    const initial = await json<EstimateResponse>(await estimate(actor, id, first));
    const latest = await json<EstimateResponse>(
      await estimate(actor, id, { expectedEstimateVersion: 2, localFinish: '2030-01-07T14:00' }),
    );
    const count = await f.history(ctx.order.id);
    const replay = await json<EstimateResponse>(await estimate(actor, id, first));
    expect(replay.estimatedFinishAt).toBe(latest.estimatedFinishAt);
    expect(replay.estimateVersion).toBe(latest.estimateVersion);
    expect(replay.receipt?.id).toBe(initial.receipt?.id);
    expect(await f.history(ctx.order.id)).toBe(count);
    expect((await estimate(actor, id, { ...first, reason: 'Changed retry payload' })).status).toBe(
      409,
    );
    expect((await estimate(actor, id, { expectedEstimateVersion: 1 })).status).toBe(409);
  });

  it('authorizes current membership before receipt replay and allows disabled teams to document already-started work', async () => {
    const ctx = await f.context(),
      foreign = await f.context(),
      id = ctx.assignmentIds[0]!,
      actor = ctx.actors[0]![0]!;
    await f.depart(ctx);
    expect((await estimate(foreign.actors[0]![0]!, id)).status).toBe(404);
    expect((await estimate(f.dispatcher, id)).status).toBe(403);
    expect((await estimate(actor, id, {}, true)).status).toBe(403);
    expect((await f.call(undefined, f.path(id, '/estimate'), 'POST', {})).status).toBe(401);
    expect(
      (
        await f.call(
          actor,
          f.path(id, '/estimate'),
          'POST',
          {},
          { Origin: 'https://untrusted.example.invalid' },
        )
      ).status,
    ).toBe(403);
    const input = { operationKey: freshOperation() };
    await f.source.getRepository(Crew).update(ctx.crews[0]!.id, { active: false });
    await json<EstimateResponse>(await estimate(actor, id, input));
    await f.source
      .getRepository(CrewMember)
      .update({ userId: actor.user.id, crewId: ctx.crews[0]!.id }, { active: false });
    expect((await estimate(actor, id, input)).status).toBe(404);
    await f.source.getRepository(User).update(actor.user.id, { active: false });
    expect((await estimate(actor, id, input)).status).toBe(401);
    const admin = await json<EstimateResponse>(
      await estimate(f.administrator, id, { expectedEstimateVersion: 2 }, true),
    );
    expect(admin.estimateUpdatedBy).toBe(f.administrator.user.id);
  });

  it('serializes independent team members on PostgreSQL locks so only one estimate wins one version', async () => {
    const ctx = await f.context(),
      id = ctx.assignmentIds[0]!;
    await f.depart(ctx);
    const responses = await f.overlap(
      'crew',
      ctx.crews[0]!.id,
      () => estimate(ctx.actors[0]![0]!, id, { localFinish: '2030-01-07T12:00' }),
      () => estimate(ctx.actors[0]![1]!, id, { localFinish: '2030-01-07T13:00' }),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const saved = await f.source.getRepository(CrewAssignment).findOneByOrFail({ id });
    expect(saved.estimateVersion).toBe(2);
    expect([
      localToUtc('2030-01-07T12:00').toISOString(),
      localToUtc('2030-01-07T13:00').toISOString(),
    ]).toContain(saved.estimatedFinishAt?.toISOString());
  });

  it('reads serverNow after waiting for the planning lock rather than accepting an estimate which expired in the queue', async () => {
    const ctx = await f.context(),
      id = ctx.assignmentIds[0]!,
      actor = ctx.actors[0]![0]!;
    await f.depart(ctx);
    const held = await f.barrier('crew', ctx.crews[0]!.id);
    const pending = estimate(actor, id, { localFinish: '2030-01-07T09:01' });
    try {
      await f.waiters(held.pid, 1);
      vi.setSystemTime(new Date('2030-01-07T08:02:00.000Z'));
    } finally {
      await held.runner.rollbackTransaction();
      await held.runner.release();
    }
    expect((await pending).status).toBe(400);
    expect(
      (await f.source.getRepository(CrewAssignment).findOneByOrFail({ id })).estimateVersion,
    ).toBe(1);
  });

  it('rechecks disabled users after the authorization lock is acquired', async () => {
    const ctx = await f.context(),
      id = ctx.assignmentIds[0]!,
      actor = ctx.actors[0]![0]!;
    await f.depart(ctx);
    const held = await f.barrier('app_user', actor.user.id);
    const pending = estimate(actor, id);
    try {
      await f.waiters(held.pid, 1);
      await held.runner.manager.getRepository(User).update(actor.user.id, { active: false });
      await held.runner.commitTransaction();
    } finally {
      if (held.runner.isTransactionActive) await held.runner.rollbackTransaction();
      await held.runner.release();
    }
    expect((await pending).status).toBe(401);
    expect(
      (await f.source.getRepository(CrewAssignment).findOneByOrFail({ id })).estimateVersion,
    ).toBe(1);
  });

  it('rolls back the estimate and durable receipt if its audit insert fails and permits one exact safe retry', async () => {
    const ctx = await f.context(),
      id = ctx.assignmentIds[0]!,
      actor = ctx.actors[0]![0]!;
    await f.depart(ctx);
    const before = await f.history(ctx.order.id),
      input = { operationKey: freshOperation() };
    await f.source.query(
      `CREATE FUNCTION "${f.schema}".reject_m6_estimate_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id='${ctx.order.id}'::uuid AND NEW.action='ESTIMATE_SET' THEN RAISE EXCEPTION 'fixture estimate audit unavailable'; END IF; RETURN NEW; END $$`,
    );
    await f.source.query(
      `CREATE TRIGGER m6_estimate_audit_failure BEFORE INSERT ON "${f.schema}".activity_log FOR EACH ROW EXECUTE FUNCTION "${f.schema}".reject_m6_estimate_audit()`,
    );
    try {
      expect((await estimate(actor, id, input)).status).toBe(500);
      const unchanged = await f.source.getRepository(CrewAssignment).findOneByOrFail({ id });
      expect(unchanged.estimatedFinishAt).toBeNull();
      expect(unchanged.estimateVersion).toBe(1);
      expect(
        await f.source
          .getRepository(ExecutionReceipt)
          .countBy({ assignmentId: id, action: 'ESTIMATE_SET' }),
      ).toBe(0);
      expect(await f.history(ctx.order.id)).toBe(before);
    } finally {
      await f.source.query(`DROP TRIGGER m6_estimate_audit_failure ON "${f.schema}".activity_log`);
      await f.source.query(`DROP FUNCTION "${f.schema}".reject_m6_estimate_audit()`);
    }
    const saved = await json<EstimateResponse>(await estimate(actor, id, input));
    expect(saved.estimateVersion).toBe(2);
    expect(
      await f.source
        .getRepository(ExecutionReceipt)
        .countBy({ assignmentId: id, action: 'ESTIMATE_SET' }),
    ).toBe(1);
    expect(await f.history(ctx.order.id)).toBe(before + 1);
  });

  it('flags a subsequent visit per affected crew without moving either appointment or writing audit rows on reads', async () => {
    const ctx = await f.context({ crews: 2 });
    await extend(ctx, 180);
    const next = await f.context({
      existingCrews: ctx.crews,
      existingActors: ctx.actors,
      localStart: '2030-01-07T13:00',
    });
    await f.depart(ctx, 0);
    await f.depart(ctx, 1);
    await json<EstimateResponse>(await estimate(ctx.actors[0]![0]!, ctx.assignmentIds[0]!));
    await json<EstimateResponse>(await estimate(ctx.actors[1]![0]!, ctx.assignmentIds[1]!));
    const before = await f.source
      .getRepository(Appointment)
      .findOneByOrFail({ id: next.appointmentId });
    const history = await f.history(next.order.id);
    const board = await json<RiskBoardResponse>(await risk(ctx.crews.map((crew) => crew.id)));
    expect(board.dataAsOf).toBe(NOW);
    const affected = board.risks.filter((visit) => visit.appointmentId === next.appointmentId);
    expect(affected).toHaveLength(1);
    expect(
      affected[0]!.reasons
        .filter((reason) => reason.code === 'NEXT_VISIT_AT_RISK')
        .map((reason) => reason.crewId)
        .sort(),
    ).toEqual(ctx.crews.map((crew) => crew.id).sort());
    for (const reason of affected[0]!.reasons) {
      expect(reason.basis).toBe('ESTIMATE');
      expect(reason.expectedReleaseAt).toBe('2030-01-07T13:30:00.000Z');
      expect(reason.sourceAppointmentId).toBe(ctx.appointmentId);
    }
    await risk(ctx.crews.map((crew) => crew.id));
    expect(
      await f.source.getRepository(Appointment).findOneByOrFail({ id: next.appointmentId }),
    ).toEqual(before);
    expect(await f.history(next.order.id)).toBe(history);
  });

  it('distinguishes overdue unstarted, active overrun and stale estimate instead of silently treating unknown release as a future free slot', async () => {
    const active = await f.context(),
      next = await f.context({
        existingCrews: active.crews,
        existingActors: active.actors,
        localStart: '2030-01-07T12:00',
      });
    const unstarted = await f.context();
    await f.depart(active);
    await json<EstimateResponse>(
      await estimate(active.actors[0]![0]!, active.assignmentIds[0]!, {
        localFinish: '2030-01-07T10:30',
      }),
    );
    vi.setSystemTime(new Date('2030-01-07T10:00:00.000Z')); // 11:00 Rome.
    const board = await json<RiskBoardResponse>(
      await risk([...active.crews, ...unstarted.crews].map((crew) => crew.id)),
    );
    const reasons = board.risks.flatMap((visit) => visit.reasons);
    expect(
      reasons.some(
        (reason) =>
          reason.sourceAppointmentId === active.appointmentId && reason.code === 'OVERRUN',
      ),
    ).toBe(true);
    expect(
      reasons.some(
        (reason) =>
          reason.sourceAppointmentId === active.appointmentId && reason.code === 'ESTIMATE_STALE',
      ),
    ).toBe(true);
    expect(
      reasons.some(
        (reason) =>
          reason.sourceAppointmentId === unstarted.appointmentId && reason.code === 'NOT_DEPARTED',
      ),
    ).toBe(true);
    const result = await json<SlotSearchResponse>(
      await search(next, { earliestLocal: '2030-01-08T09:00' }),
    );
    expect(result.candidates).toEqual([]);
    expect(result.blockedCrews.map((crew) => crew.crewId)).toContain(active.crews[0]!.id);
    expect(result.blockedCrews[0]!.message).toMatch(/estimate|another team/i);
    expect((await f.detail(active.actors[0]![0]!, active.assignmentIds[0]!)).execution.status).toBe(
      'ON_THE_WAY',
    );
  });

  it('searches from estimate release including its stored buffer and blocks the same conflict through ordinary M4 update/create', async () => {
    const ctx = await f.context();
    await extend(ctx, 180);
    const next = await f.context({
      existingCrews: ctx.crews,
      existingActors: ctx.actors,
      localStart: '2030-01-07T15:00',
    });
    await f.depart(ctx);
    await json<EstimateResponse>(await estimate(ctx.actors[0]![0]!, ctx.assignmentIds[0]!));
    const candidate = await json<SlotSearchResponse>(
      await search(next, { earliestLocal: '2030-01-07T13:00' }),
    );
    expect(candidate.candidates[0]!.localStart).toBe('2030-01-07T14:30');
    expect(candidate.candidates[0]!.basis).toBe('ESTIMATE');
    expect(candidate.candidates[0]!.crews[0]!.travelBufferMinutes).toBe(30);
    expect(
      (
        await f.call(
          f.dispatcher,
          '/orders/' + next.order.id + '/appointments/' + next.appointmentId,
          'PATCH',
          {
            expectedVersion: next.appointmentVersion,
            localStart: '2030-01-07T13:00',
            reason: 'Unsafe earlier plan fixture',
          },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await f.call(f.dispatcher, '/orders/' + next.order.id + '/appointments', 'POST', {
          localStart: '2030-01-07T13:00',
          durationMinutes: 60,
          crewIds: [ctx.crews[0]!.id],
          idempotencyKey: freshOperation(),
        })
      ).status,
    ).toBe(409);
    const valid = await json<AppointmentResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + next.order.id + '/appointments/' + next.appointmentId,
        'PATCH',
        {
          expectedVersion: next.appointmentVersion,
          localStart: candidate.candidates[0]!.localStart,
          reason: 'Explicit safe forecast-based plan',
        },
      ),
    );
    expect(valid.appointment.id).toBe(next.appointmentId);
  });

  it('keeps yesterday’s still-active overrun and stale forecast on Today’s risk board without presenting finished history as current risk', async () => {
    const active = await f.context(),
      ended = await f.context();
    await f.depart(active);
    await json<EstimateResponse>(
      await estimate(active.actors[0]![0]!, active.assignmentIds[0]!, {
        localFinish: '2030-01-07T10:30',
      }),
    );
    const old = await f.start(ended);
    await json<CrewAssignmentResponse>(
      await f.action(ended.actors[0]![0]!, old.id, 'finish', {
        operationKey: freshOperation(),
        expectedExecutionVersion: old.execution.version,
        outcome: 'BLOCKED',
        summary: 'Yesterday finished fixture attempt',
        reason: 'Fictional access obstruction',
        remainingWork: 'Arrange fictional access',
        returnVisitRequired: false,
      }),
    );
    vi.setSystemTime(new Date('2030-01-08T08:00:00.000Z'));
    const board = await json<RiskBoardResponse>(
      await f.call(
        f.dispatcher,
        '/planning/risks?' +
          query({
            from: '2030-01-08',
            to: '2030-01-09',
            allTeams: false,
            crewIds: [...active.crews, ...ended.crews].map((crew) => crew.id),
          }),
      ),
    );
    const current = board.risks.find((visit) => visit.appointmentId === active.appointmentId);
    expect(current).toBeDefined();
    expect(current!.plannedStartAt).toBe('2030-01-07T08:00:00.000Z');
    expect(current!.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining(['OVERRUN', 'ESTIMATE_STALE', 'UNKNOWN_RELEASE']),
    );
    expect(board.risks.some((visit) => visit.appointmentId === ended.appointmentId)).toBe(false);
  });

  it('uses actual terminal release with a 15-minute grid while retaining the last estimate and original finish report', async () => {
    const ctx = await f.context();
    await extend(ctx, 180);
    const next = await f.context({
      existingCrews: ctx.crews,
      existingActors: ctx.actors,
      localStart: '2030-01-07T16:00',
    });
    await f.start(ctx);
    const estimateResult = await json<EstimateResponse>(
      await estimate(ctx.actors[0]![0]!, ctx.assignmentIds[0]!, {
        localFinish: '2030-01-07T15:00',
      }),
    );
    vi.setSystemTime(new Date('2030-01-07T13:10:00.000Z'));
    const current = await f.detail(ctx.actors[0]![0]!, ctx.assignmentIds[0]!);
    const terminal = await json<CrewAssignmentResponse>(
      await f.action(ctx.actors[0]![0]!, current.id, 'finish', {
        operationKey: freshOperation(),
        expectedExecutionVersion: current.execution.version,
        outcome: 'PARTIALLY_COMPLETED',
        summary: 'Fictional partial result',
        reason: 'Fixture missing material',
        remainingWork: 'Remaining fixture assembly',
        returnVisitRequired: true,
        returnReason: 'Missing fixture material',
      }),
    );
    const result = await json<SlotSearchResponse>(
      await search(next, { earliestLocal: '2030-01-07T14:10' }),
    );
    expect(result.candidates[0]!.localStart).toBe('2030-01-07T14:45');
    expect(result.candidates[0]!.basis).toBe('ACTUAL');
    expect(terminal.assignment.execution.estimatedFinishAt).toBe(estimateResult.estimatedFinishAt);
    expect(
      (await estimate(ctx.actors[0]![0]!, current.id, { expectedEstimateVersion: 2 })).status,
    ).toBe(409);
    expect((await f.detail(ctx.actors[0]![0]!, current.id)).finishReport).toEqual(
      terminal.assignment.finishReport,
    );
  });

  it('searches a joint explicitly chosen crew set and excludes only the movable visit, preserving other bookings of its order', async () => {
    const ctx = await f.context({ crews: 2, localStart: '2030-01-07T15:00' });
    await f.planning.create(
      ctx.order.id,
      {
        localStart: '2030-01-07T09:00',
        durationMinutes: 60,
        crewIds: [ctx.crews[0]!.id],
        idempotencyKey: freshOperation(),
      },
      f.dispatcher.user.id,
    );
    const result = await json<SlotSearchResponse>(await search(ctx));
    expect(result.candidates[0]!.localStart).toBe('2030-01-07T10:30');
    for (const candidate of result.candidates) {
      expect(candidate.crewIds.slice().sort()).toEqual(ctx.crews.map((crew) => crew.id).sort());
      expect(candidate.crews).toHaveLength(2);
    }
    expect((await search(ctx, { alternativeCrews: true })).status).toBe(400);
  });

  it('honors complete working windows, breaks, buffer, unavailability and inactive crews when selecting windows', async () => {
    const ctx = await f.context({ localStart: '2030-01-07T16:00' }),
      crewId = ctx.crews[0]!.id;
    await f.source.getRepository(CrewPlanningConfig).update(
      { crewId },
      {
        weeklyWindows: [
          { weekday: 1, startTime: '08:00', endTime: '12:00' },
          { weekday: 1, startTime: '13:00', endTime: '18:00' },
        ],
      },
    );
    await f.source.getRepository(CrewUnavailability).save({
      crewId,
      startAt: localToUtc('2030-01-07T13:00'),
      endAt: localToUtc('2030-01-07T14:00'),
      reason: 'Fictional lunch exception',
      active: true,
      createdBy: f.dispatcher.user.id,
      updatedBy: f.dispatcher.user.id,
    });
    const result = await json<SlotSearchResponse>(
      await search(ctx, {
        earliestLocal: '2030-01-07T11:00',
        from: '2030-01-07',
        to: '2030-01-08',
      }),
    );
    expect(result.candidates[0]!.localStart).toBe('2030-01-07T14:00');
    expect(result.candidates.every((candidate) => candidate.localStart <= '2030-01-07T16:30')).toBe(
      true,
    );
    const weekend = await json<SlotSearchResponse>(
      await search(ctx, {
        earliestLocal: '2030-01-12T09:00',
        from: '2030-01-12',
        to: '2030-01-13',
      }),
    );
    expect(weekend.candidates).toEqual([]);
    await f.source.getRepository(Crew).update(crewId, { active: false });
    const inactive = await json<SlotSearchResponse>(await search(ctx));
    expect(inactive.candidates).toEqual([]);
  });

  it('offers single-team alternatives explicitly with service metadata without silently changing a joint crew set', async () => {
    const ctx = await f.context(),
      alternative = await f.makeCrew();
    await f.source
      .getRepository(Crew)
      .update(alternative.id, { serviceArea: 'Fictional outer area', workEnvironment: 'OUTDOOR' });
    const result = await json<SlotSearchResponse>(await search(ctx, { alternativeCrews: true }));
    expect(result.candidates[0]!.crewIds).toEqual([ctx.crews[0]!.id]);
    expect(result.candidates.some((candidate) => candidate.crewIds[0] !== ctx.crews[0]!.id)).toBe(
      true,
    );
    for (const candidate of result.candidates) {
      expect(candidate.crews).toHaveLength(1);
      expect(candidate.crews[0]).toEqual(
        expect.objectContaining({
          serviceArea: expect.any(String),
          workEnvironment: expect.stringMatching(/^(INDOOR|OUTDOOR|BOTH)$/),
          travelBufferMinutes: expect.any(Number),
        }),
      );
    }
  });

  it('bounds read-only search to 14/42 days and 20 deterministic candidates without reserving or writing history', async () => {
    const ctx = await f.context();
    const before = await f.source.getRepository(Appointment).count(),
      history = await f.history(ctx.order.id);
    const first = await json<SlotSearchResponse>(await search(ctx));
    const again = await json<SlotSearchResponse>(await search(ctx));
    expect(first.from.slice(0, 10)).toBe('2030-01-07');
    expect(first.to.slice(0, 10)).toBe('2030-01-21');
    expect(first.candidates).toHaveLength(20);
    expect(first.limited).toBe(true);
    expect(first.candidates).toEqual(again.candidates);
    expect(
      first.candidates.every(
        (candidate) =>
          candidate.plannedStartAt >= NOW && Number(candidate.localStart.slice(-2)) % 15 === 0,
      ),
    ).toBe(true);
    expect(await f.source.getRepository(Appointment).count()).toBe(before);
    expect(await f.history(ctx.order.id)).toBe(history);
    vi.setSystemTime(new Date('2030-01-07T08:07:00.000Z'));
    const clamped = await json<SlotSearchResponse>(await search(ctx));
    expect(clamped.candidates[0]!.localStart).toBe('2030-01-07T09:15');
    vi.setSystemTime(new Date(NOW));
    expect((await search(ctx, { from: '2030-01-07', to: '2030-02-18' })).status).toBe(200);
    expect((await search(ctx, { from: '2030-01-07', to: '2030-02-19' })).status).toBe(400);
    expect((await search(ctx, { earliestLocal: '2030-03-31T02:30' })).status).toBe(400);
    expect((await search(ctx, { earliestLocal: '2030-10-27T02:30' })).status).toBe(400);
    expect(
      (
        await f.call(
          ctx.actors[0]![0]!,
          '/planning/available-windows?' +
            query({
              context: 'APPOINTMENT',
              orderId: ctx.order.id,
              appointmentId: ctx.appointmentId,
              earliestLocal: '2030-01-07T09:00',
              durationMinutes: 60,
              crewIds: [ctx.crews[0]!.id],
              alternativeCrews: false,
            }),
        )
      ).status,
    ).toBe(403);
  });

  it('uses Europe/Rome calendar days across 23/25-hour days independently of the process timezone', async () => {
    const ctx = await f.context(),
      before = process.env.TZ;
    try {
      for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
        process.env.TZ = zone;
        for (const [day, next, expected] of [
          ['2030-03-31', '2030-04-01', '2030-03-31T06:00:00.000Z'],
          ['2030-10-27', '2030-10-28', '2030-10-27T07:00:00.000Z'],
        ]) {
          const result = await json<SlotSearchResponse>(
            await search(ctx, { earliestLocal: day + 'T08:00', from: day, to: next }),
          );
          expect(result.candidates[0]!.localStart).toBe(day + 'T08:00');
          expect(result.candidates[0]!.plannedStartAt).toBe(expected);
          expect(
            result.candidates.every((candidate) => candidate.localStart.startsWith(day!)),
          ).toBe(true);
        }
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it('keeps a started visit immutable while allowing a metadata-only clarification after its forecast becomes unknown', async () => {
    const ctx = await f.context();
    await f.depart(ctx);
    vi.setSystemTime(new Date('2030-01-07T12:00:00.000Z'));
    for (const change of [
      { localStart: '2030-01-07T14:00' },
      { durationMinutes: 120 },
      { crewIds: [] },
    ])
      expect(
        (
          await f.call(
            f.dispatcher,
            '/orders/' + ctx.order.id + '/appointments/' + ctx.appointmentId,
            'PATCH',
            {
              expectedVersion: ctx.appointmentVersion,
              reason: 'Must not rewrite started work',
              ...change,
            },
          )
        ).status,
      ).toBe(409);
    const note = await json<AppointmentResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + ctx.order.id + '/appointments/' + ctx.appointmentId,
        'PATCH',
        { expectedVersion: ctx.appointmentVersion, notes: 'Private dispatcher clarification' },
      ),
    );
    expect(note.appointment.plannedStartAt).toBe('2030-01-07T08:00:00.000Z');
    expect(note.appointment.assignments[0]!.id).toBe(ctx.assignmentIds[0]);
    safeEvidence(await f.detail(ctx.actors[0]![0]!, ctx.assignmentIds[0]!));
  });
  it('blocks finder and fresh apply from early departure until finish without rewriting the afternoon plan', async () => {
    const afternoon = await f.context({ localStart: '2030-01-07T15:00' });
    const morning = await f.context({
      existingCrews: afternoon.crews,
      existingActors: afternoon.actors,
    });
    const original = await f.source
      .getRepository(Appointment)
      .findOneByOrFail({ id: afternoon.appointmentId });
    let current = await f.depart(afternoon);
    expect(current.execution.departedAt).toBe(NOW);
    const activeSearch = await json<SlotSearchResponse>(
      await search(morning, { from: '2030-01-07', to: '2030-01-08' }),
    );
    expect(activeSearch.candidates[0]!.localStart).toBe('2030-01-07T16:30');
    const apply = (localStart: string) =>
      f.call(
        f.dispatcher,
        '/orders/' + morning.order.id + '/appointments/' + morning.appointmentId + '/reschedule',
        'POST',
        {
          operationKey: freshOperation(),
          expectedVersion: morning.appointmentVersion,
          localStart,
          durationMinutes: 60,
          crewIds: morning.crews.map((crew) => crew.id),
          reason: 'Fictional early departure reservation check',
        },
      );
    const rejected = await apply('2030-01-07T10:00');
    expect(rejected.status).toBe(409);
    expect(((await rejected.json()) as { code: string }).code).toBe('PREDICTED_CONFLICT');
    // The exact-window M4 path must also load an active afternoon plan whose departure was in the morning.
    expect(
      (
        await f.call(
          f.dispatcher,
          '/orders/' + morning.order.id + '/appointments/' + morning.appointmentId,
          'PATCH',
          {
            expectedVersion: morning.appointmentVersion,
            localStart: '2030-01-07T10:00',
            reason: 'Must not bypass early actual departure',
          },
        )
      ).status,
    ).toBe(409);
    for (const action of ['arrive', 'start'])
      current = (
        await json<CrewAssignmentResponse>(
          await f.action(afternoon.actors[0]![0]!, current.id, action, {
            operationKey: freshOperation(),
            expectedExecutionVersion: current.execution.version,
          }),
        )
      ).assignment;
    vi.setSystemTime(new Date('2030-01-07T08:10:00.000Z'));
    await json<CrewAssignmentResponse>(
      await f.action(afternoon.actors[0]![0]!, current.id, 'finish', {
        operationKey: freshOperation(),
        expectedExecutionVersion: current.execution.version,
        outcome: 'BLOCKED',
        summary: 'Fictional early visit stopped',
        reason: 'Fixture access blocked',
        remainingWork: 'Fictional assembly remains',
        returnVisitRequired: false,
      }),
    );
    const afterFinish = await json<SlotSearchResponse>(await search(morning));
    expect(afterFinish.candidates[0]!.localStart).toBe('2030-01-07T09:15');
    expect((await apply(afterFinish.candidates[0]!.localStart)).status).toBe(200);
    expect(
      await f.source.getRepository(Appointment).findOneByOrFail({ id: afternoon.appointmentId }),
    ).toEqual(original);
  });
});
