import { randomBytes } from 'node:crypto';
import type {
  AppointmentResponse,
  AuthResponse,
  CrewResponse,
  OrderResponse,
} from '@furniture-delivery/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { User } from '../src/identity/user.entity';
import { AuthSession } from '../src/identity/auth-session.entity';
import { CrewMember } from '../src/identity/crew-member.entity';
import { Order } from '../src/orders/order.entity';
import { ExecutionReceipt } from '../src/execution/execution-receipt.entity';
import { RealtimeHub } from '../src/realtime/realtime-hub';
import { markRealtime } from '../src/realtime/post-commit';
import {
  createEvidenceFixture,
  evidenceJson as json,
  freshOperation,
  type EvidenceFixture,
} from './evidence-fixture';
import { connectTestStream, untilTestCondition } from './stream-client';

describe('M8 authorized HTTP streams on isolated PostgreSQL, not browser E2E', () => {
  let f: EvidenceFixture, hub: RealtimeHub;
  const streams: Awaited<ReturnType<typeof connectTestStream>>[] = [];
  async function stream(actor = f.dispatcher) {
    const connection = await connectTestStream(f.base, actor.cookie);
    streams.push(connection);
    expect(connection.response.status).toBe(200);
    expect(connection.response.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(connection.response.headers.get('cache-control')).toContain('no-store');
    expect(connection.response.headers.get('cache-control')).toContain('no-transform');
    expect(await connection.take('ready')).toBeDefined();
    return connection;
  }
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-07T08:00:00.000Z'));
    f = await createEvidenceFixture('m8_realtime', (config, root) => ({
      ...config,
      storage: { ...config.storage, root },
    }));
    hub = f.app.get(RealtimeHub);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(streams.splice(0).map((connection) => connection.close()));
    await untilTestCondition(() => hub.inspect().connections === 0);
    await untilTestCondition(() => hub.inspect().authInFlight === 0);
    expect(hub.inspect().setups).toBe(0);
    expect(hub.inspect().timers).toBe(0);
    expect(hub.inspect().queuedHints).toBe(0);
  });
  afterAll(async () => {
    await f?.close();
    vi.useRealTimers();
  });

  it('rejects anonymous, disabled, expired and explicitly cross-origin handshakes before SSE headers', async () => {
    const cases: { headers: Record<string, string> }[] = [
      { headers: {} },
      { headers: { Cookie: f.dispatcher.cookie, Origin: 'https://forbidden.example' } },
      { headers: { Cookie: f.dispatcher.cookie, 'Sec-Fetch-Site': 'cross-site' } },
    ];
    for (const options of cases) {
      const response = await fetch(f.base + '/api/realtime/events', options);
      expect(response.status).toBe(Object.keys(options.headers).length ? 403 : 401);
      expect(response.headers.get('content-type')).not.toContain('text/event-stream');
      await response.body?.cancel();
    }
    const disabled = await f.makeActor('DISPATCHER');
    await f.source.getRepository(User).update(disabled.user.id, { active: false });
    const expired = await f.makeActor('DISPATCHER');
    await f.source
      .getRepository(AuthSession)
      .update({ userId: expired.user.id }, { expiresAt: new Date(Date.now() - 1) });
    for (const actor of [disabled, expired]) {
      const response = await f.call(actor, '/realtime/events');
      expect(response.status).toBe(401);
      await response.body?.cancel();
    }
    expect(hub.inspect().connections).toBe(0);
  });

  it('delivers a committed crew mutation to an independent allowed employee and canonical API read, without foreign scope or private fields', async () => {
    const ctx = await f.context(),
      receiver = await stream(ctx.actors[0]![1]!),
      backoffice = await stream(),
      foreign = await stream(await f.makeActor('CREW_MEMBER', (await f.makeCrew()).id));
    await f.depart(ctx);
    await hub.flush();
    const event = await receiver.take('invalidate');
    expect(event).toBeDefined();
    expect(Object.keys(event!.data).sort()).toEqual(['emittedAt', 'eventId', 'topics']);
    expect(event!.data.topics).toContain('crew-work');
    expect(await backoffice.take('invalidate')).toBeDefined();
    expect(await foreign.take('invalidate', 150)).toBeUndefined();
    const canonical = await f.detail(ctx.actors[0]![1]!, ctx.assignmentIds[0]!);
    expect(canonical.execution.status).toBe('ON_THE_WAY');
    expect('payments' in canonical).toBe(false);
    expect('internalNotes' in canonical).toBe(false);
    expect('orderTotalCents' in canonical).toBe(false);
  });

  it('publishes only after the external commit and discards inner-savepoint and outer rollbacks', async () => {
    const ctx = await f.context(),
      receiver = await stream(),
      source = await f.app.get(DatabaseService).getDataSource();
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    const writing = source.transaction(async (manager) => {
      await manager
        .getRepository(Order)
        .update(ctx.order.id, { contactName: 'Committed fixture contact' });
      markRealtime(manager, { backoffice: ['orders'], orderId: ctx.order.id });
      entered();
      await gate;
    });
    await ready;
    try {
      await hub.flush();
      expect(await receiver.take('invalidate', 100)).toBeUndefined();
    } finally {
      release();
      await writing;
    }
    await hub.flush();
    expect((await receiver.take('invalidate'))!.data.topics).toEqual(['orders']);
    await source.transaction(async (manager) => {
      await expect(
        manager.transaction(async (nested) => {
          await nested
            .getRepository(Order)
            .update(ctx.order.id, { contactName: 'Rolled-back nested contact' });
          markRealtime(nested, { backoffice: ['planning'], orderId: ctx.order.id });
          throw new Error('Controlled nested rollback');
        }),
      ).rejects.toThrow('Controlled nested rollback');
    });
    await expect(
      source.transaction(async (manager) => {
        await manager.transaction(async (nested) => {
          markRealtime(nested, { backoffice: ['planning'], orderId: ctx.order.id });
        });
        throw new Error('Controlled outer rollback');
      }),
    ).rejects.toThrow('Controlled outer rollback');
    await hub.flush();
    expect(await receiver.take('invalidate', 100)).toBeUndefined();
    expect((await f.orders.detail(ctx.order.id)).contactName).toBe('Committed fixture contact');
  });

  it('rolls back an HTTP mutation when audit fails without publishing, but delivery failure after commit never cancels saved work', async () => {
    const ctx = await f.context(),
      receiver = await stream(),
      source = await f.app.get(DatabaseService).getDataSource();
    await f.source.query(
      `CREATE FUNCTION "${f.schema}".reject_m8_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id='${ctx.order.id}'::uuid THEN RAISE EXCEPTION 'synthetic audit unavailable'; END IF; RETURN NEW; END $$`,
    );
    await f.source.query(
      `CREATE TRIGGER reject_m8_audit BEFORE INSERT ON "${f.schema}".activity_log FOR EACH ROW EXECUTE FUNCTION "${f.schema}".reject_m8_audit()`,
    );
    try {
      expect(
        (
          await f.call(f.dispatcher, '/orders/' + ctx.order.id, 'PATCH', {
            expectedVersion: (await f.orders.detail(ctx.order.id)).version,
            contactName: 'Must roll back',
          })
        ).status,
      ).toBe(500);
    } finally {
      await f.source.query(`DROP TRIGGER reject_m8_audit ON "${f.schema}".activity_log`);
      await f.source.query(`DROP FUNCTION "${f.schema}".reject_m8_audit()`);
    }
    await hub.flush();
    expect(await receiver.take('invalidate', 100)).toBeUndefined();
    expect((await f.orders.detail(ctx.order.id)).contactName).not.toBe('Must roll back');
    const delivery = vi.spyOn(hub, 'publish').mockImplementationOnce(() => {
      throw new Error('Synthetic notification outage');
    });
    const changed = await json<OrderResponse>(
      await f.call(f.dispatcher, '/orders/' + ctx.order.id, 'PATCH', {
        expectedVersion: (await f.orders.detail(ctx.order.id)).version,
        contactName: 'Saved despite notification outage',
      }),
    );
    expect(changed.order.contactName).toBe('Saved despite notification outage');
    expect(delivery).toHaveBeenCalledOnce();
    expect(
      (await source.getRepository(Order).findOneByOrFail({ id: ctx.order.id })).contactName,
    ).toBe('Saved despite notification outage');
    delivery.mockRestore();
  });

  it('keeps financial and BACKOFFICE_ONLY changes silent for crew while notifying backoffice', async () => {
    const ctx = await f.context(),
      crew = await stream(ctx.actors[0]![0]!),
      backoffice = await stream();
    const payment = await f.call(f.dispatcher, '/orders/' + ctx.order.id + '/payments', 'POST', {
      amountCents: 1000,
      paidOn: '2030-01-07',
      method: 'CASH',
      idempotencyKey: freshOperation(),
    });
    expect(payment.status).toBe(201);
    await payment.body?.cancel();
    await hub.flush();
    expect(await backoffice.take('invalidate')).toBeDefined();
    expect(await crew.take('invalidate', 120)).toBeUndefined();
    await json(
      await f.call(f.dispatcher, '/orders/' + ctx.order.id + '/notes', 'POST', {
        operationKey: freshOperation(),
        visibility: 'BACKOFFICE_ONLY',
        text: 'Private synthetic dispatcher note',
      }),
    );
    await hub.flush();
    expect(await backoffice.take('invalidate')).toBeDefined();
    expect(await crew.take('invalidate', 120)).toBeUndefined();
    const before = await f.orders.detail(ctx.order.id);
    await json(
      await f.call(f.dispatcher, '/orders/' + ctx.order.id, 'PATCH', {
        expectedVersion: before.version,
        orderTotalCents: before.orderTotalCents + 1,
        crewNotes: before.crewNotes,
      }),
    );
    await hub.flush();
    expect(await backoffice.take('invalidate')).toBeDefined();
    expect(await crew.take('invalidate', 120)).toBeUndefined();
  });

  it('rechecks logout, explicit revocation, expiry and disabled users on an idle heartbeat and closes their previous streams', async () => {
    for (const cause of ['logout', 'revoke', 'expire', 'disable'] as const) {
      const actor = await f.makeActor('DISPATCHER'),
        connection = await stream(actor);
      if (cause === 'logout') await json(await f.call(actor, '/auth/logout', 'POST'));
      if (cause === 'revoke')
        await f.source
          .getRepository(AuthSession)
          .update({ userId: actor.user.id }, { revokedAt: new Date() });
      if (cause === 'expire')
        await f.source
          .getRepository(AuthSession)
          .update({ userId: actor.user.id }, { expiresAt: new Date(Date.now() - 1) });
      if (cause === 'disable')
        await f.source.getRepository(User).update(actor.user.id, { active: false });
      await hub.heartbeat();
      const reset = await connection.take('access-reset');
      expect(reset?.data.reason).toBe('SESSION_ENDED');
      expect(Object.keys(reset!.data).sort()).toEqual(['emittedAt', 'eventId', 'reason']);
      await untilTestCondition(() => connection.ended);
    }
  });

  it('resets changed roles and membership without exposing the new scope or accepting old object access', async () => {
    const roleActor = await f.makeActor('DISPATCHER'),
      roleStream = await stream(roleActor);
    await f.source.getRepository(User).update(roleActor.user.id, { role: 'CREW_MEMBER' });
    await hub.heartbeat();
    expect((await roleStream.take('access-reset'))?.data.reason).toBe('SCOPE_CHANGED');
    const ctx = await f.context(),
      actor = ctx.actors[0]![0]!,
      connection = await stream(actor),
      next = await f.makeCrew();
    await f.source.transaction(async (manager) => {
      await manager
        .getRepository(CrewMember)
        .update({ userId: actor.user.id, active: true }, { active: false });
      await manager
        .getRepository(CrewMember)
        .save({ userId: actor.user.id, crewId: next.id, active: true });
    });
    await hub.heartbeat();
    const reset = await connection.take('access-reset');
    expect(reset?.data.reason).toBe('SCOPE_CHANGED');
    expect(Object.keys(reset!.data).sort()).toEqual(['emittedAt', 'eventId', 'reason']);
    expect((await f.call(actor, '/crew/assignments/' + ctx.assignmentIds[0]!)).status).toBe(404);
  });

  it('refreshes the new team list and clears old assignment access when a dispatcher changes the assigned team', async () => {
    const ctx = await f.context(),
      old = await stream(ctx.actors[0]![0]!),
      next = await f.makeCrew(),
      nextActor = await f.makeActor('CREW_MEMBER', next.id),
      added = await stream(nextActor);
    const changed = await json<AppointmentResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + ctx.order.id + '/appointments/' + ctx.appointmentId,
        'PATCH',
        {
          expectedVersion: ctx.appointmentVersion,
          crewIds: [next.id],
          reason: 'Dispatcher explicitly assigns the work to the other synthetic team',
        },
      ),
    );
    await hub.flush();
    expect((await old.take('access-reset'))?.data.reason).toBe('SCOPE_CHANGED');
    const event = await added.take('invalidate');
    expect(event?.data.topics).toContain('crew-work');
    const newId = changed.appointment.assignments.find(
      (assignment) => assignment.status === 'ASSIGNED',
    )!.id;
    const list = await f.call(nextActor, '/crew/assignments?view=open');
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json()).includes(newId)).toBe(true);
    expect(
      (await f.call(ctx.actors[0]![0]!, '/crew/assignments/' + ctx.assignmentIds[0]!)).status,
    ).toBe(404);
  });

  it('updates permitted dispatcher member candidates when an administrator creates an employee without exposing the admin-only accounts topic', async () => {
    const dispatcher = await stream(),
      administrator = await stream(f.administrator),
      crew = await stream(await f.makeActor('CREW_MEMBER', (await f.makeCrew()).id));
    const created = await json<AuthResponse>(
      await f.call(f.administrator, '/users', 'POST', {
        username: 'm8.candidate.' + freshOperation().replaceAll('-', '').slice(0, 12),
        displayName: 'Fictional new candidate',
        password: randomBytes(24).toString('base64url'),
        role: 'CREW_MEMBER',
        active: true,
      }),
      201,
    );
    await hub.flush();
    const permitted = await dispatcher.take('invalidate'),
      privileged = await administrator.take('invalidate');
    expect(permitted?.data.topics).toContain('crews');
    expect(permitted?.data.topics).not.toContain('accounts');
    expect(privileged?.data.topics).toContain('accounts');
    expect(await crew.take('invalidate', 100)).toBeUndefined();
    const candidates = await f.call(f.dispatcher, '/crews/member-candidates');
    expect(candidates.status).toBe(200);
    expect(JSON.stringify(await candidates.json()).includes(created.user.id)).toBe(true);
  });

  it('revokes the affected employee stream for a private password reset without signaling teammates or dispatcher candidates', async () => {
    const ctx = await f.context(),
      subject = await stream(ctx.actors[0]![0]!),
      teammate = await stream(ctx.actors[0]![1]!),
      dispatcher = await stream(),
      administrator = await stream(f.administrator);
    await json<AuthResponse>(
      await f.call(f.administrator, '/users/' + ctx.actors[0]![0]!.user.id, 'PATCH', {
        password: randomBytes(24).toString('base64url'),
        displayName: ctx.actors[0]![0]!.user.displayName,
        role: 'CREW_MEMBER',
        active: true,
      }),
    );
    await hub.flush();
    expect((await subject.take('access-reset'))?.data.reason).toBe('SESSION_ENDED');
    expect((await administrator.take('invalidate'))?.data.topics).toContain('accounts');
    expect(await teammate.take('invalidate', 120)).toBeUndefined();
    expect(await dispatcher.take('invalidate', 120)).toBeUndefined();
    expect((await f.call(ctx.actors[0]![0]!, '/auth/me')).status).toBe(401);
    expect((await f.call(ctx.actors[0]![1]!, '/auth/me')).status).toBe(200);
  });

  it('keeps unrelated backoffice identities private from dispatcher crew hints while retaining subject session behavior', async () => {
    const dispatcher = await stream(),
      administrator = await stream(f.administrator);
    for (const field of ['displayName', 'role', 'active'] as const) {
      const actor = await f.makeActor('ADMIN'),
        subject = await stream(actor);
      expect(await f.source.getRepository(CrewMember).countBy({ userId: actor.user.id })).toBe(0);
      const input =
        field === 'displayName'
          ? { displayName: 'Synthetic private backoffice rename' }
          : field === 'role'
            ? { role: 'DISPATCHER' }
            : { active: false };
      const updated = await json<AuthResponse>(
        await f.call(f.administrator, '/users/' + actor.user.id, 'PATCH', input),
      );
      await hub.flush();
      expect((await administrator.take('invalidate'))?.data.topics).toContain('accounts');
      if (field === 'displayName') {
        expect((await subject.take('invalidate'))?.data.topics).toContain('accounts');
        const canonical = await json<AuthResponse>(await f.call(actor, '/auth/me'));
        expect(canonical.user.displayName).toBe(updated.user.displayName);
      } else {
        expect((await subject.take('access-reset'))?.data.reason).toBe('SESSION_ENDED');
        expect((await f.call(actor, '/auth/me')).status).toBe(401);
      }
      expect(await dispatcher.take('invalidate', 120)).toBeUndefined();
      await subject.close();
    }
  });

  it('refreshes historical crew rosters as well as the current team when a visible former member identity changes', async () => {
    const ctx = await f.context(),
      actor = ctx.actors[0]![0]!,
      oldCrew = ctx.crews[0]!,
      nextCrew = await f.makeCrew(),
      nextActor = await f.makeActor('CREW_MEMBER', nextCrew.id);
    const initialRoster = await json<CrewResponse>(
      await f.call(f.dispatcher, '/crews/' + oldCrew.id),
    );
    const membership = initialRoster.crew.members.find(
      (member) => member.userId === actor.user.id,
    )!;
    await json<CrewResponse>(
      await f.call(f.dispatcher, '/crews/' + oldCrew.id + '/members/' + membership.id, 'PATCH', {
        active: false,
      }),
    );
    await json<CrewResponse>(
      await f.call(f.dispatcher, '/crews/' + nextCrew.id + '/members', 'POST', {
        userId: actor.user.id,
      }),
      201,
    );
    const oldTeammate = await stream(ctx.actors[0]![1]!),
      newTeammate = await stream(nextActor),
      dispatcher = await stream(),
      administrator = await stream(f.administrator);
    const changedName = 'Synthetic visible name in both current and historical team rosters';
    await json<AuthResponse>(
      await f.call(f.administrator, '/users/' + actor.user.id, 'PATCH', {
        displayName: changedName,
      }),
    );
    await hub.flush();
    expect((await oldTeammate.take('invalidate'))?.data.topics).toContain('crew-team');
    expect((await newTeammate.take('invalidate'))?.data.topics).toContain('crew-team');
    const permitted = await dispatcher.take('invalidate');
    expect(permitted?.data.topics).toContain('crews');
    expect(permitted?.data.topics).not.toContain('accounts');
    expect((await administrator.take('invalidate'))?.data.topics).toContain('accounts');
    const oldRoster = await json<CrewResponse>(
        await f.call(ctx.actors[0]![1]!, '/crews/' + oldCrew.id),
      ),
      newRoster = await json<CrewResponse>(await f.call(nextActor, '/crews/' + nextCrew.id));
    expect(oldRoster.crew.members.find((member) => member.userId === actor.user.id)).toMatchObject({
      active: false,
      user: { displayName: changedName },
    });
    expect(newRoster.crew.members.find((member) => member.userId === actor.user.id)).toMatchObject({
      active: true,
      user: { displayName: changedName },
    });
  });

  it('fails closed for an authorization database error and releases aborted/closed streams without retaining transactions', async () => {
    const connection = await stream(),
      source = await f.app.get(DatabaseService).getDataSource();
    vi.spyOn(source, 'transaction').mockRejectedValueOnce(
      new Error('Synthetic authentication database outage'),
    );
    await hub.heartbeat();
    await untilTestCondition(() => connection.ended);
    expect(await connection.take('invalidate', 50)).toBeUndefined();
    vi.restoreAllMocks();
    for (let i = 0; i < 4; i++) {
      const opened = await stream();
      await opened.close();
    }
    await untilTestCondition(() => hub.inspect().connections === 0);
    expect(hub.inspect().setups).toBe(0);
    const transactions = await f.source.query(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND xact_start IS NOT NULL AND state='idle in transaction'",
    );
    expect(transactions[0].count).toBe(0);
  });

  it('recovers a missed hint by reconnecting and reading the canonical API, and does not duplicate an idempotent execution command', async () => {
    const ctx = await f.context(),
      actor = ctx.actors[0]![0]!,
      id = ctx.assignmentIds[0]!,
      before = await f.detail(actor, id),
      input = {
        operationKey: freshOperation(),
        expectedExecutionVersion: before.execution.version,
        expectedAppointmentVersion: before.appointmentVersion,
      };
    const first = await stream(actor);
    await first.close();
    await json(await f.action(actor, id, 'depart', input));
    await json(await f.action(actor, id, 'depart', input));
    const next = await stream(actor);
    expect(next.ended).toBe(false);
    const canonical = await f.detail(actor, id);
    expect(canonical.execution.version).toBe(before.execution.version + 1);
    expect(canonical.execution.status).toBe('ON_THE_WAY');
    expect(await f.source.getRepository(ExecutionReceipt).countBy({ assignmentId: id })).toBe(1);
  });
});
