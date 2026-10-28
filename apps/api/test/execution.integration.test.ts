import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { INestApplication } from '@nestjs/common';
import type {
  CrewAssignmentListResponse,
  CrewAssignmentResponse,
  CreateOrderRequest,
  OrderDetail,
  UserRole,
} from '@furniture-delivery/contracts';
import type { DataSource, QueryRunner } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApplication } from '../src/application';
import { hashSessionToken } from '../src/auth/auth.service';
import { hashPassword } from '../src/auth/password';
import { readIntegrationConfig } from '../src/config/environment';
import { createDataSource } from '../src/database/data-source';
import { DatabaseService } from '../src/database/database.service';
import { seedPlanningDefaults } from '../src/database/demo-planning';
import { Crew } from '../src/crews/crew.entity';
import { CrewMember } from '../src/identity/crew-member.entity';
import { AuthSession } from '../src/identity/auth-session.entity';
import { User } from '../src/identity/user.entity';
import { ActivityLog } from '../src/orders/activity-log.entity';
import { OrderItem } from '../src/orders/order-item.entity';
import { Order } from '../src/orders/order.entity';
import { OrderDto } from '../src/orders/orders.dto';
import { OrdersService } from '../src/orders/orders.service';
import { Appointment } from '../src/planning/appointment.entity';
import { CrewAssignment } from '../src/planning/crew-assignment.entity';
import { CrewPlanningConfig } from '../src/planning/crew-planning-config.entity';
import { Task } from '../src/planning/task.entity';
import { PlanningService } from '../src/planning/planning.service';

const FIXED_NOW = '2030-01-07T08:00:00.000Z'; // Monday09:00 Europe/Rome.
const origin = 'http://127.0.0.1:3000';
const orderInput = (total = 100000): CreateOrderRequest =>
  OrderDto.create({
    customerName: 'Fictional Execution Customer',
    contactName: 'Fictional Site Contact',
    phoneNumbers: ['+39 000 111'],
    email: 'fixture@example.invalid',
    address: 'Fictional execution road 12',
    city: 'Roma',
    country: 'Italy',
    serviceType: 'DELIVERY_AND_ASSEMBLY',
    workDescription: 'Furniture delivery and assembly fixture',
    estimatedDurationMinutes: 60,
    orderTotalCents: total,
    internalNotes: 'BACKOFFICE PRIVATE FIXTURE',
    crewNotes: 'Working crew instructions',
    items: [
      { description: 'Assembly table', quantity: 3, requiresAssembly: true, sortOrder: 0 },
      { description: 'Delivery chairs', quantity: 4, requiresAssembly: false, sortOrder: 1 },
    ],
  });
interface ActorFixture {
  user: User;
  cookie: string;
}
interface ContextFixture {
  order: OrderDetail;
  appointmentId: string;
  appointmentVersion: number;
  crews: Crew[];
  assignments: CrewAssignment[];
  actors: ActorFixture[][];
}

