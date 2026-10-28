import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  CrewAssignmentResponse,
  CreateOrderRequest,
  OrderDetail,
  UserRole,
} from '@furniture-delivery/contracts';

import { expect } from 'vitest';
import { createApplication } from '../src/application';
import { hashPassword } from '../src/auth/password';
import { hashSessionToken } from '../src/auth/auth.service';
import { readIntegrationConfig, type AppConfig } from '../src/config/environment';
import { createDataSource } from '../src/database/data-source';
import { DatabaseService } from '../src/database/database.service';
import { seedPlanningDefaults } from '../src/database/demo-planning';
import { Crew } from '../src/crews/crew.entity';
import { User } from '../src/identity/user.entity';
import { CrewMember } from '../src/identity/crew-member.entity';
import { AuthSession } from '../src/identity/auth-session.entity';
import { OrderDto } from '../src/orders/orders.dto';
import { OrdersService } from '../src/orders/orders.service';
import { CrewPlanningConfig } from '../src/planning/crew-planning-config.entity';
import { PlanningService } from '../src/planning/planning.service';
import { ActivityLog } from '../src/orders/activity-log.entity';

export interface EvidenceActor {
  user: User;
  cookie: string;
}
export interface EvidenceContext {
  order: OrderDetail;
  appointmentId: string;
  appointmentVersion: number;
  crews: Crew[];
  assignmentIds: string[];
  actors: EvidenceActor[][];
}
export const evidenceOrderInput = (): CreateOrderRequest =>
  OrderDto.create({
    customerName: 'Fictional Evidence Customer',
    phoneNumbers: ['+39 000'],
    address: 'Fictional evidence address',
    city: 'Roma',
    country: 'Italy',
    serviceType: 'DELIVERY_AND_ASSEMBLY',
    workDescription: 'Fictional assembly work',
    estimatedDurationMinutes: 60,
    orderTotalCents: 100000,
    internalNotes: 'PRIVATE FINANCIAL EVIDENCE FIXTURE',
    crewNotes: 'Permitted team instructions',
    items: [
      { description: 'Fixture table', quantity: 3, requiresAssembly: true, sortOrder: 0 },
      { description: 'Fixture chairs', quantity: 4, requiresAssembly: false, sortOrder: 1 },
    ],
  });
export const freshOperation = () => randomUUID();
export const safeEvidence = (value: unknown) => {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(
    /"(?:orderTotalCents|paidCents|balanceCents|paymentStatus|payments|internalNotes|passwordHash|tokenHash|fingerprint|storageKey|sourceHash|diskPath|storagePath)"/,
  );
  expect(text).not.toContain('PRIVATE FINANCIAL EVIDENCE FIXTURE');
  expect(text).not.toContain('PRIVATE APPOINTMENT EVIDENCE FIXTURE');
};
export async function evidenceJson<T>(response: Response, status = 200): Promise<T> {
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

/** Every owner gets a unique test schema and a separate temporary, non-public storage directory. */
export async function createEvidenceFixture(
  prefix:
    | 'm5_notes'
    | 'm5_cross'
    | 'm6_schedule'
    | 'm6_return'
    | 'm7_accept'
    | 'm7_complete'
    | 'm8_realtime'
    | 'm8_workflow',
  configure: (config: AppConfig, storageRoot: string) => AppConfig,
  options: { listenPort?: number } = {},
) {
  const schema = prefix + '_' + randomUUID().replaceAll('-', ''),
    storageRoot = await realpath(await mkdtemp(join(tmpdir(), prefix + '_')));
  const config = configure(readIntegrationConfig(), storageRoot),
    admin = createDataSource(config);
  await admin.initialize();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const source = createDataSource(config, { schema });
  await source.initialize();
  await source.runMigrations();
  await seedPlanningDefaults(source, 'test');
  const passwordHash = await hashPassword(randomBytes(24).toString('base64url'));
  const makeActor = async (role: UserRole, crewId?: string): Promise<EvidenceActor> => {
    const user = await source.getRepository(User).save({
      username: 'evidence.' + randomUUID().replaceAll('-', '').slice(0, 18),
      displayName: 'Fictional ' + role,
      role,
      active: true,
      passwordHash,
    });
    if (crewId)
      await source.getRepository(CrewMember).save({ userId: user.id, crewId, active: true });
    const token = randomBytes(32).toString('base64url');
    await source.getRepository(AuthSession).save({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 14 * 86400000),
      revokedAt: null,
    });
    return { user, cookie: 'fd_session=' + token };
  };
  const dispatcher = await makeActor('DISPATCHER'),
    administrator = await makeActor('ADMIN');
  const database = new DatabaseService(source),
    orders = new OrdersService(database),
    planning = new PlanningService(database, orders);
  const app = await createApplication({ ...config, database: { ...config.database, schema } });
  try {
    const port = options.listenPort ?? 0;
    if (!Number.isInteger(port) || port < 0 || port > 65535 || (port > 0 && port <= 1024))
      throw new Error('Use an unprivileged isolated fixture port.');
    await app.listen(port, '127.0.0.1');
  } catch (error) {
    // A proxy fixture that loses its reserved port must not leak its own DB/storage.
    await app.close();
    await source.destroy();
    if (
      !/^(?:m5_(?:notes|cross)|m6_(?:schedule|return)|m7_(?:accept|complete)|m8_(?:realtime|workflow))_[a-f0-9]{32}$/.test(
        schema,
      )
    )
      throw new Error('Unsafe failed fixture schema cleanup.', { cause: error });
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.destroy();
    if (!storageRoot.startsWith(join(await realpath(tmpdir()), prefix + '_')))
      throw new Error('Unsafe failed fixture storage cleanup.', { cause: error });
    await rm(storageRoot, { recursive: true, force: true });
    throw error;
  }
  const base = await app.getUrl();
  const call = (
    actor: EvidenceActor | undefined,
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + '/api' + path, {
      method,
      signal: AbortSignal.timeout(8000),
      headers: {
        Origin: 'http://127.0.0.1:3000',
        'X-CSRF-Protection': '1',
        ...(actor ? { Cookie: actor.cookie } : {}),
        ...(body === undefined || body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
  const makeCrew = async () => {
    const crew = await source.getRepository(Crew).save({
      code: 'EVD-' + randomUUID().slice(0, 8).toUpperCase(),
      name: 'Fictional evidence team',
      active: true,
      workEnvironment: 'INDOOR',
      serviceArea: 'Fixture',
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
  };
  const context = async (
    options: {
      crews?: number;
      existingCrews?: Crew[];
      existingActors?: EvidenceActor[][];
      localStart?: string;
    } = {},
  ): Promise<EvidenceContext> => {
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
    const order = await orders.create(evidenceOrderInput(), dispatcher.user.id);
    let appointment = await planning.create(
      order.id,
      {
        localStart: options.localStart ?? '2030-01-07T09:00',
        durationMinutes: 60,
        crewIds: crews.map((c) => c.id),
        idempotencyKey: freshOperation(),
        notes: 'PRIVATE APPOINTMENT EVIDENCE FIXTURE',
      },
      dispatcher.user.id,
    );
    appointment = await planning.confirm(
      order.id,
      appointment.appointment.id,
      appointment.appointment.version,
      dispatcher.user.id,
    );
    return {
      order: appointment.order,
      appointmentId: appointment.appointment.id,
      appointmentVersion: appointment.appointment.version,
      crews,
      actors,
      assignmentIds: crews.map(
        (c) => appointment.appointment.assignments.find((a) => a.crewId === c.id)!.id,
      ),
    };
  };
  const path = (id: string, suffix = '') => '/crew/assignments/' + id + suffix;
  const detail = async (actor: EvidenceActor, id: string) =>
    (await evidenceJson<CrewAssignmentResponse>(await call(actor, path(id)))).assignment;
  const action = (actor: EvidenceActor, id: string, name: string, body: unknown) =>
    call(actor, path(id, '/actions/' + name), 'POST', body);
  const depart = async (ctx: EvidenceContext, index = 0) => {
    const actor = ctx.actors[index]![0]!,
      id = ctx.assignmentIds[index]!,
      current = await detail(actor, id);
    return (
      await evidenceJson<CrewAssignmentResponse>(
        await action(actor, id, 'depart', {
          operationKey: freshOperation(),
          expectedExecutionVersion: current.execution.version,
          expectedAppointmentVersion: current.appointmentVersion,
        }),
      )
    ).assignment;
  };
  const start = async (ctx: EvidenceContext, index = 0) => {
    const actor = ctx.actors[index]![0]!,
      id = ctx.assignmentIds[index]!;
    let current = await depart(ctx, index);
    for (const next of ['arrive', 'start'])
      current = (
        await evidenceJson<CrewAssignmentResponse>(
          await action(actor, id, next, {
            operationKey: freshOperation(),
            expectedExecutionVersion: current.execution.version,
          }),
        )
      ).assignment;
    return current;
  };
  const barrier = async (table: 'app_user' | 'delivery_order' | 'crew', id: string) => {
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction('READ COMMITTED');
    const rows = (await runner.query('SELECT pg_backend_pid() AS pid')) as { pid: number }[];
    await runner.query(`SELECT id FROM "${schema}"."${table}" WHERE id=$1 FOR UPDATE`, [id]);
    return { runner, pid: rows[0]!.pid };
  };
  const waiters = async (pid: number, count: number) => {
    const deadline = performance.now() + 1200;
    let found = false;
    while (performance.now() < deadline) {
      const rows = (await source.query(
        'WITH RECURSIVE blocked AS (SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))) SELECT COUNT(*)::int AS count FROM blocked',
        [pid],
      )) as { count: number }[];
      if (rows[0]!.count >= count) {
        found = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(
      found,
      'The controlled PostgreSQL barrier must observe independent blocked operations',
    ).toBe(true);
  };
  const overlap = async (
    table: 'app_user' | 'delivery_order' | 'crew',
    id: string,
    first: () => Promise<Response>,
    second: () => Promise<Response>,
  ) => {
    const held = await barrier(table, id),
      results = Promise.allSettled([first(), second()]);
    let observed: unknown;
    try {
      await waiters(held.pid, 2);
    } catch (error) {
      observed = error;
    } finally {
      await held.runner.rollbackTransaction();
      await held.runner.release();
    }
    const ready = await results;
    if (observed) throw observed;
    return ready.map((r) => {
      if (r.status !== 'fulfilled') throw r.reason;
      return r.value;
    });
  };
  const close = async () => {
    await app.close();
    await source.destroy();
    if (
      !/^(?:m5_(?:notes|cross)|m6_(?:schedule|return)|m7_(?:accept|complete)|m8_(?:realtime|workflow))_[a-f0-9]{32}$/.test(
        schema,
      )
    )
      throw new Error('Unsafe test schema cleanup');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.destroy();
    if (!storageRoot.startsWith(join(await realpath(tmpdir()), prefix + '_')))
      throw new Error('Unsafe temporary storage cleanup');
    await rm(storageRoot, { recursive: true, force: true });
  };
  const history = (orderId: string) => source.getRepository(ActivityLog).countBy({ orderId });
  return {
    schema,
    storageRoot,
    config,
    source,
    app,
    base,
    dispatcher,
    administrator,
    orders,
    planning,
    makeActor,
    makeCrew,
    context,
    path,
    call,
    detail,
    action,
    depart,
    start,
    barrier,
    waiters,
    overlap,
    history,
    close,
  };
}
export type EvidenceFixture = Awaited<ReturnType<typeof createEvidenceFixture>>;