describe('M5 core crew execution on isolated Compose PostgreSQL', () => {
  const schema = `m5_execution_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource | undefined,
    source: DataSource,
    app: INestApplication | undefined,
    base: string,
    orders: OrdersService,
    planning: PlanningService,
    passwordHash: string,
    dispatcher: ActorFixture,
    administrator: ActorFixture;
  const call = (
    actor: ActorFixture | undefined,
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + '/api' + path, {
      method,
      signal: AbortSignal.timeout(8000),
      headers: {
        Origin: origin,
        'X-CSRF-Protection': '1',
        ...(actor ? { Cookie: actor.cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const json = async <T>(response: Response, status = 200): Promise<T> => {
    expect(response.status).toBe(status);
    return (await response.json()) as T;
  };
  async function makeActor(role: UserRole, crewId?: string): Promise<ActorFixture> {
    const user = await source.getRepository(User).save({
      username: 'exec.' + randomUUID().replaceAll('-', '').slice(0, 18),
      displayName: 'Fictional ' + role,
      role,
      active: true,
      passwordHash,
    });
    if (crewId)
      await source.getRepository(CrewMember).save({ userId: user.id, crewId, active: true });
    const token = randomBytes(32).toString('base64url'),
      createdAt = new Date();
    await source.getRepository(AuthSession).save({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 14 * 86400000),
      revokedAt: null,
    });
    return { user, cookie: 'fd_session=' + token };
  }
  async function makeCrew(): Promise<Crew> {
    const crew = await source.getRepository(Crew).save({
      code: 'EXEC-' + randomUUID().slice(0, 8).toUpperCase(),
      name: 'Fictional execution team',
      active: true,
      workEnvironment: 'INDOOR',
      serviceArea: 'Fixture area',
    });
    await source.getRepository(CrewPlanningConfig).save({
      crewId: crew.id,
      weeklyWindows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday,
        startTime: '08:00',
        endTime: '23:00',
      })),
      travelBufferMinutes: 30,
      version: 1,
      updatedBy: null,
    });
    return crew;
  }
  async function makeContext(
    options: {
      crews?: number;
      localStart?: string;
      confirm?: boolean;
      input?: CreateOrderRequest;
      existingCrews?: Crew[];
      existingActors?: ActorFixture[][];
    } = {},
  ): Promise<ContextFixture> {
    const crews =
      options.existingCrews ??
      (await Promise.all(Array.from({ length: options.crews ?? 1 }, () => makeCrew())));
    const actors =
      options.existingActors ??
      (await Promise.all(
        crews.map(async (crew) => [
          await makeActor('CREW_MEMBER', crew.id),
          await makeActor('CREW_MEMBER', crew.id),
        ]),
      ));
    const order = await orders.create(options.input ?? orderInput(), dispatcher.user.id);
    let result = await planning.create(
      order.id,
      {
        localStart: options.localStart ?? '2030-01-07T09:00',
        durationMinutes: 60,
        crewIds: crews.map((crew) => crew.id),
        idempotencyKey: randomUUID(),
        notes: 'BACKOFFICE APPOINTMENT PRIVATE FIXTURE',
      },
      dispatcher.user.id,
    );
    if (options.confirm !== false)
      result = await planning.confirm(
        order.id,
        result.appointment.id,
        result.appointment.version,
        dispatcher.user.id,
      );
    const assignments = await source.getRepository(CrewAssignment).find({
      where: { appointmentId: result.appointment.id, status: 'ASSIGNED' },
      order: { crewId: 'ASC' },
    });
    return {
      order: result.order,
      appointmentId: result.appointment.id,
      appointmentVersion: result.appointment.version,
      crews,
      assignments: crews.map(
        (crew) => assignments.find((assignment) => assignment.crewId === crew.id)!,
      ),
      actors,
    };
  }
  const crewPath = (assignmentId: string, suffix = '') =>
    '/crew/assignments/' + assignmentId + suffix;
  const history = (orderId: string) => source.getRepository(ActivityLog).countBy({ orderId });
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FIXED_NOW));
    const config = readIntegrationConfig();
    admin = createDataSource(config);
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    source = createDataSource(config, { schema });
    await source.initialize();
    await source.runMigrations();
    await seedPlanningDefaults(source, 'test');
    passwordHash = await hashPassword(randomBytes(24).toString('base64url'));
    dispatcher = await makeActor('DISPATCHER');
    administrator = await makeActor('ADMIN');
    orders = new OrdersService(new DatabaseService(source));
    planning = new PlanningService(new DatabaseService(source), orders);
    app = await createApplication({ ...config, database: { ...config.database, schema } });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  }, 30000);
  beforeEach(() => {
    vi.setSystemTime(new Date(FIXED_NOW));
  });
  afterAll(async () => {
    await app?.close();
    if (source?.isInitialized) await source.destroy();
    if (admin?.isInitialized) {
      if (!/^m5_execution_[a-f0-9]{32}$/.test(schema))
        throw new Error('Unsafe test schema cleanup.');
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
    vi.useRealTimers();
  });
  async function blockedCount(barrierPid: number): Promise<number> {
    const rows = (await source.query(
      'WITH RECURSIVE blocked AS (SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))) SELECT COUNT(*)::int AS count FROM blocked',
      [barrierPid],
    )) as { count: number }[];
    return rows[0]!.count;
  }
  async function observeWaiters(barrierPid: number, count: number): Promise<void> {
    const deadline = performance.now() + 1200;
    let observed = false;
    while (performance.now() < deadline) {
      if ((await blockedCount(barrierPid)) >= count) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(
      observed,
      'Independent execution requests must really wait behind the controlled PostgreSQL resource lock',
    ).toBe(true);
  }
  async function barrier(
    table: 'app_user' | 'delivery_order' | 'appointment' | 'crew' | 'crew_assignment',
    id: string,
  ): Promise<{ runner: QueryRunner; pid: number }> {
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction('READ COMMITTED');
    const rows = (await runner.query('SELECT pg_backend_pid() AS pid')) as { pid: number }[];
    await runner.query(`SELECT id FROM "${schema}"."${table}" WHERE id=$1 FOR UPDATE`, [id]);
    return { runner, pid: rows[0]!.pid };
  }
  async function overlap<T, U>(
    table: 'app_user' | 'delivery_order' | 'appointment' | 'crew' | 'crew_assignment',
    id: string,
    first: () => Promise<T>,
    second: () => Promise<U>,
  ) {
    const held = await barrier(table, id);
    const results = Promise.allSettled([first(), second()]);
    let observation: unknown;
    try {
      await observeWaiters(held.pid, 2);
    } catch (error) {
      observation = error;
    } finally {
      await held.runner.rollbackTransaction();
      await held.runner.release();
    }
    const completed = await results;
    if (observation) throw observation;
    return completed;
  }
  function responseValues(results: PromiseSettledResult<Response>[]) {
    return results.map((result) => {
      expect(result.status).toBe('fulfilled');
      if (result.status !== 'fulfilled')
        throw new Error('HTTP operation failed before receiving a response');
      return result.value;
    });
  }
  const detail = async (actor: ActorFixture, id: string) =>
    (await json<CrewAssignmentResponse>(await call(actor, crewPath(id)))).assignment;
  const action = (actor: ActorFixture, id: string, actionName: string, body: unknown) =>
    call(actor, crewPath(id, '/actions/' + actionName), 'POST', body);
  const command = (expectedExecutionVersion: number) => ({
    operationKey: randomUUID(),
    expectedExecutionVersion,
  });
  function expectSafe(value: unknown) {
    const text = JSON.stringify(value);
    expect(text).not.toMatch(
      /"(?:orderTotalCents|paidCents|balanceCents|paymentStatus|payments|internalNotes|activity|passwordHash|tokenHash|fingerprint|storagePath|diskPath)"/,
    );
    expect(text).not.toContain('BACKOFFICE PRIVATE FIXTURE');
    expect(text).not.toContain('BACKOFFICE APPOINTMENT PRIVATE FIXTURE');
  }
  async function depart(context: ContextFixture, index = 0) {
    const actor = context.actors[index]![0]!,
      id = context.assignments[index]!.id;
    const current = await detail(actor, id);
    return json<CrewAssignmentResponse>(
      await action(actor, id, 'depart', {
        ...command(current.execution.version),
        expectedAppointmentVersion: current.appointmentVersion,
      }),
    );
  }
  async function inProgress(context: ContextFixture, index = 0) {
    const actor = context.actors[index]![0]!,
      id = context.assignments[index]!.id;
    let current = (await depart(context, index)).assignment;
    current = (
      await json<CrewAssignmentResponse>(
        await action(actor, id, 'arrive', command(current.execution.version)),
      )
    ).assignment;
    return (
      await json<CrewAssignmentResponse>(
        await action(actor, id, 'start', command(current.execution.version)),
      )
    ).assignment;
  }
  async function completeTasks(actor: ActorFixture, id: string) {
    let current = await detail(actor, id);
    for (const task of current.tasks) {
      if (task.resultStatus === 'DONE' || task.resultStatus === 'SKIPPED') continue;
      current = (
        await json<CrewAssignmentResponse>(
          await call(actor, crewPath(id, '/tasks/' + task.id + '/result'), 'POST', {
            operationKey: randomUUID(),
            expectedTaskVersion: task.resultVersion,
            resultStatus: task.required ? 'DONE' : 'SKIPPED',
            ...(task.required ? {} : { reason: 'Optional work not required for this visit' }),
          }),
        )
      ).assignment;
    }
    return current;
  }

  it('projects only the current crew work and excludes financial/internal fields from reads, errors and backoffice routes', async () => {
    const own = await makeContext(),
      foreign = await makeContext(),
      actor = own.actors[0]![0]!,
      id = own.assignments[0]!.id;
    const response = await call(actor, '/crew/assignments?view=today&page=1&pageSize=20');
    const list = await json<CrewAssignmentListResponse>(response);
    expect(list.assignments.map((value) => value.id)).toEqual([id]);
    expect(list.total).toBe(1);
    expect(list.businessDate).toBe('2030-01-07');
    expect(list.timeZone).toBe('Europe/Rome');
    expectSafe(list);
    const ownDetail = await detail(actor, id);
    expect(ownDetail.order.crewNotes).toBe('Working crew instructions');
    expect(ownDetail.tasks.length).toBeGreaterThan(0);
    expectSafe(ownDetail);
    const denied = await call(actor, crewPath(foreign.assignments[0]!.id));
    expect(denied.status).toBe(404);
    expectSafe(await denied.json());
    expect((await call(undefined, crewPath(id))).status).toBe(401);
    for (const path of [
      '/orders',
      '/orders/' + own.order.id,
      '/orders/' + own.order.id + '/execution',
      '/dashboard',
      '/planning/calendar?from=2030-01-07&to=2030-01-08&allTeams=true',
      '/task-templates',
    ]) {
      const forbidden = await call(actor, path);
      expect(forbidden.status).toBe(403);
      expectSafe(await forbidden.json());
    }
    expect((await call(dispatcher, crewPath(id))).status).toBe(403);
    expect((await call(administrator, crewPath(id))).status).toBe(403);
    await inProgress(own);
    const foreignTask = (
      await source.getRepository(Task).findOneByOrFail({ assignmentId: foreign.assignments[0]!.id })
    ).id;
    expect(
      (
        await call(actor, crewPath(id, '/tasks/' + foreignTask + '/result'), 'POST', {
          operationKey: randomUUID(),
          expectedTaskVersion: 1,
          resultStatus: 'DONE',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          actor,
          crewPath(id, '/items/' + foreign.order.items[0]!.id + '/fulfillment'),
          'POST',
          {
            operationKey: randomUUID(),
            expectedFulfillmentVersion: 1,
            deliveredQuantity: 1,
            assembledQuantity: 0,
          },
        )
      ).status,
    ).toBe(404);
  });

  it('checks current membership, role and user activity before replaying any old receipt', async () => {
    const own = await makeContext(),
      other = await makeContext(),
      actor = own.actors[0]![0]!,
      id = own.assignments[0]!.id;
    const request = { ...command(1), expectedAppointmentVersion: own.appointmentVersion };
    await json<CrewAssignmentResponse>(await action(actor, id, 'depart', request));
    await source
      .getRepository(CrewMember)
      .update({ userId: actor.user.id, active: true }, { active: false });
    await source
      .getRepository(CrewMember)
      .save({ userId: actor.user.id, crewId: other.crews[0]!.id, active: true });
    expect((await call(actor, crewPath(id))).status).toBe(404);
    expect((await action(actor, id, 'depart', request)).status).toBe(404);
    expect((await detail(actor, other.assignments[0]!.id)).id).toBe(other.assignments[0]!.id);
    await source.getRepository(User).update(actor.user.id, { role: 'DISPATCHER' });
    expect((await call(actor, crewPath(other.assignments[0]!.id))).status).toBe(403);
    await source.getRepository(User).update(actor.user.id, { role: 'CREW_MEMBER', active: false });
    expect((await call(actor, crewPath(other.assignments[0]!.id))).status).toBe(401);
  });

  it('follows explicit transitions with server timestamps and immutable finish snapshots without silently fulfilling items', async () => {
    const context = await makeContext(),
      actor = context.actors[0]![0]!,
      id = context.assignments[0]!.id;
    expect((await action(actor, id, 'start', command(1))).status).toBe(409);
    expect(
      (
        await action(actor, id, 'depart', {
          ...command(1),
          expectedAppointmentVersion: context.appointmentVersion,
          departedAt: FIXED_NOW,
          actorId: actor.user.id,
        })
      ).status,
    ).toBe(400);
    let current = (await depart(context)).assignment;
    expect(current.execution.status).toBe('ON_THE_WAY');
    expect(current.execution.departedAt).toBe(FIXED_NOW);
    expect(current.execution.arrivedAt).toBeNull();
    expectSafe(current);
    vi.setSystemTime(new Date('2030-01-07T08:05:00Z'));
    current = (
      await json<CrewAssignmentResponse>(
        await action(actor, id, 'arrive', command(current.execution.version)),
      )
    ).assignment;
    expect(current.execution.arrivedAt).toBe('2030-01-07T08:05:00.000Z');
    vi.setSystemTime(new Date('2030-01-07T08:10:00Z'));
    current = (
      await json<CrewAssignmentResponse>(
        await action(actor, id, 'start', command(current.execution.version)),
      )
    ).assignment;
    expect(current.execution.actualStartAt).toBe('2030-01-07T08:10:00.000Z');
    expect(
      (
        await action(actor, id, 'finish', {
          ...command(current.execution.version),
          outcome: 'COMPLETED',
          summary: 'My team finished',
          returnVisitRequired: false,
        })
      ).status,
    ).toBe(409);
    current = await completeTasks(actor, id);
    vi.setSystemTime(new Date('2030-01-07T08:30:00Z'));
    const request = {
      ...command(current.execution.version),
      outcome: 'COMPLETED',
      summary: 'My team finished its planned checklist',
      returnVisitRequired: false,
    };
    const finished = await json<CrewAssignmentResponse>(await action(actor, id, 'finish', request));
    expect(finished.assignment.execution.status).toBe('COMPLETED');
    expect(finished.assignment.execution.actualEndAt).toBe('2030-01-07T08:30:00.000Z');
    expect(finished.assignment.finishReport?.authorId).toBe(actor.user.id);
    expect(finished.assignment.finishReport?.quantityScope).toBe('ACCUMULATED_ORDER');
    expect(
      finished.assignment.items.every(
        (item) => item.deliveredQuantity === 0 && item.assembledQuantity === 0,
      ),
    ).toBe(true);
    expectSafe(finished);
    const count = await history(context.order.id);
    vi.setSystemTime(new Date('2030-01-07T09:30:00Z'));
    const replay = await json<CrewAssignmentResponse>(await action(actor, id, 'finish', request));
    expect(replay.assignment.finishReport).toEqual(finished.assignment.finishReport);
    expect(replay.assignment.execution.version).toBe(finished.assignment.execution.version);
    expect(await history(context.order.id)).toBe(count);
    expectSafe(replay);
    expect(
      (await action(actor, id, 'finish', { ...request, summary: 'Changed old result' })).status,
    ).toBe(409);
    expect(
      (await action(actor, id, 'start', command(finished.assignment.execution.version))).status,
    ).toBe(409);
    expect((await orders.detail(context.order.id)).progress).not.toBe('COMPLETED');
  });

  it('rejects unconfirmed, cancelled, future and stale-plan departures while allowing an early departure on the same Rome date', async () => {
    const unconfirmed = await makeContext({ confirm: false }),
      actor = unconfirmed.actors[0]![0]!;
    expect(
      (
        await action(actor, unconfirmed.assignments[0]!.id, 'depart', {
          ...command(1),
          expectedAppointmentVersion: unconfirmed.appointmentVersion,
        })
      ).status,
    ).toBe(409);
    const future = await makeContext({ localStart: '2030-01-08T09:00' });
    expect(
      (
        await action(future.actors[0]![0]!, future.assignments[0]!.id, 'depart', {
          ...command(1),
          expectedAppointmentVersion: future.appointmentVersion,
        })
      ).status,
    ).toBe(409);
    const cancelled = await makeContext();
    await planning.cancel(
      cancelled.order.id,
      cancelled.appointmentId,
      cancelled.appointmentVersion,
      'Cancelled before departure',
      dispatcher.user.id,
    );
    expect(
      (await call(cancelled.actors[0]![0]!, crewPath(cancelled.assignments[0]!.id))).status,
    ).toBe(404);
    const stale = await makeContext();
    await planning.update(
      stale.order.id,
      stale.appointmentId,
      {
        expectedVersion: stale.appointmentVersion,
        localStart: '2030-01-07T13:00',
        reason: 'Time changed',
      },
      dispatcher.user.id,
    );
    expect(
      (
        await action(stale.actors[0]![0]!, stale.assignments[0]!.id, 'depart', {
          ...command(1),
          expectedAppointmentVersion: stale.appointmentVersion,
        })
      ).status,
    ).toBe(409);
    const early = await makeContext({ localStart: '2030-01-07T13:00' });
    expect((await depart(early)).assignment.execution.status).toBe('ON_THE_WAY');
  });

  it('allows a disabled crew to document started work, but never permits a new departure or a disabled user', async () => {
    const context = await makeContext(),
      actor = context.actors[0]![0]!,
      id = context.assignments[0]!.id;
    await source.getRepository(Crew).update(context.crews[0]!.id, { active: false });
    expect((await call(actor, crewPath(id))).status).toBe(200);
    expect(
      (
        await action(actor, id, 'depart', {
          ...command(1),
          expectedAppointmentVersion: context.appointmentVersion,
        })
      ).status,
    ).toBe(409);
    await source.getRepository(Crew).update(context.crews[0]!.id, { active: true });
    await depart(context);
    await source.getRepository(Crew).update(context.crews[0]!.id, { active: false });
    let current = (
      await json<CrewAssignmentResponse>(await action(actor, id, 'arrive', command(2)))
    ).assignment;
    current = (
      await json<CrewAssignmentResponse>(
        await action(actor, id, 'start', command(current.execution.version)),
      )
    ).assignment;
    expect(current.execution.status).toBe('IN_PROGRESS');
    await source.getRepository(User).update(actor.user.id, { active: false });
    expect((await call(actor, crewPath(id))).status).toBe(401);
    expect(
      (
        await action(actor, id, 'finish', {
          ...command(current.execution.version),
          outcome: 'BLOCKED',
          summary: 'Cannot continue',
          reason: 'Stopped',
          remainingWork: 'All work',
          returnVisitRequired: false,
        })
      ).status,
    ).toBe(401);
  });
  it('commits one effect for concurrent identical departures and rejects changed reuse of the operation key', async () => {
    const context = await makeContext(),
      actor = context.actors[0]![0]!,
      id = context.assignments[0]!.id,
      request = { ...command(1), expectedAppointmentVersion: context.appointmentVersion },
      before = await history(context.order.id);
    const responses = responseValues(
      await overlap(
        'delivery_order',
        context.order.id,
        () => action(actor, id, 'depart', request),
        () => action(actor, id, 'depart', request),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const values = await Promise.all(
      responses.map((response) => json<CrewAssignmentResponse>(response)),
    );
    expect(values[0]!.receipt?.id).toBeTruthy();
    expect(values[1]!.receipt?.id).toBe(values[0]!.receipt?.id);
    expect(values[1]!.assignment.execution.version).toBe(2);
    expect(await history(context.order.id)).toBe(before + 1);
    expectSafe(values);
    const timestamp = values[0]!.assignment.execution.departedAt;
    vi.setSystemTime(new Date('2030-01-07T08:45:00Z'));
    const replay = await json<CrewAssignmentResponse>(await action(actor, id, 'depart', request));
    expect(replay.assignment.execution.departedAt).toBe(timestamp);
    expect(await history(context.order.id)).toBe(before + 1);
    expect(
      (
        await action(actor, id, 'depart', {
          ...request,
          expectedAppointmentVersion: context.appointmentVersion + 1,
        })
      ).status,
    ).toBe(409);
  });

  it('serializes two employees on the same departure and prevents two active executions for a crew across different orders', async () => {
    const context = await makeContext(),
      id = context.assignments[0]!.id,
      first = context.actors[0]![0]!,
      second = context.actors[0]![1]!,
      before = await history(context.order.id);
    const competing = responseValues(
      await overlap(
        'delivery_order',
        context.order.id,
        () =>
          action(first, id, 'depart', {
            ...command(1),
            expectedAppointmentVersion: context.appointmentVersion,
          }),
        () =>
          action(second, id, 'depart', {
            ...command(1),
            expectedAppointmentVersion: context.appointmentVersion,
          }),
      ),
    );
    expect(competing.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await detail(first, id)).execution.version).toBe(2);
    expect(await history(context.order.id)).toBe(before + 1);
    const one = await makeContext(),
      two = await makeContext({
        existingCrews: one.crews,
        existingActors: one.actors,
        localStart: '2030-01-07T11:00',
      }),
      crew = one.crews[0]!;
    const active = responseValues(
      await overlap(
        'crew',
        crew.id,
        () =>
          action(one.actors[0]![0]!, one.assignments[0]!.id, 'depart', {
            ...command(1),
            expectedAppointmentVersion: one.appointmentVersion,
          }),
        () =>
          action(two.actors[0]![1]!, two.assignments[0]!.id, 'depart', {
            ...command(1),
            expectedAppointmentVersion: two.appointmentVersion,
          }),
      ),
    );
    expect(active.map((response) => response.status).sort()).toEqual([200, 409]);
    const count = (await source.query(
      `SELECT count(*)::int AS count FROM "${schema}".crew_assignment WHERE crew_id=$1 AND execution_status IN ('ON_THE_WAY','ARRIVED','IN_PROGRESS')`,
      [crew.id],
    )) as { count: number }[];
    expect(count[0]!.count).toBe(1);
  });

  it('serializes departure against move, cancellation and material order edits without rewriting a begun journey', async () => {
    for (const operation of ['move', 'cancel', 'order'] as const) {
      const context = await makeContext(),
        actor = context.actors[0]![0]!,
        id = context.assignments[0]!.id,
        original = await source
          .getRepository(Appointment)
          .findOneByOrFail({ id: context.appointmentId });
      const planner = () =>
        operation === 'move'
          ? call(
              dispatcher,
              `/orders/${context.order.id}/appointments/${context.appointmentId}`,
              'PATCH',
              {
                expectedVersion: context.appointmentVersion,
                localStart: '2030-01-07T13:00',
                reason: 'Customer move',
              },
            )
          : operation === 'cancel'
            ? call(
                dispatcher,
                `/orders/${context.order.id}/appointments/${context.appointmentId}/cancel`,
                'POST',
                { expectedVersion: context.appointmentVersion, reason: 'Customer cancelled' },
              )
            : call(dispatcher, '/orders/' + context.order.id, 'PATCH', {
                expectedVersion: context.order.version,
                address: 'Changed material address',
              });
      const results = responseValues(
        await overlap(
          'delivery_order',
          context.order.id,
          () =>
            action(actor, id, 'depart', {
              ...command(1),
              expectedAppointmentVersion: context.appointmentVersion,
            }),
          planner,
        ),
      );
      expect(
        results.filter((response) => response.status >= 200 && response.status < 300),
      ).toHaveLength(1);
      expect(results.some((response) => response.status === 409 || response.status === 404)).toBe(
        true,
      );
      const assignment = await source.getRepository(CrewAssignment).findOneByOrFail({ id }),
        appointment = await source
          .getRepository(Appointment)
          .findOneByOrFail({ id: context.appointmentId }),
        order = await source.getRepository(Order).findOneByOrFail({ id: context.order.id });
      if (assignment.executionStatus === 'ON_THE_WAY') {
        expect(appointment.status).toBe('SCHEDULED');
        expect(appointment.plannedStartAt).toEqual(original.plannedStartAt);
        expect(order.address).toBe(context.order.address);
      } else {
        expect(assignment.executionStatus).toBe('NOT_STARTED');
        expect(assignment.departedAt).toBeNull();
      }
    }
  });

  it('rechecks membership after waiting for User and never takes Crew before that shared authorization lock', async () => {
    const context = await makeContext(),
      other = await makeContext(),
      actor = context.actors[0]![0]!,
      id = context.assignments[0]!.id,
      before = await history(context.order.id),
      held = await barrier('app_user', actor.user.id);
    const pending = action(actor, id, 'depart', {
      ...command(1),
      expectedAppointmentVersion: context.appointmentVersion,
    });
    let observation: unknown;
    try {
      await observeWaiters(held.pid, 1);
      for (const crewId of [context.crews[0]!.id, other.crews[0]!.id].sort())
        await held.runner.query(`SELECT id FROM "${schema}".crew WHERE id=$1 FOR UPDATE`, [crewId]);
      await held.runner.manager
        .getRepository(CrewMember)
        .update({ userId: actor.user.id, active: true }, { active: false });
      await held.runner.manager
        .getRepository(CrewMember)
        .save({ userId: actor.user.id, crewId: other.crews[0]!.id, active: true });
      await held.runner.commitTransaction();
    } catch (error) {
      observation = error;
      if (held.runner.isTransactionActive) await held.runner.rollbackTransaction();
    } finally {
      await held.runner.release();
    }
    const denied = await pending;
    if (observation) throw observation;
    expect(denied.status).toBe(404);
    expectSafe(await denied.json());
    expect(
      (await source.getRepository(CrewAssignment).findOneByOrFail({ id })).executionStatus,
    ).toBe('NOT_STARTED');
    expect(await history(context.order.id)).toBe(before);
  });

  it('gives a concurrently committed user disable precedence over execution, including the audit FK lock path', async () => {
    const context = await makeContext(),
      actor = context.actors[0]![0]!,
      id = context.assignments[0]!.id,
      held = await barrier('app_user', actor.user.id),
      before = await history(context.order.id);
    const pending = action(actor, id, 'depart', {
      ...command(1),
      expectedAppointmentVersion: context.appointmentVersion,
    });
    let observation: unknown;
    try {
      await observeWaiters(held.pid, 1);
      await held.runner.query(`SELECT id FROM "${schema}".crew WHERE id=$1 FOR UPDATE`, [
        context.crews[0]!.id,
      ]);
      await held.runner.manager.getRepository(User).update(actor.user.id, { active: false });
      await held.runner.commitTransaction();
    } catch (error) {
      observation = error;
      if (held.runner.isTransactionActive) await held.runner.rollbackTransaction();
    } finally {
      await held.runner.release();
    }
    const denied = await pending;
    if (observation) throw observation;
    expect(denied.status).toBe(401);
    expect(await history(context.order.id)).toBe(before);
    expect(
      (await source.getRepository(CrewAssignment).findOneByOrFail({ id })).departedAt,
    ).toBeNull();
  });

  it('keeps reversible checklist results versioned and receipts cannot replay old DONE over a newer PENDING', async () => {
    const context = await makeContext(),
      actor = context.actors[0]![0]!,
      second = context.actors[0]![1]!,
      id = context.assignments[0]!.id;
    let current = await inProgress(context);
    const required = current.tasks.find((task) => task.required)!;
    expect(
      (
        await call(actor, crewPath(id, '/tasks/' + required.id + '/result'), 'POST', {
          operationKey: randomUUID(),
          expectedTaskVersion: required.resultVersion,
          resultStatus: 'SKIPPED',
          reason: 'Must not skip required',
        })
      ).status,
    ).toBe(400);
    const body = {
        operationKey: randomUUID(),
        expectedTaskVersion: required.resultVersion,
        resultStatus: 'DONE',
      },
      before = await history(context.order.id);
    let result = await json<CrewAssignmentResponse>(
      await call(actor, crewPath(id, '/tasks/' + required.id + '/result'), 'POST', body),
    );
    expect(result.assignment.tasks.find((task) => task.id === required.id)?.doneBy).toBe(
      actor.user.id,
    );
    const done = result.assignment.tasks.find((task) => task.id === required.id)!;
    expect(
      (
        await call(second, crewPath(id, '/tasks/' + required.id + '/result'), 'POST', {
          operationKey: randomUUID(),
          expectedTaskVersion: done.resultVersion,
          resultStatus: 'PENDING',
        })
      ).status,
    ).toBe(400);
    vi.setSystemTime(new Date('2030-01-07T08:01:00Z'));
    result = await json<CrewAssignmentResponse>(
      await call(second, crewPath(id, '/tasks/' + required.id + '/result'), 'POST', {
        operationKey: randomUUID(),
        expectedTaskVersion: done.resultVersion,
        resultStatus: 'PENDING',
        reason: 'Recheck with customer',
      }),
    );
    const reset = result.assignment.tasks.find((task) => task.id === required.id)!;
    expect(reset.resultStatus).toBe('PENDING');
    expect(reset.doneBy).toBeNull();
    expect(reset.resultVersion).toBe(done.resultVersion + 1);
    const replay = await json<CrewAssignmentResponse>(
      await call(actor, crewPath(id, '/tasks/' + required.id + '/result'), 'POST', body),
    );
    expect(replay.assignment.tasks.find((task) => task.id === required.id)).toEqual(reset);
    expect(replay.assignment.execution.version).toBe(result.assignment.execution.version);
    expect(await history(context.order.id)).toBe(before + 2);
    expectSafe(replay);
    const priceVersion = current.execution.version;
    const order = await orders.detail(context.order.id);
    await orders.recordPayment(
      order.id,
      OrderDto.payment({
        amountCents: 1000,
        paidOn: '2030-01-07',
        method: 'CASH',
        idempotencyKey: randomUUID(),
      }),
      dispatcher.user.id,
    );
    current = await detail(actor, id);
    expect(current.execution.version).toBe(result.assignment.execution.version);
    expect(current.execution.version).toBeGreaterThan(priceVersion);
    expect((await orders.detail(order.id)).paidCents).toBe(1000);
  });

  it('serializes employee task updates and a last required task update against finish', async () => {
    const context = await makeContext(),
      actor = context.actors[0]![0]!,
      other = context.actors[0]![1]!,
      id = context.assignments[0]!.id;
    let current = await inProgress(context);
    const target = current.tasks[0]!;
    const results = responseValues(
      await overlap(
        'delivery_order',
        context.order.id,
        () =>
          call(actor, crewPath(id, '/tasks/' + target.id + '/result'), 'POST', {
            operationKey: randomUUID(),
            expectedTaskVersion: target.resultVersion,
            resultStatus: 'DONE',
          }),
        () =>
          call(other, crewPath(id, '/tasks/' + target.id + '/result'), 'POST', {
            operationKey: randomUUID(),
            expectedTaskVersion: target.resultVersion,
            resultStatus: 'DONE',
          }),
      ),
    );
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    current = await detail(actor, id);
    expect(current.tasks.find((task) => task.id === target.id)?.resultVersion).toBe(
      target.resultVersion + 1,
    );
    for (const task of current.tasks.filter((task) => task.id !== target.id && task.required)) {
      current = (
        await json<CrewAssignmentResponse>(
          await call(actor, crewPath(id, '/tasks/' + task.id + '/result'), 'POST', {
            operationKey: randomUUID(),
            expectedTaskVersion: task.resultVersion,
            resultStatus: 'DONE',
          }),
        )
      ).assignment;
    }
    const targetDone = current.tasks.find((task) => task.id === target.id)!;
    current = (
      await json<CrewAssignmentResponse>(
        await call(actor, crewPath(id, '/tasks/' + target.id + '/result'), 'POST', {
          operationKey: randomUUID(),
          expectedTaskVersion: targetDone.resultVersion,
          resultStatus: 'PENDING',
          reason: 'Last required recheck',
        }),
      )
    ).assignment;
    const last = current.tasks.find((task) => task.id === target.id)!,
      finishBody = {
        ...command(current.execution.version),
        outcome: 'COMPLETED',
        summary: 'All my tasks are complete',
        returnVisitRequired: false,
      };
    const raced = responseValues(
      await overlap(
        'delivery_order',
        context.order.id,
        () =>
          call(actor, crewPath(id, '/tasks/' + last.id + '/result'), 'POST', {
            operationKey: randomUUID(),
            expectedTaskVersion: last.resultVersion,
            resultStatus: 'DONE',
          }),
        () => action(other, id, 'finish', finishBody),
      ),
    );
    expect(raced.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await detail(actor, id)).execution.status).toBe('IN_PROGRESS');
    current = await completeTasks(actor, id);
    expect(
      (
        await action(actor, id, 'finish', {
          ...finishBody,
          operationKey: randomUUID(),
          expectedExecutionVersion: current.execution.version,
        })
      ).status,
    ).toBe(200);
  });

  it('serializes absolute shared quantities from two teams, validates bounds and never reapplies an older receipt', async () => {
    const context = await makeContext({ crews: 2 }),
      actor = context.actors[0]![0]!,
      other = context.actors[1]![0]!,
      a = context.assignments[0]!.id,
      b = context.assignments[1]!.id;
    await inProgress(context, 0);
    await inProgress(context, 1);
    const item = (await detail(actor, a)).items.find((value) => value.requiresAssembly)!,
      one = {
        operationKey: randomUUID(),
        expectedFulfillmentVersion: item.fulfillmentVersion,
        deliveredQuantity: 1,
        assembledQuantity: 0,
      },
      two = {
        operationKey: randomUUID(),
        expectedFulfillmentVersion: item.fulfillmentVersion,
        deliveredQuantity: 2,
        assembledQuantity: 1,
      };
    const results = responseValues(
      await overlap(
        'delivery_order',
        context.order.id,
        () => call(actor, crewPath(a, '/items/' + item.id + '/fulfillment'), 'POST', one),
        () => call(other, crewPath(b, '/items/' + item.id + '/fulfillment'), 'POST', two),
      ),
    );
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    let current = (await detail(actor, a)).items.find((value) => value.id === item.id)!;
    expect([1, 2]).toContain(current.deliveredQuantity);
    expect(current.fulfillmentVersion).toBe(item.fulfillmentVersion + 1);
    const winning =
      results[0]!.status === 200 ? { actor, id: a, body: one } : { actor: other, id: b, body: two };
    const latest = await json<CrewAssignmentResponse>(
      await call(other, crewPath(b, '/items/' + item.id + '/fulfillment'), 'POST', {
        operationKey: randomUUID(),
        expectedFulfillmentVersion: current.fulfillmentVersion,
        deliveredQuantity: 3,
        assembledQuantity: 2,
      }),
    );
    current = latest.assignment.items.find((value) => value.id === item.id)!;
    const before = await history(context.order.id);
    const replay = await json<CrewAssignmentResponse>(
      await call(
        winning.actor,
        crewPath(winning.id, '/items/' + item.id + '/fulfillment'),
        'POST',
        winning.body,
      ),
    );
    expect(replay.assignment.items.find((value) => value.id === item.id)).toEqual(current);
    expect(await history(context.order.id)).toBe(before);
    expectSafe(replay);
    for (const values of [
      { deliveredQuantity: -1, assembledQuantity: 0 },
      { deliveredQuantity: 1.5, assembledQuantity: 0 },
      { deliveredQuantity: 4, assembledQuantity: 0 },
      { deliveredQuantity: 1, assembledQuantity: 2 },
    ])
      expect(
        (
          await call(actor, crewPath(a, '/items/' + item.id + '/fulfillment'), 'POST', {
            operationKey: randomUUID(),
            expectedFulfillmentVersion: current.fulfillmentVersion,
            ...values,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await call(actor, crewPath(a, '/items/' + item.id + '/fulfillment'), 'POST', {
          operationKey: randomUUID(),
          expectedFulfillmentVersion: current.fulfillmentVersion,
          deliveredQuantity: 1,
          assembledQuantity: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(actor, crewPath(a, '/items/' + item.id + '/fulfillment'), 'POST', {
          operationKey: randomUUID(),
          expectedFulfillmentVersion: current.fulfillmentVersion,
          deliveredQuantity: 1,
          assembledQuantity: 0,
          reason: 'Corrected counted quantity',
        })
      ).status,
    ).toBe(200);
    const delivery = (await detail(actor, a)).items.find((value) => !value.requiresAssembly)!;
    expect(
      (
        await call(actor, crewPath(a, '/items/' + delivery.id + '/fulfillment'), 'POST', {
          operationKey: randomUUID(),
          expectedFulfillmentVersion: delivery.fulfillmentVersion,
          deliveredQuantity: 1,
          assembledQuantity: 1,
        })
      ).status,
    ).toBe(400);
  });

  it('keeps optional skip reasons and target identity in durable receipt fingerprints', async () => {
    const context = await makeContext(),
      actor = context.actors[0]![0]!,
      id = context.assignments[0]!.id;
    let current = await inProgress(context);
    // M4 snapshots deliberately include an explicitly selected optional template.
    const required = current.tasks.filter((t) => t.required);
    expect(required.length).toBeGreaterThan(1);
    const body = {
      operationKey: randomUUID(),
      expectedTaskVersion: required[0]!.resultVersion,
      resultStatus: 'DONE',
    };
    expect(
      (await call(actor, crewPath(id, '/tasks/' + required[0]!.id + '/result'), 'POST', body))
        .status,
    ).toBe(200);
    expect(
      (
        await call(actor, crewPath(id, '/tasks/' + required[1]!.id + '/result'), 'POST', {
          ...body,
          expectedTaskVersion: required[1]!.resultVersion,
        })
      ).status,
    ).toBe(409);
    const optional = await source.getRepository(Task).save({
      assignmentId: id,
      templateId: null,
      name: 'Optional fixture check',
      description: 'Non-required fixture',
      required: false,
      severity: 'LOW',
      priority: 900,
      active: true,
      resultStatus: 'PENDING',
      resultVersion: 1,
      doneBy: null,
      doneAt: null,
      resultReason: null,
    });
    const skip = { operationKey: randomUUID(), expectedTaskVersion: 1, resultStatus: 'SKIPPED' };
    expect(
      (await call(actor, crewPath(id, '/tasks/' + optional.id + '/result'), 'POST', skip)).status,
    ).toBe(400);
    current = (
      await json<CrewAssignmentResponse>(
        await call(actor, crewPath(id, '/tasks/' + optional.id + '/result'), 'POST', {
          ...skip,
          reason: 'Optional inspection is unnecessary',
        }),
      )
    ).assignment;
    expect(current.tasks.find((t) => t.id === optional.id)).toMatchObject({
      resultStatus: 'SKIPPED',
      resultReason: 'Optional inspection is unnecessary',
      doneBy: actor.user.id,
    });
    const before = await history(context.order.id);
    expect(
      (
        await call(actor, crewPath(id, '/tasks/' + optional.id + '/result'), 'POST', {
          ...skip,
          reason: 'Optional inspection is unnecessary',
        })
      ).status,
    ).toBe(200);
    expect(await history(context.order.id)).toBe(before);
  });

  it('serializes competing finish commands into one immutable report and one history effect', async () => {
    const context = await makeContext(),
      actor = context.actors[0]![0]!,
      other = context.actors[0]![1]!,
      id = context.assignments[0]!.id;
    await inProgress(context);
    const current = await completeTasks(actor, id),
      before = await history(context.order.id);
    const body = {
      ...command(current.execution.version),
      outcome: 'COMPLETED',
      summary: 'Shared team finished',
      returnVisitRequired: false,
    };
    const results = responseValues(
      await overlap(
        'delivery_order',
        context.order.id,
        () => action(actor, id, 'finish', body),
        () => action(other, id, 'finish', { ...body, operationKey: randomUUID() }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const after = await detail(actor, id);
    expect(after.execution.status).toBe('COMPLETED');
    expect(await history(context.order.id)).toBe(before + 1);
    expect(
      await source.query(
        `SELECT count(*)::int AS n FROM "${schema}".finish_report WHERE assignment_id=$1`,
        [id],
      ),
    ).toEqual([{ n: 1 }]);
    expect(after.finishReport?.authorId).toBe(
      results[0]!.status === 200 ? actor.user.id : other.user.id,
    );
    expect(
      (
        await call(actor, crewPath(id, '/tasks/' + after.tasks[0]!.id + '/result'), 'POST', {
          operationKey: randomUUID(),
          expectedTaskVersion: after.tasks[0]!.resultVersion,
          resultStatus: 'PENDING',
          reason: 'Too late',
        })
      ).status,
    ).toBe(409);
  });

  it('records independent blocked/partial return requests without inventing work or a replacement appointment', async () => {
    const context = await makeContext({ crews: 2 }),
      a = context.actors[0]![0]!,
      b = context.actors[1]![0]!,
      aid = context.assignments[0]!.id,
      bid = context.assignments[1]!.id;
    let current = (await depart(context, 0)).assignment;
    const blocked = {
      ...command(current.execution.version),
      outcome: 'BLOCKED',
      summary: 'No access',
      reason: 'Locked entrance',
      remainingWork: 'Deliver all furniture',
      returnVisitRequired: true,
      returnReason: 'Arrange entrance access',
    };
    expect((await action(a, aid, 'finish', { ...blocked, reason: '' })).status).toBe(400);
    current = (await json<CrewAssignmentResponse>(await action(a, aid, 'finish', blocked)))
      .assignment;
    expect(current.execution).toMatchObject({
      status: 'BLOCKED',
      arrivedAt: null,
      actualStartAt: null,
    });
    expect(
      current.items.every((item) => item.deliveredQuantity === 0 && item.assembledQuantity === 0),
    ).toBe(true);
    expect((await orders.detail(context.order.id)).progress).toBe('REQUIRES_ATTENTION');
    const other = await inProgress(context, 1);
    const partial = {
      ...command(other.execution.version),
      outcome: 'PARTIALLY_COMPLETED',
      summary: 'Some preparation completed',
      reason: 'Missing materials',
      remainingWork: 'Deliver and assemble remaining furniture',
      returnVisitRequired: true,
      returnReason: 'Bring missing materials',
    };
    expect((await action(b, bid, 'finish', { ...partial, remainingWork: '' })).status).toBe(400);
    const finished = await json<CrewAssignmentResponse>(await action(b, bid, 'finish', partial));
    expectSafe(finished);
    const order = await orders.detail(context.order.id);
    expect(order.execution.returnRequests).toHaveLength(2);
    expect((await detail(a, aid)).returnRequests).toHaveLength(2);
    expect((await detail(a, aid)).returnVisitRequired).toBe(true);
    expect(new Set(order.execution.returnRequests.map((r) => r.assignmentId))).toEqual(
      new Set([aid, bid]),
    );
    expect(order.execution.returnRequests.map((r) => r.reason).sort()).toEqual([
      'Arrange entrance access',
      'Bring missing materials',
    ]);
    expect(order.returnVisitRequired).toBe(true);
    expect(order.workReadyForReview).toBe(false);
    expect(order.progress).toBe('PARTIALLY_COMPLETED');
    expect(order.appointments).toHaveLength(1);
    expect(order.execution.finishReports).toHaveLength(2);
    expect(
      (await source.getRepository(OrderItem).findBy({ orderId: order.id })).every(
        (i) => i.deliveredQuantity === 0,
      ),
    ).toBe(true);
  });

  it('preserves late next-day actual end while the later booking stays unchanged and cannot depart concurrently', async () => {
    const context = await makeContext(),
      later = await makeContext({
        existingCrews: context.crews,
        existingActors: context.actors,
        localStart: '2030-01-07T11:00',
      }),
      actor = context.actors[0]![0]!,
      id = context.assignments[0]!.id;
    await inProgress(context);
    vi.setSystemTime(new Date('2030-01-07T11:30:00.000Z'));
    expect((await detail(actor, id)).execution.maybeDelayed).toBe(true);
    const next = await detail(actor, later.assignments[0]!.id);
    expect(next.allowedActions).not.toContain('DEPART');
    expect(next.departureBlockedReason).toBeTruthy();
    expect(
      (
        await action(actor, next.id, 'depart', {
          ...command(next.execution.version),
          expectedAppointmentVersion: next.appointmentVersion,
        })
      ).status,
    ).toBe(409);
    const planned = await source
      .getRepository(Appointment)
      .findOneByOrFail({ id: later.appointmentId });
    vi.setSystemTime(new Date('2030-01-08T00:20:00.000Z'));
    const current = await completeTasks(actor, id);
    const finished = await json<CrewAssignmentResponse>(
      await action(actor, id, 'finish', {
        ...command(current.execution.version),
        outcome: 'COMPLETED',
        summary: 'Finished after midnight',
        returnVisitRequired: false,
      }),
    );
    expect(finished.assignment.execution.actualEndAt).toBe('2030-01-08T00:20:00.000Z');
    expect(finished.assignment.finishReport?.actualEndAt).toBe('2030-01-08T00:20:00.000Z');
    const unchanged = await source
      .getRepository(Appointment)
      .findOneByOrFail({ id: later.appointmentId });
    expect(unchanged).toEqual(planned);
    expect((await detail(actor, next.id)).execution.status).toBe('NOT_STARTED');
  });

  it('freezes M3 material conditions and M4 schedule/assignments/tasks after departure while contacts, notes and payments remain editable', async () => {
    const context = await makeContext(),
      actor = context.actors[0]![0]!,
      id = context.assignments[0]!.id;
    await depart(context);
    const before = await orders.detail(context.order.id),
      assignment = before.appointments[0]!.assignments[0]!;
    for (const change of [
      { address: 'Changed address' },
      {
        serviceType: 'DELIVERY_ONLY',
        items: before.items.map((i) => ({
          id: i.id,
          description: i.description,
          quantity: i.quantity,
          configuration: i.configuration,
          ambient: i.ambient,
          notes: i.notes,
          requiresAssembly: false,
          sortOrder: i.sortOrder,
        })),
      },
      { workDescription: 'Changed work' },
      { floor: '5' },
      {
        items: before.items.map((i) => ({
          id: i.id,
          description: i.description,
          quantity: i.quantity + 1,
          configuration: i.configuration,
          ambient: i.ambient,
          notes: i.notes,
          requiresAssembly: i.requiresAssembly,
          sortOrder: i.sortOrder,
        })),
      },
    ])
      expect(
        (
          await call(dispatcher, '/orders/' + before.id, 'PATCH', {
            expectedVersion: before.version,
            ...change,
          })
        ).status,
      ).toBe(409);
    for (const change of [
      { localStart: '2030-01-07T13:00', reason: 'Requested move' },
      { crewIds: [], reason: 'Remove team' },
      {
        tasks: [
          {
            assignmentId: assignment.id,
            tasks: assignment.tasks.map((t) => ({
              id: t.id,
              severity: t.severity,
              priority: t.priority + 1,
            })),
          },
        ],
      },
    ])
      expect(
        (
          await call(
            dispatcher,
            '/orders/' + before.id + '/appointments/' + context.appointmentId,
            'PATCH',
            { expectedVersion: context.appointmentVersion, ...change },
          )
        ).status,
      ).toBe(409);
    expect(
      (
        await call(
          dispatcher,
          '/orders/' + before.id + '/appointments/' + context.appointmentId + '/cancel',
          'POST',
          { expectedVersion: context.appointmentVersion, reason: 'Cannot cancel real work' },
        )
      ).status,
    ).toBe(409);
    const edited = await orders.update(
      before.id,
      {
        expectedVersion: before.version,
        customerName: 'Updated fictional contact',
        contactName: 'Updated site contact',
        phoneNumbers: ['+39 000 222'],
        email: 'new@example.invalid',
        internalNotes: 'Still private',
        crewNotes: 'New team instructions',
      },
      dispatcher.user.id,
    );
    expect(edited.customerName).toBe('Updated fictional contact');
    const payment = await orders.recordPayment(
      before.id,
      OrderDto.payment({
        amountCents: 1000,
        paidOn: '2030-01-07',
        method: 'CASH',
        idempotencyKey: randomUUID(),
      }),
      dispatcher.user.id,
    );
    const voided = await orders.voidPayment(
      before.id,
      payment.payment.id,
      'Fictional correction',
      dispatcher.user.id,
    );
    expect(voided.order.paidCents).toBe(0);
    const crew = await detail(actor, id);
    expect(crew.execution.status).toBe('ON_THE_WAY');
    expect(crew.execution.version).toBe(2);
    expect(crew.order.crewNotes).toBe('New team instructions');
    expectSafe(crew);
  });

  it('keeps finance totals independent and agrees across detail/list/calendar/dashboard for shared execution', async () => {
    const before = await orders.dashboard(),
      context = await makeContext({ crews: 2 }),
      a = context.actors[0]![0]!,
      b = context.actors[1]![0]!,
      aid = context.assignments[0]!.id,
      bid = context.assignments[1]!.id;
    await orders.recordPayment(
      context.order.id,
      OrderDto.payment({
        amountCents: 1000,
        paidOn: '2030-01-07',
        method: 'CASH',
        idempotencyKey: randomUUID(),
      }),
      dispatcher.user.id,
    );
    await orders.recordPayment(
      context.order.id,
      OrderDto.payment({
        amountCents: 2000,
        paidOn: '2030-01-07',
        method: 'CASH',
        idempotencyKey: randomUUID(),
      }),
      dispatcher.user.id,
    );
    await inProgress(context, 0);
    await inProgress(context, 1);
    let first = await completeTasks(a, aid);
    for (const item of first.items) {
      first = (
        await json<CrewAssignmentResponse>(
          await call(a, crewPath(aid, '/items/' + item.id + '/fulfillment'), 'POST', {
            operationKey: randomUUID(),
            expectedFulfillmentVersion: item.fulfillmentVersion,
            deliveredQuantity: item.quantity,
            assembledQuantity: 0,
          }),
        )
      ).assignment;
    }
    first = (
      await json<CrewAssignmentResponse>(
        await action(a, aid, 'finish', {
          ...command(first.execution.version),
          outcome: 'COMPLETED',
          summary: 'First team complete',
          returnVisitRequired: false,
        }),
      )
    ).assignment;
    expect(
      first.finishReport?.quantities.find(
        (q) => q.id === first.items.find((i) => i.requiresAssembly)!.id,
      )?.assembledQuantity,
    ).toBe(0);
    expect((await orders.detail(context.order.id)).progress).toBe('IN_PROGRESS');
    expect((await orders.detail(context.order.id)).workReadyForReview).toBe(false);
    let second = await completeTasks(b, bid);
    // Delivery alone must not satisfy an assembly order even with both checklists ready.
    second = (
      await json<CrewAssignmentResponse>(
        await action(b, bid, 'finish', {
          ...command(second.execution.version),
          outcome: 'COMPLETED',
          summary: 'Second team complete',
          returnVisitRequired: false,
        }),
      )
    ).assignment;
    expect(second.execution.status).toBe('COMPLETED');
    let detailOrder = await orders.detail(context.order.id);
    expect(detailOrder.progress).toBe('PARTIALLY_COMPLETED');
    expect(detailOrder.workReadyForReview).toBe(false);
    expect(detailOrder.appointments[0]!.status).toBe('SCHEDULED');
    const totals = await orders.dashboard();
    expect(totals.orderTotalCents - before.orderTotalCents).toBe(100000);
    expect(totals.paidCents - before.paidCents).toBe(3000);
    expect(totals.balanceCents - before.balanceCents).toBe(97000);
    const row = (
      await orders.list({ search: detailOrder.number, page: 1, pageSize: 20 })
    ).orders.find((o) => o.id === detailOrder.id)!;
    expect(row.progress).toBe(detailOrder.progress);
    expect(row.workReadyForReview).toBe(false);
    const calendar = await planning.calendar({
      from: '2030-01-07',
      to: '2030-01-08',
      allTeams: true,
      crewIds: [],
      includeUnassigned: true,
    });
    expect(calendar.appointments.filter((v) => v.id === context.appointmentId)).toHaveLength(1);
    const calendarVisit = calendar.appointments.find((v) => v.id === context.appointmentId)!;
    expect(calendarVisit.assignments.map((v) => v.execution.status)).toEqual([
      'COMPLETED',
      'COMPLETED',
    ]);
    expect(
      calendarVisit.assignments.every((v) =>
        v.tasks
          .filter((t) => t.active)
          .every((t) => t.resultStatus === 'DONE' || t.resultStatus === 'SKIPPED'),
      ),
    ).toBe(true);
    const report = first.finishReport;
    expect((await detail(a, aid)).finishReport).toEqual(report);
    // A new follow-up with full physical results still cannot erase an unassigned future visit.
    let follow = await planning.create(
      detailOrder.id,
      {
        localStart: '2030-01-08T09:00',
        durationMinutes: 60,
        crewIds: [context.crews[0]!.id],
        idempotencyKey: randomUUID(),
      },
      dispatcher.user.id,
    );
    follow = await planning.confirm(
      detailOrder.id,
      follow.appointment.id,
      follow.appointment.version,
      dispatcher.user.id,
    );
    await planning.create(
      detailOrder.id,
      {
        localStart: '2030-01-09T09:00',
        durationMinutes: 60,
        crewIds: [],
        idempotencyKey: randomUUID(),
      },
      dispatcher.user.id,
    );
    vi.setSystemTime(new Date('2030-01-08T08:00:00.000Z'));
    const followAssignment = follow.appointment.assignments[0]!.id;
    let next = (
      await json<CrewAssignmentResponse>(
        await action(a, followAssignment, 'depart', {
          ...command(1),
          expectedAppointmentVersion: follow.appointment.version,
        }),
      )
    ).assignment;
    next = (
      await json<CrewAssignmentResponse>(
        await action(a, followAssignment, 'arrive', command(next.execution.version)),
      )
    ).assignment;
    next = (
      await json<CrewAssignmentResponse>(
        await action(a, followAssignment, 'start', command(next.execution.version)),
      )
    ).assignment;
    for (const item of next.items.filter((i) => i.requiresAssembly))
      next = (
        await json<CrewAssignmentResponse>(
          await call(a, crewPath(followAssignment, '/items/' + item.id + '/fulfillment'), 'POST', {
            operationKey: randomUUID(),
            expectedFulfillmentVersion: item.fulfillmentVersion,
            deliveredQuantity: item.quantity,
            assembledQuantity: item.quantity,
          }),
        )
      ).assignment;
    expect(
      next.items.filter((i) => i.requiresAssembly).every((i) => i.assembledQuantity === i.quantity),
    ).toBe(true);
    next = await completeTasks(a, followAssignment);
    expect(
      (
        await action(a, followAssignment, 'finish', {
          ...command(next.execution.version),
          outcome: 'COMPLETED',
          summary: 'Assembly follow-up complete',
          returnVisitRequired: false,
        })
      ).status,
    ).toBe(200);
    detailOrder = await orders.detail(context.order.id);
    expect(detailOrder.workReadyForReview).toBe(false);
    expect(detailOrder.progress).toBe('PARTIALLY_COMPLETED');
    expect(detailOrder.progress).not.toBe('COMPLETED');
    expect((await detail(a, aid)).finishReport).toEqual(report);
  });

  it('uses Rome date for views and stable real pagination while yesterday active work stays open', async () => {
    const first = await makeContext(),
      actor = first.actors[0]![0]!,
      id = first.assignments[0]!.id;
    await depart(first);
    const today = await makeContext({
      existingCrews: first.crews,
      existingActors: first.actors,
      localStart: '2030-01-08T11:00',
    });
    const future = await makeContext({
      existingCrews: first.crews,
      existingActors: first.actors,
      localStart: '2030-01-09T09:00',
    });
    vi.setSystemTime(new Date('2030-01-07T23:20:00.000Z')); // Jan8 Rome, Jan7 UTC, Jan8 Tokyo.
    const response = await json<CrewAssignmentListResponse>(
      await call(actor, '/crew/assignments?view=today&pageSize=1&page=1'),
    );
    expect(response.businessDate).toBe('2030-01-08');
    expect(response.total).toBe(1);
    expect(response.assignments.map((a) => a.id)).toEqual([today.assignments[0]!.id]);
    const open = await json<CrewAssignmentListResponse>(
      await call(actor, '/crew/assignments?view=open&pageSize=1&page=1'),
    );
    expect(open.assignments.map((a) => a.id)).toEqual([id]);
    const upcoming = await json<CrewAssignmentListResponse>(
      await call(actor, '/crew/assignments?view=upcoming&pageSize=1&page=1'),
    );
    expect(upcoming.assignments.some((a) => a.id === future.assignments[0]!.id)).toBe(true);
    const again = await json<CrewAssignmentListResponse>(
      await call(actor, '/crew/assignments?view=upcoming&pageSize=1&page=1'),
    );
    expect(again).toEqual(upcoming);
    expect((await call(actor, '/crew/assignments?view=today&timeZone=Asia%2FTokyo')).status).toBe(
      400,
    );
  });

  it('rolls back state and durable receipts when audit insertion fails, then retries once safely', async () => {
    const context = await makeContext(),
      actor = context.actors[0]![0]!,
      id = context.assignments[0]!.id;
    const current = await detail(actor, id),
      body = {
        ...command(current.execution.version),
        expectedAppointmentVersion: current.appointmentVersion,
      };
    await source.query(
      `CREATE FUNCTION "${schema}".reject_execution_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id='${context.order.id}'::uuid AND NEW.action LIKE 'EXECUTION_%' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END $$`,
    );
    await source.query(
      `CREATE TRIGGER execution_audit_failure BEFORE INSERT ON "${schema}".activity_log FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_execution_audit()`,
    );
    const before = await history(context.order.id);
    try {
      expect((await action(actor, id, 'depart', body)).status).toBe(500);
      expect((await detail(actor, id)).execution).toEqual(current.execution);
      expect(
        await source.query(
          `SELECT count(*)::int AS n FROM "${schema}".execution_receipt WHERE assignment_id=$1`,
          [id],
        ),
      ).toEqual([{ n: 0 }]);
      expect(await history(context.order.id)).toBe(before);
    } finally {
      await source.query(`DROP TRIGGER execution_audit_failure ON "${schema}".activity_log`);
      await source.query(`DROP FUNCTION "${schema}".reject_execution_audit()`);
    }
    expect((await action(actor, id, 'depart', body)).status).toBe(200);
    expect((await action(actor, id, 'depart', body)).status).toBe(200);
    expect(await history(context.order.id)).toBe(before + 1);
  });

  it('enforces Origin/CSRF and logout before every core mutation, including a known successful receipt', async () => {
    const context = await makeContext(),
      actor = context.actors[0]![0]!,
      id = context.assignments[0]!.id;
    let current = await detail(actor, id);
    const departBody = {
      ...command(current.execution.version),
      expectedAppointmentVersion: current.appointmentVersion,
    };
    const operations: [string, unknown][] = [
      ['/actions/depart', departBody],
      ['/actions/arrive', command(1)],
      ['/actions/start', command(1)],
      [
        '/actions/finish',
        {
          ...command(1),
          outcome: 'BLOCKED',
          summary: 'Fixture',
          reason: 'Blocked',
          remainingWork: 'Everything',
          returnVisitRequired: false,
        },
      ],
      [
        '/tasks/' + current.tasks[0]!.id + '/result',
        { operationKey: randomUUID(), expectedTaskVersion: 1, resultStatus: 'DONE' },
      ],
      [
        '/items/' + current.items[0]!.id + '/fulfillment',
        {
          operationKey: randomUUID(),
          expectedFulfillmentVersion: 1,
          deliveredQuantity: 1,
          assembledQuantity: 0,
        },
      ],
    ];
    for (const [path, body] of operations) {
      expect(
        (await call(actor, crewPath(id, path), 'POST', body, { 'X-CSRF-Protection': '' })).status,
      ).toBe(403);
      expect(
        (
          await call(actor, crewPath(id, path), 'POST', body, {
            Origin: 'https://untrusted.example.invalid',
          })
        ).status,
      ).toBe(403);
    }
    current = (await json<CrewAssignmentResponse>(await action(actor, id, 'depart', departBody)))
      .assignment;
    expect((await call(actor, '/auth/logout', 'POST')).status).toBe(200);
    expect((await action(actor, id, 'depart', departBody)).status).toBe(401);
    expect(
      (await source.getRepository(CrewAssignment).findOneByOrFail({ id })).executionVersion,
    ).toBe(current.execution.version);
  });

  it('reaches AWAITING_REVIEW only for persisted full scope and all teams, independently of unpaid money', async () => {
    const context = await makeContext({ crews: 2 }),
      a = context.actors[0]![0]!,
      b = context.actors[1]![0]!,
      aid = context.assignments[0]!.id,
      bid = context.assignments[1]!.id;
    await inProgress(context, 0);
    await inProgress(context, 1);
    let first = await completeTasks(a, aid);
    for (const item of first.items) {
      first = (
        await json<CrewAssignmentResponse>(
          await call(a, crewPath(aid, '/items/' + item.id + '/fulfillment'), 'POST', {
            operationKey: randomUUID(),
            expectedFulfillmentVersion: item.fulfillmentVersion,
            deliveredQuantity: item.quantity,
            assembledQuantity: item.requiresAssembly ? item.quantity : 0,
          }),
        )
      ).assignment;
    }
    expect(
      (
        await action(a, aid, 'finish', {
          ...command(first.execution.version),
          outcome: 'COMPLETED',
          summary: 'A complete',
          returnVisitRequired: false,
        })
      ).status,
    ).toBe(200);
    expect((await orders.detail(context.order.id)).workReadyForReview).toBe(false);
    const second = await completeTasks(b, bid);
    expect(
      (
        await action(b, bid, 'finish', {
          ...command(second.execution.version),
          outcome: 'COMPLETED',
          summary: 'B complete',
          returnVisitRequired: false,
        })
      ).status,
    ).toBe(200);
    const order = await orders.detail(context.order.id);
    expect(order).toMatchObject({
      progress: 'AWAITING_REVIEW',
      workReadyForReview: true,
      paidCents: 0,
      paymentStatus: 'UNPAID',
      returnVisitRequired: false,
    });
    expect(order.execution).toMatchObject({
      activeAssignmentCount: 0,
      completedAssignmentCount: 2,
      workReadyForReview: true,
    });
    const list = await orders.list({
      search: order.number,
      progress: 'AWAITING_REVIEW',
      page: 1,
      pageSize: 20,
    });
    expect(list.orders.find((v) => v.id === order.id)).toMatchObject({
      progress: 'AWAITING_REVIEW',
      workReadyForReview: true,
      paidCents: 0,
    });
    expect((await orders.dashboard()).awaitingReviewCount).toBeGreaterThan(0);
    const read = await json<{ execution: unknown }>(
      await call(dispatcher, '/orders/' + order.id + '/execution'),
    );
    expect(read.execution).toEqual(order.execution);
    expectSafe(await detail(a, aid));
    expect(
      (
        await json<CrewAssignmentListResponse>(await call(a, '/crew/assignments?view=completed'))
      ).assignments.map((v) => v.id),
    ).toContain(aid);
  });

  it('rejects assembly on DELIVERY_ONLY even when reported delivery is otherwise within bounds', async () => {
    const input = orderInput();
    input.serviceType = 'DELIVERY_ONLY';
    input.items = input.items.map((item) => ({ ...item, requiresAssembly: false }));
    const context = await makeContext({ input }),
      actor = context.actors[0]![0]!,
      id = context.assignments[0]!.id,
      current = await inProgress(context),
      item = current.items[0]!;
    const body = {
      operationKey: randomUUID(),
      expectedFulfillmentVersion: item.fulfillmentVersion,
      deliveredQuantity: 1,
      assembledQuantity: 1,
    };
    expect(
      (await call(actor, crewPath(id, '/items/' + item.id + '/fulfillment'), 'POST', body)).status,
    ).toBe(400);
    expect((await detail(actor, id)).items.find((v) => v.id === item.id)).toMatchObject({
      deliveredQuantity: 0,
      assembledQuantity: 0,
      fulfillmentVersion: item.fulfillmentVersion,
    });
  });
});
