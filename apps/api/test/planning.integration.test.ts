import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type {
  AppointmentDetail,
  AppointmentListResponse,
  AppointmentResponse,
  CalendarResponse,
  CreateAppointmentRequest,
  CreateOrderRequest,
  CrewAvailabilityResponse,
  TaskTemplateListResponse,
  TaskTemplateResponse,
  UpdateAppointmentRequest,
  WeeklyWorkingWindow,
  UserRole,
} from '@furniture-delivery/contracts';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../src/application';
import { hashSessionToken } from '../src/auth/auth.service';
import { hashPassword } from '../src/auth/password';
import { readIntegrationConfig } from '../src/config/environment';
import { createDataSource } from '../src/database/data-source';
import { DatabaseService } from '../src/database/database.service';
import { seedPlanningDefaults } from '../src/database/demo-planning';
import { Appointment } from '../src/planning/appointment.entity';
import { CrewAssignment } from '../src/planning/crew-assignment.entity';
import { Task } from '../src/planning/task.entity';
import { TaskTemplate } from '../src/planning/task-template.entity';
import { CrewPlanningConfig } from '../src/planning/crew-planning-config.entity';
import { Crew } from '../src/crews/crew.entity';
import { AuthSession } from '../src/identity/auth-session.entity';
import { User } from '../src/identity/user.entity';
import { ActivityLog } from '../src/orders/activity-log.entity';
import { Order } from '../src/orders/order.entity';
import { OrderDto } from '../src/orders/orders.dto';
import { OrdersService } from '../src/orders/orders.service';

const orderInput = (total = 100000): CreateOrderRequest =>
  OrderDto.create({
    customerName: 'Fictional Planning Customer',
    phoneNumbers: ['+39 000 111'],
    address: 'Fictional planning road 12',
    city: 'Rome',
    country: 'Italy',
    serviceType: 'DELIVERY_AND_ASSEMBLY',
    workDescription: 'Delivery and assembly fixture',
    estimatedDurationMinutes: 60,
    orderTotalCents: total,
    items: [
      { description: 'Table', quantity: 1, requiresAssembly: true, sortOrder: 0 },
      { description: 'Chairs', quantity: 4, requiresAssembly: false, sortOrder: 1 },
    ],
  });

// Fixed ordinary Monday. Business-boundary/DST expectations are separately explicit.
const date = (day: number, time = '09:00') => {
  const value = new Date(Date.UTC(2030, 0, 7 + day));
  return `${value.toISOString().slice(0, 10)}T${time}`;
};

describe('M4 planning on isolated Compose PostgreSQL', () => {
  const schema = `m4_planning_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource | undefined,
    source: DataSource,
    orders: OrdersService,
    app: INestApplication | undefined,
    base: string;
  let dispatcher: User, employee: User, administrator: User;
  let dispatcherCookie: string, employeeCookie: string, adminCookie: string;
  const origin = 'http://127.0.0.1:3000';
  const call = (
    path: string,
    method = 'GET',
    body?: unknown,
    cookie = dispatcherCookie,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + '/api' + path, {
      method,
      signal: AbortSignal.timeout(8000),
      headers: {
        Origin: origin,
        'X-CSRF-Protection': '1',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const json = async <T>(response: Response, status = 200): Promise<T> => {
    expect(response.status).toBe(status);
    return (await response.json()) as T;
  };
  const createOrder = (total = 100000) => orders.create(orderInput(total), dispatcher.id);
  const history = (id: string) => source.getRepository(ActivityLog).countBy({ orderId: id });
  const makeCrew = async () => {
    const crew = await source.getRepository(Crew).save({
      code: 'M4-' + randomUUID().slice(0, 8).toUpperCase(),
      name: 'Fictional Planning Team',
      active: true,
      workEnvironment: 'INDOOR',
      serviceArea: 'Fixture area',
    });
    await source.getRepository(CrewPlanningConfig).save({
      crewId: crew.id,
      weeklyWindows: [1, 2, 3, 4, 5].map((weekday) => ({
        weekday,
        startTime: '08:00',
        endTime: '18:00',
      })),
      travelBufferMinutes: 30,
      version: 1,
      updatedBy: null,
    });
    return crew;
  };
  beforeAll(async () => {
    const config = readIntegrationConfig();
    admin = createDataSource(config);
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    source = createDataSource(config, { schema });
    await source.initialize();
    await source.runMigrations();
    await seedPlanningDefaults(source, 'test');
    const passwordHash = await hashPassword(randomBytes(24).toString('base64url'));
    const user = (role: UserRole) =>
      source.getRepository(User).save({
        username: 'planning.' + role.toLowerCase(),
        displayName: 'Fixture ' + role,
        role,
        active: true,
        passwordHash,
      });
    dispatcher = await user('DISPATCHER');
    employee = await user('CREW_MEMBER');
    administrator = await user('ADMIN');
    const session = async (person: User) => {
      const token = randomBytes(32).toString('base64url');
      const createdAt = new Date();
      await source.getRepository(AuthSession).save({
        userId: person.id,
        tokenHash: hashSessionToken(token),
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 3600000),
        revokedAt: null,
      });
      return 'fd_session=' + token;
    };
    dispatcherCookie = await session(dispatcher);
    employeeCookie = await session(employee);
    adminCookie = await session(administrator);
    orders = new OrdersService(new DatabaseService(source));
    app = await createApplication({ ...config, database: { ...config.database, schema } });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
    if (source?.isInitialized) await source.destroy();
    if (admin?.isInitialized) {
      if (!/^m4_planning_[a-f0-9]{32}$/.test(schema))
        throw new Error('Unsafe test schema cleanup.');
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  async function overlap<T, U>(
    table: 'crew' | 'delivery_order' | 'appointment',
    id: string,
    first: () => Promise<T>,
    second: () => Promise<U>,
  ) {
    const barrier = source.createQueryRunner();
    await barrier.connect();
    await barrier.startTransaction('READ COMMITTED');
    const pidRows = (await barrier.query('SELECT pg_backend_pid() AS pid')) as { pid: number }[];
    await barrier.query(`SELECT id FROM "${schema}"."${table}" WHERE id=$1 FOR UPDATE`, [id]);
    const results = Promise.allSettled([first(), second()]);
    let observed = false;
    try {
      const deadline = Date.now() + 1200;
      while (Date.now() < deadline) {
        const blocked = (await source.query(
          'WITH RECURSIVE blocked AS (SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))) SELECT COUNT(*)::int AS count FROM blocked',
          [pidRows[0]!.pid],
        )) as { count: number }[];
        if (blocked[0]!.count >= 2) {
          observed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    } finally {
      await barrier.rollbackTransaction();
      await barrier.release();
    }
    const completed = await results;
    expect(
      observed,
      'Two distinct operation connections must wait in the held resource-lock chain',
    ).toBe(true);
    return completed;
  }

  const appointmentPath = (orderId: string, id?: string) =>
    `/orders/${orderId}/appointments${id ? '/' + id : ''}`;
  const appointmentInput = (
    crewIds: string[],
    localStart = date(0),
    durationMinutes = 60,
  ): CreateAppointmentRequest => ({
    crewIds,
    localStart,
    durationMinutes,
    idempotencyKey: randomUUID(),
  });
  const createAppointment = async (orderId: string, input: CreateAppointmentRequest) =>
    json<AppointmentResponse>(await call(appointmentPath(orderId), 'POST', input), 201);
  const getAppointment = async (orderId: string, id: string) =>
    (await json<AppointmentResponse>(await call(appointmentPath(orderId, id)))).appointment;
  const updateAppointment = async (orderId: string, id: string, input: UpdateAppointmentRequest) =>
    json<AppointmentResponse>(await call(appointmentPath(orderId, id), 'PATCH', input));
  const confirmAppointment = async (orderId: string, appointment: AppointmentDetail) =>
    json<AppointmentResponse>(
      await call(appointmentPath(orderId, appointment.id) + '/confirm', 'POST', {
        expectedVersion: appointment.version,
      }),
      201,
    );
  const cancelAppointment = async (
    orderId: string,
    appointment: AppointmentDetail,
    reason = 'Fixture cancellation',
  ) =>
    json<AppointmentResponse>(
      await call(appointmentPath(orderId, appointment.id) + '/cancel', 'POST', {
        expectedVersion: appointment.version,
        reason,
      }),
      201,
    );
  async function config(crewId: string) {
    return json<CrewAvailabilityResponse>(await call(`/crews/${crewId}/planning`));
  }
  async function updateConfig(
    crewId: string,
    buffer: number,
    weeklyWindows?: WeeklyWorkingWindow[],
  ) {
    const current = await config(crewId);
    return json<CrewAvailabilityResponse>(
      await call(`/crews/${crewId}/planning`, 'PATCH', {
        expectedVersion: current.config.version,
        travelBufferMinutes: buffer,
        weeklyWindows: weeklyWindows ?? current.config.weeklyWindows,
      }),
    );
  }
  async function calendar(
    from: string,
    to: string,
    crewIds: string[] = [],
    includeUnassigned = true,
    allTeams = true,
  ) {
    const params = new URLSearchParams({
      from,
      to,
      allTeams: String(allTeams),
      crewIds: crewIds.join(','),
      includeUnassigned: String(includeUnassigned),
    });
    return json<CalendarResponse>(await call('/planning/calendar?' + params));
  }
  function succeededResponses(results: PromiseSettledResult<Response>[]) {
    return results.map((result) => {
      expect(result.status).toBe('fulfilled');
      if (result.status !== 'fulfilled') throw new Error('HTTP request rejected');
      return result.value;
    });
  }

  it('creates multiple visits of one order, permits unassigned and parallel crews, keeps server planning projections consistent', async () => {
    const [a, b] = await Promise.all([makeCrew(), makeCrew()]);
    const order = await createOrder();
    const orderCount = await source.getRepository(Order).count();
    const first = await createAppointment(order.id, appointmentInput([a.id], date(0)));
    expect(first.order.progress).toBe('ASSIGNED');
    expect(first.appointment.confirmationStatus).toBe('NEEDS_CONFIRMATION');
    expect(first.appointment.plannedStartAt).toBe('2030-01-07T08:00:00.000Z');
    const second = await createAppointment(order.id, appointmentInput([], date(0, '11:00')));
    expect(second.order.progress).toBe('PLANNED');
    expect(second.appointment.assignments).toHaveLength(0);
    expect(await source.getRepository(Order).count()).toBe(orderCount);
    const assigned = await updateAppointment(order.id, second.appointment.id, {
      expectedVersion: 1,
      crewIds: [b.id],
      reason: 'Assign the second visit team',
    });
    expect(assigned.order.progress).toBe('ASSIGNED');
    const parallel = await createOrder();
    await createAppointment(parallel.id, appointmentInput([b.id], date(0))); // another crew can work alongside A.
    expect(
      (await json<AppointmentListResponse>(await call(appointmentPath(order.id)))).appointments,
    ).toHaveLength(2);
    const fresh = createDataSource(readIntegrationConfig(), { schema });
    await fresh.initialize();
    try {
      expect(await fresh.getRepository(Appointment).countBy({ orderId: order.id })).toBe(2);
    } finally {
      await fresh.destroy();
    }
    const detail = await orders.detail(order.id);
    expect(detail.progress).toBe('ASSIGNED');
    expect((await orders.list({ search: order.number, progress: 'ASSIGNED' })).total).toBe(1);
    await cancelAppointment(order.id, first.appointment);
    const current = await getAppointment(order.id, second.appointment.id);
    const cancelled = await cancelAppointment(order.id, current);
    expect(cancelled.order.progress).toBe('INBOX');
  });

  it('checks full buffers on both sides, half-open boundaries, zero buffer and atomic multi-team rollback', async () => {
    const a = await makeCrew(),
      b = await makeCrew();
    const order = await createOrder();
    await createAppointment(order.id, appointmentInput([a.id], date(0), 120));
    const other = await createOrder();
    const baseline = {
      appointments: await source.getRepository(Appointment).count(),
      assignments: await source.getRepository(CrewAssignment).count(),
      tasks: await source.getRepository(Task).count(),
      history: await history(other.id),
    };
    for (const input of [
      appointmentInput([a.id], date(0, '11:29')),
      appointmentInput([a.id], date(0, '08:00'), 45),
      appointmentInput([b.id, a.id], date(0)),
    ]) {
      const response = await call(appointmentPath(other.id), 'POST', input);
      expect(response.status).toBe(409);
      const body = (await response.json()) as { code: string };
      expect(body.code).toBe('BOOKING_CONFLICT');
    }
    expect(await source.getRepository(Appointment).count()).toBe(baseline.appointments);
    expect(await source.getRepository(CrewAssignment).count()).toBe(baseline.assignments);
    expect(await source.getRepository(Task).count()).toBe(baseline.tasks);
    expect(await history(other.id)).toBe(baseline.history);
    await createAppointment(other.id, appointmentInput([a.id], date(0, '11:30')));
    const zero = await makeCrew();
    await updateConfig(zero.id, 0);
    const zeroOrder = await createOrder();
    await createAppointment(zeroOrder.id, appointmentInput([zero.id], date(0), 120));
    await createAppointment(zeroOrder.id, appointmentInput([zero.id], date(0, '11:00')));
    // Buffer is a snapshot: later config affects only new assignments.
    const saved = await getAppointment(
      order.id,
      (await json<AppointmentListResponse>(await call(appointmentPath(order.id)))).appointments[0]!
        .id,
    );
    await updateConfig(a.id, 0);
    const moved = await updateAppointment(order.id, saved.id, {
      expectedVersion: saved.version,
      localStart: date(1),
      reason: 'Move with original buffer',
    });
    expect(moved.appointment.assignments[0]?.travelBufferMinutes).toBe(30);
  });

  it('enforces working windows, breaks, full buffered availability, disabled crews and configurable weekends', async () => {
    const crew = await makeCrew(),
      order = await createOrder();
    await updateConfig(crew.id, 30, [
      { weekday: 1, startTime: '08:00', endTime: '12:00' },
      { weekday: 1, startTime: '13:00', endTime: '18:00' },
    ]);
    for (const input of [
      appointmentInput([crew.id], date(0, '11:30')),
      appointmentInput([crew.id], date(0, '17:00')),
      appointmentInput([crew.id], date(5)),
    ])
      expect((await call(appointmentPath(order.id), 'POST', input)).status).toBe(409);
    const current = await config(crew.id);
    await updateConfig(crew.id, 30, [
      ...current.config.weeklyWindows,
      { weekday: 6, startTime: '08:00', endTime: '18:00' },
    ]);
    await createAppointment(order.id, appointmentInput([crew.id], date(5)));
    const unavailability = await call(`/crews/${crew.id}/unavailability`, 'POST', {
      localStart: date(0, '09:00'),
      localEnd: date(2, '13:00'),
      reason: 'Fictional absence',
    });
    expect(unavailability.status).toBe(201);
    expect(
      (
        await call(
          appointmentPath(order.id),
          'POST',
          appointmentInput([crew.id], date(0, '08:00'), 45),
        )
      ).status,
    ).toBe(409); // ends at08:45 but buffer overlaps absence09:00.
    expect((await call(`/crews/${crew.id}`, 'PATCH', { active: false })).status).toBe(200);
    expect(
      (await call(appointmentPath(order.id), 'POST', appointmentInput([crew.id], date(12)))).status,
    ).toBe(409);
  });

  it('serializes two different orders competing for the same crew and one slot', async () => {
    const crew = await makeCrew(),
      a = await createOrder(),
      b = await createOrder();
    const responses = succeededResponses(
      await overlap(
        'crew',
        crew.id,
        () => call(appointmentPath(a.id), 'POST', appointmentInput([crew.id])),
        () => call(appointmentPath(b.id), 'POST', appointmentInput([crew.id])),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const assignments = await source
      .getRepository(CrewAssignment)
      .findBy({ crewId: crew.id, status: 'ASSIGNED' });
    expect(assignments).toHaveLength(1);
  });

  it('serializes create versus move and two moves from different orders into the same slot', async () => {
    const crew = await makeCrew();
    const a = await createOrder(),
      b = await createOrder();
    const original = (await createAppointment(a.id, appointmentInput([crew.id], date(1))))
      .appointment;
    const responses = succeededResponses(
      await overlap(
        'crew',
        crew.id,
        () => call(appointmentPath(b.id), 'POST', appointmentInput([crew.id])),
        () =>
          call(appointmentPath(a.id, original.id), 'PATCH', {
            expectedVersion: original.version,
            localStart: date(0),
            reason: 'Move into contested slot',
          }),
      ),
    );
    expect(
      responses.filter((response) => response.status >= 200 && response.status < 300),
    ).toHaveLength(1);
    expect([200, 201]).toContain(responses.find((response) => response.status !== 409)?.status);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(1);
    const secondCrew = await makeCrew(),
      x = await createOrder(),
      y = await createOrder();
    const xVisit = (await createAppointment(x.id, appointmentInput([secondCrew.id], date(1))))
      .appointment;
    const yVisit = (await createAppointment(y.id, appointmentInput([secondCrew.id], date(2))))
      .appointment;
    const moves = succeededResponses(
      await overlap(
        'crew',
        secondCrew.id,
        () =>
          call(appointmentPath(x.id, xVisit.id), 'PATCH', {
            expectedVersion: 1,
            localStart: date(0),
            reason: 'First move',
          }),
        () =>
          call(appointmentPath(y.id, yVisit.id), 'PATCH', {
            expectedVersion: 1,
            localStart: date(0),
            reason: 'Second move',
          }),
      ),
    );
    expect(moves.map((response) => response.status).sort()).toEqual([200, 409]);
  });

  it('locks multiple crews in stable order and rejects a stale shared appointment version', async () => {
    const [a, b] = await Promise.all([makeCrew(), makeCrew()]);
    const x = await createOrder(),
      y = await createOrder();
    const first = (await createAppointment(x.id, appointmentInput([a.id, b.id], date(1))))
      .appointment;
    const second = (await createAppointment(y.id, appointmentInput([b.id, a.id], date(2))))
      .appointment;
    const barrier = [a.id, b.id].sort()[0]!;
    const moves = succeededResponses(
      await overlap(
        'crew',
        barrier,
        () =>
          call(appointmentPath(x.id, first.id), 'PATCH', {
            expectedVersion: 1,
            localStart: date(0),
            crewIds: [b.id, a.id],
            reason: 'First multi-team move',
          }),
        () =>
          call(appointmentPath(y.id, second.id), 'PATCH', {
            expectedVersion: 1,
            localStart: date(0),
            crewIds: [a.id, b.id],
            reason: 'Second multi-team move',
          }),
      ),
    );
    expect(moves.map((response) => response.status).sort()).toEqual([200, 409]);
    const crew = await makeCrew(),
      order = await createOrder(),
      visit = (await createAppointment(order.id, appointmentInput([crew.id]))).appointment;
    const revisions = succeededResponses(
      await overlap(
        'delivery_order',
        order.id,
        () =>
          call(appointmentPath(order.id, visit.id), 'PATCH', {
            expectedVersion: 1,
            notes: 'First draft',
          }),
        () =>
          call(appointmentPath(order.id, visit.id), 'PATCH', {
            expectedVersion: 1,
            notes: 'Second draft',
          }),
      ),
    );
    expect(revisions.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await getAppointment(order.id, visit.id)).version).toBe(2);
  });

  it('replays sequential and overlapping creates exactly once including after cancellation and changed defaults', async () => {
    const crew = await makeCrew(),
      order = await createOrder(),
      input = appointmentInput([crew.id]);
    const before = await history(order.id);
    const results = succeededResponses(
      await overlap(
        'delivery_order',
        order.id,
        () => call(appointmentPath(order.id), 'POST', input),
        () => call(appointmentPath(order.id), 'POST', input),
      ),
    );
    const records = await Promise.all(
      results.map((response) => json<AppointmentResponse>(response, 201)),
    );
    expect(records[0]!.appointment.id).toBe(records[1]!.appointment.id);
    const first = records[0]!.appointment;
    expect(await source.getRepository(Appointment).countBy({ orderId: order.id })).toBe(1);
    expect(await source.getRepository(CrewAssignment).countBy({ appointmentId: first.id })).toBe(1);
    const taskCount = await source.getRepository(Task).count();
    const count = await history(order.id);
    expect(count).toBeGreaterThan(before);
    await updateConfig(crew.id, 60);
    const replay = await createAppointment(order.id, input);
    expect(replay.appointment.id).toBe(first.id);
    expect(replay.appointment.version).toBe(1);
    expect(await history(order.id)).toBe(count);
    expect(await source.getRepository(Task).count()).toBe(taskCount);
    expect(
      (await call(appointmentPath(order.id), 'POST', { ...input, durationMinutes: 90 })).status,
    ).toBe(409);
    const cancelled = await cancelAppointment(order.id, first);
    const afterCancel = await history(order.id);
    const cancelledReplay = await createAppointment(order.id, input);
    expect(cancelledReplay.appointment.status).toBe('CANCELLED');
    expect(cancelledReplay.appointment.version).toBe(cancelled.appointment.version);
    expect(await history(order.id)).toBe(afterCancel);
    const repeat = await call(appointmentPath(order.id, first.id) + '/cancel', 'POST', {
      expectedVersion: 1,
      reason: 'Repeated cancellation',
    });
    expect(repeat.status).toBe(201);
    const repeated = (await repeat.json()) as AppointmentResponse;
    expect(repeated.appointment.version).toBe(cancelled.appointment.version);
    expect(repeated.appointment.cancelReason).toBe(cancelled.appointment.cancelReason);
    expect(await history(order.id)).toBe(afterCancel);
    const next = await createOrder();
    await createAppointment(next.id, appointmentInput([crew.id])); // cancellation freed the reservation.
  });

  it('preserves identity, assignments, task snapshots, confirmation and audit when a move fails; successful time change resets confirmation', async () => {
    const crew = await makeCrew(),
      order = await createOrder(),
      blocker = await createOrder();
    const first = (await createAppointment(order.id, appointmentInput([crew.id]))).appointment;
    const confirmed = (await confirmAppointment(order.id, first)).appointment;
    await createAppointment(blocker.id, appointmentInput([crew.id], date(1)));
    const before = await history(order.id);
    const failure = await call(appointmentPath(order.id, first.id), 'PATCH', {
      expectedVersion: confirmed.version,
      localStart: date(1),
      reason: 'Conflicting move',
    });
    expect(failure.status).toBe(409);
    expect(await getAppointment(order.id, first.id)).toEqual(confirmed);
    expect(await history(order.id)).toBe(before);
    const moved = await updateAppointment(order.id, first.id, {
      expectedVersion: confirmed.version,
      localStart: date(2),
      reason: 'Customer rescheduled',
    });
    expect(moved.appointment.id).toBe(first.id);
    expect(moved.appointment.assignments).toEqual(confirmed.assignments);
    expect(moved.appointment.confirmationStatus).toBe('NEEDS_CONFIRMATION');
    expect(moved.appointment.confirmedAt).toBeNull();
    expect(moved.appointment.confirmedBy).toBeNull();
    expect(moved.order.id).toBe(order.id);
    expect(moved.appointment.version).toBe(confirmed.version + 1);
  });

  it('records availability changes and disabled crews as computed attention without losing bookings', async () => {
    const crew = await makeCrew(),
      order = await createOrder();
    const visit = (await createAppointment(order.id, appointmentInput([crew.id]))).appointment;
    const result = await json<CrewAvailabilityResponse>(
      await call(`/crews/${crew.id}/unavailability`, 'POST', {
        localStart: date(0),
        localEnd: date(0, '12:00'),
        reason: 'Actual absence after booking',
      }),
      201,
    );
    expect(result.affectedAppointments.some((value) => value.id === visit.id)).toBe(true);
    let attention = await getAppointment(order.id, visit.id);
    expect(attention.needsAttention).toBe(true);
    expect(attention.attention.some((value) => value.code === 'UNAVAILABLE')).toBe(true);
    expect(attention.status).toBe('SCHEDULED');
    const edited = await updateAppointment(order.id, visit.id, {
      expectedVersion: attention.version,
      notes: 'Dispatcher reviewed conflict',
    });
    expect(edited.appointment.needsAttention).toBe(true);
    expect((await call(`/crews/${crew.id}`, 'PATCH', { active: false })).status).toBe(200);
    attention = await getAppointment(order.id, visit.id);
    expect(attention.attention.some((value) => value.code === 'CREW_INACTIVE')).toBe(true);
    expect(attention.assignments[0]?.status).toBe('ASSIGNED');
    const events = await calendar('2030-01-07', '2030-01-08', [crew.id], false, false);
    expect(events.appointments.some((value) => value.id === visit.id)).toBe(true);
    await cancelAppointment(order.id, attention);
  });

  it('serializes absence/disable against booking and preserves the committed truth in either order', async () => {
    const crew = await makeCrew(),
      order = await createOrder();
    const responses = succeededResponses(
      await overlap(
        'crew',
        crew.id,
        () => call(appointmentPath(order.id), 'POST', appointmentInput([crew.id])),
        () =>
          call(`/crews/${crew.id}/unavailability`, 'POST', {
            localStart: date(0),
            localEnd: date(0, '12:00'),
            reason: 'Concurrent actual absence',
          }),
      ),
    );
    expect(responses[1]!.status).toBe(201);
    expect([201, 409]).toContain(responses[0]!.status);
    const visits = (await json<AppointmentListResponse>(await call(appointmentPath(order.id))))
      .appointments;
    if (responses[0]!.status === 201) {
      expect(visits).toHaveLength(1);
      expect(visits[0]!.needsAttention).toBe(true);
    } else expect(visits).toHaveLength(0);
    const disabledCrew = await makeCrew(),
      disabledOrder = await createOrder();
    const disabled = succeededResponses(
      await overlap(
        'crew',
        disabledCrew.id,
        () => call(appointmentPath(disabledOrder.id), 'POST', appointmentInput([disabledCrew.id])),
        () => call(`/crews/${disabledCrew.id}`, 'PATCH', { active: false }),
      ),
    );
    expect(disabled[1]!.status).toBe(200);
    expect([201, 409]).toContain(disabled[0]!.status);
    const existing = (
      await json<AppointmentListResponse>(await call(appointmentPath(disabledOrder.id)))
    ).appointments;
    if (disabled[0]!.status === 201)
      expect(existing[0]!.attention.some((value) => value.code === 'CREW_INACTIVE')).toBe(true);
    else expect(existing).toHaveLength(0);
  });

  it('resets confirmation only for actual customer-condition edits, keeps appointment versions independent from payments', async () => {
    const crew = await makeCrew(),
      order = await createOrder();
    const visit = (await createAppointment(order.id, appointmentInput([crew.id]))).appointment;
    let confirmed = (await confirmAppointment(order.id, visit)).appointment;
    const payment = await orders.recordPayment(
      order.id,
      OrderDto.payment({
        amountCents: 1000,
        paidOn: '2030-01-07',
        method: 'CASH',
        idempotencyKey: randomUUID(),
      }),
      dispatcher.id,
    );
    expect((await getAppointment(order.id, visit.id)).version).toBe(confirmed.version);
    await orders.voidPayment(order.id, payment.payment.id, 'Correction', dispatcher.id);
    let currentOrder = await orders.detail(order.id);
    await orders.update(
      order.id,
      { expectedVersion: currentOrder.version, orderTotalCents: 120000 },
      dispatcher.id,
    );
    expect((await getAppointment(order.id, visit.id)).confirmationStatus).toBe('CONFIRMED');
    // An appointment move uses its own version, despite several intervening financial revisions.
    const notes = await updateAppointment(order.id, visit.id, {
      expectedVersion: confirmed.version,
      notes: 'No time change',
    });
    confirmed = notes.appointment;
    currentOrder = await orders.detail(order.id);
    await orders.update(
      order.id,
      { expectedVersion: currentOrder.version, address: 'Changed fixture street' },
      dispatcher.id,
    );
    let reset = await getAppointment(order.id, visit.id);
    expect(reset.confirmationStatus).toBe('NEEDS_CONFIRMATION');
    expect(reset.version).toBe(confirmed.version + 1);
    expect(reset.plannedStartAt).toBe(confirmed.plannedStartAt);
    expect(reset.assignments).toEqual(confirmed.assignments);
    confirmed = (await confirmAppointment(order.id, reset)).appointment;
    currentOrder = await orders.detail(order.id);
    await orders.update(
      order.id,
      { expectedVersion: currentOrder.version, estimatedDurationMinutes: 180 },
      dispatcher.id,
    );
    expect((await getAppointment(order.id, visit.id)).confirmationStatus).toBe('CONFIRMED');
    expect((await getAppointment(order.id, visit.id)).durationMinutes).toBe(60);
    expect((await getAppointment(order.id, visit.id)).version).toBe(confirmed.version);
    currentOrder = await orders.detail(order.id);
    const items = currentOrder.items.map(
      ({
        id,
        description,
        quantity,
        configuration,
        ambient,
        notes,
        requiresAssembly,
        sortOrder,
      }) => ({
        id,
        description,
        quantity: quantity + 1,
        configuration,
        ambient,
        notes,
        requiresAssembly,
        sortOrder,
      }),
    );
    await orders.update(order.id, { expectedVersion: currentOrder.version, items }, dispatcher.id);
    reset = await getAppointment(order.id, visit.id);
    expect(reset.confirmationStatus).toBe('NEEDS_CONFIRMATION');
  });

  it('keeps required template snapshots, permits optional task edits, and retains old assignments on team replacement', async () => {
    const [crew, replacement] = await Promise.all([makeCrew(), makeCrew()]);
    const order = await createOrder();
    const templates = (await json<TaskTemplateListResponse>(await call('/task-templates')))
      .templates;
    const optional = templates.find((value) => !value.required && value.active);
    const required = templates.find(
      (value) => value.required && value.active && value.applicability !== 'DELIVERY_ONLY',
    );
    expect(optional).toBeTruthy();
    expect(required).toBeTruthy();
    const visit = (
      await createAppointment(order.id, {
        ...appointmentInput([crew.id]),
        templateIds: optional ? [optional.id] : [],
      })
    ).appointment;
    const assignment = visit.assignments[0]!;
    const requiredSnapshot = assignment.tasks.find((value) => value.required)!;
    const originalTasks = assignment.tasks;
    await json<TaskTemplateResponse>(
      await call('/task-templates/' + required!.id, 'PATCH', {
        name: 'Changed catalog name',
        description: 'New catalog text',
        active: false,
      }),
    );
    expect((await getAppointment(order.id, visit.id)).assignments[0]!.tasks).toEqual(originalTasks);
    const invalid = await call(appointmentPath(order.id, visit.id), 'PATCH', {
      expectedVersion: visit.version,
      tasks: [{ assignmentId: assignment.id, tasks: [] }],
    });
    expect(invalid.status).toBe(400);
    const kept = assignment.tasks
      .filter((value) => value.required)
      .map((value) => ({
        id: value.id,
        severity: 'HIGH' as const,
        priority: value.priority + 100,
      }));
    const edited = await updateAppointment(order.id, visit.id, {
      expectedVersion: visit.version,
      tasks: [{ assignmentId: assignment.id, tasks: kept }],
    });
    expect(
      edited.appointment.assignments[0]!.tasks.find((value) => value.id === requiredSnapshot.id)
        ?.name,
    ).toBe(requiredSnapshot.name);
    const moved = await updateAppointment(order.id, visit.id, {
      expectedVersion: edited.appointment.version,
      localStart: date(1),
      reason: 'Preserve selected snapshot tasks',
    });
    expect(moved.appointment.assignments[0]!.tasks).toEqual(
      edited.appointment.assignments[0]!.tasks,
    );
    const replaced = await updateAppointment(order.id, visit.id, {
      expectedVersion: moved.appointment.version,
      crewIds: [replacement.id],
      reason: 'Replace crew before work',
    });
    expect(
      replaced.appointment.assignments.some(
        (value) => value.id === assignment.id && value.status === 'CANCELLED',
      ),
    ).toBe(true);
    const old = replaced.appointment.assignments.find((value) => value.id === assignment.id)!;
    expect(old.tasks).toEqual(moved.appointment.assignments[0]!.tasks);
    const active = replaced.appointment.assignments.find((value) => value.status === 'ASSIGNED')!;
    expect(active.id).not.toBe(assignment.id);
    const teamChange = replaced.order.activity.find(
      (event) =>
        event.action === 'APPOINTMENT_UPDATED' && event.reason === 'Replace crew before work',
    );
    expect(teamChange?.changes.beforeCrewIds).toEqual([crew.id]);
    expect(teamChange?.changes.crewIds).toEqual([replacement.id]);
    const restored = await updateAppointment(order.id, visit.id, {
      expectedVersion: replaced.appointment.version,
      crewIds: [crew.id],
      reason: 'Re-add earlier crew as new assignment',
    });
    expect(
      restored.appointment.assignments.find(
        (value) => value.crewId === crew.id && value.status === 'ASSIGNED',
      )!.id,
    ).not.toBe(assignment.id);
    const foreign = (await createAppointment(order.id, appointmentInput([replacement.id], date(2))))
      .appointment;
    expect(
      (
        await call(appointmentPath(order.id, visit.id), 'PATCH', {
          expectedVersion: restored.appointment.version,
          tasks: [{ assignmentId: foreign.assignments[0]!.id, tasks: [] }],
        })
      ).status,
    ).toBe(404);
    const currentAssignment = restored.appointment.assignments.find(
      (value) => value.status === 'ASSIGNED',
    )!;
    const ownTasks = currentAssignment.tasks
      .filter((value) => value.active)
      .map((value) => ({ id: value.id, severity: value.severity, priority: value.priority }));
    const foreignTask = foreign.assignments[0]!.tasks.find((value) => value.active)!;
    expect(
      (
        await call(appointmentPath(order.id, visit.id), 'PATCH', {
          expectedVersion: restored.appointment.version,
          tasks: [
            {
              assignmentId: currentAssignment.id,
              tasks: [
                ...ownTasks,
                {
                  id: foreignTask.id,
                  severity: foreignTask.severity,
                  priority: foreignTask.priority,
                },
              ],
            },
          ],
        })
      ).status,
    ).toBe(404);
  });

  it('rejects unsuitable or inactive assembly templates for delivery-only and keeps snapshots when service changes', async () => {
    const crew = await makeCrew();
    const assembly = (
      await json<TaskTemplateListResponse>(await call('/task-templates'))
    ).templates.find((template) => template.code === 'ASSEMBLE_PRODUCTS')!;
    const input = orderInput();
    input.serviceType = 'DELIVERY_ONLY';
    input.items = input.items.map((item) => ({ ...item, requiresAssembly: false }));
    const delivery = await orders.create(input, dispatcher.id);
    const before = await history(delivery.id);
    expect(
      (
        await call(appointmentPath(delivery.id), 'POST', {
          ...appointmentInput([crew.id]),
          templateIds: [assembly.id],
        })
      ).status,
    ).toBe(400);
    expect(await source.getRepository(Appointment).countBy({ orderId: delivery.id })).toBe(0);
    expect(await history(delivery.id)).toBe(before);
    const visit = (await createAppointment(delivery.id, appointmentInput([crew.id]))).appointment;
    expect(visit.assignments[0]!.tasks.every((task) => task.templateId !== assembly.id)).toBe(true);
    expect(visit.assignments[0]!.tasks.some((task) => task.required)).toBe(true);
    const confirmed = (await confirmAppointment(delivery.id, visit)).appointment;
    const current = await orders.detail(delivery.id);
    await orders.update(
      delivery.id,
      { expectedVersion: current.version, serviceType: 'DELIVERY_AND_ASSEMBLY' },
      dispatcher.id,
    );
    const reset = await getAppointment(delivery.id, visit.id);
    expect(reset.confirmationStatus).toBe('NEEDS_CONFIRMATION');
    expect(reset.assignments).toEqual(confirmed.assignments);
    await json<TaskTemplateResponse>(
      await call('/task-templates/' + assembly.id, 'PATCH', { active: false }),
    );
    const assemblyOrder = await createOrder();
    expect(
      (
        await call(appointmentPath(assemblyOrder.id), 'POST', {
          ...appointmentInput([crew.id], date(1)),
          templateIds: [assembly.id],
        })
      ).status,
    ).toBe(400);
  });

  it('computes attention after a working-window change without releasing the existing reservation', async () => {
    const crew = await makeCrew(),
      order = await createOrder();
    const visit = (await createAppointment(order.id, appointmentInput([crew.id]))).appointment;
    const changed = await updateConfig(crew.id, 30, [
      { weekday: 1, startTime: '13:00', endTime: '18:00' },
    ]);
    expect(changed.affectedAppointments.some((appointment) => appointment.id === visit.id)).toBe(
      true,
    );
    const existing = await getAppointment(order.id, visit.id);
    expect(existing.needsAttention).toBe(true);
    expect(existing.attention.some((issue) => issue.code === 'OUTSIDE_WORKING_WINDOW')).toBe(true);
    expect(existing.assignments[0]!.status).toBe('ASSIGNED');
    expect(
      (await call(appointmentPath(order.id), 'POST', appointmentInput([crew.id], date(0, '09:30'))))
        .status,
    ).toBe(409);
    const noted = await updateAppointment(order.id, visit.id, {
      expectedVersion: existing.version,
      notes: 'Availability changed; dispatcher must review',
    });
    expect(noted.appointment.needsAttention).toBe(true);
    await cancelAppointment(order.id, noted.appointment);
    expect((await orders.detail(order.id)).progress).toBe('INBOX');
  });

  it('returns complete unique calendar events with OR teams, explicit unassigned and overlap ranges; rejects bad filters', async () => {
    const [a, b] = await Promise.all([makeCrew(), makeCrew()]);
    const order = await createOrder();
    const multi = (await createAppointment(order.id, appointmentInput([a.id, b.id], date(0), 120)))
      .appointment;
    const unassigned = (await createAppointment(order.id, appointmentInput([], date(0, '13:00'))))
      .appointment;
    for (const ids of [[a.id], [b.id], [a.id, b.id]]) {
      const found = await calendar('2030-01-07', '2030-01-08', ids, false, false);
      expect(found.appointments.filter((value) => value.id === multi.id)).toHaveLength(1);
      expect(found.appointments.some((value) => value.id === unassigned.id)).toBe(false);
    }
    expect(
      (await calendar('2030-01-07', '2030-01-08', [a.id], true, false)).appointments.some(
        (value) => value.id === unassigned.id,
      ),
    ).toBe(true);
    expect(
      (await calendar('2030-01-07', '2030-01-08', [], false, false)).appointments,
    ).toHaveLength(0);
    const partial = await calendar(
      '2030-01-07T08:30:00Z',
      '2030-01-07T09:30:00Z',
      [a.id],
      false,
      false,
    );
    expect(partial.appointments.some((value) => value.id === multi.id)).toBe(true);
    expect(
      (await calendar('2030-01-07T10:00:00Z', '2030-01-07T11:00:00Z', [a.id], false, false))
        .appointments,
    ).toHaveLength(0);
    for (const [query, status] of [
      ['from=2030-01-07&to=2030-03-01&allTeams=true&includeUnassigned=true', 400],
      ['from=2030-01-07&to=2030-01-08&allTeams=true&includeUnassigned=false&crewIds=' + a.id, 400],
      [
        'from=2030-01-07&to=2030-01-08&allTeams=false&includeUnassigned=false&crewIds=' +
          randomUUID(),
        404,
      ],
    ] as const)
      expect((await call('/planning/calendar?' + query)).status).toBe(status);
  });

  it('keeps global financial aggregates exact despite many visits, assignments and tasks, and filters planning progress', async () => {
    const before = await orders.dashboard(),
      crew = await makeCrew(),
      otherCrew = await makeCrew(),
      order = await createOrder(20000);
    await orders.recordPayment(
      order.id,
      OrderDto.payment({
        amountCents: 4000,
        paidOn: '2030-01-07',
        method: 'CASH',
        idempotencyKey: randomUUID(),
      }),
      dispatcher.id,
    );
    await orders.recordPayment(
      order.id,
      OrderDto.payment({
        amountCents: 6000,
        paidOn: '2030-01-07',
        method: 'CASH',
        idempotencyKey: randomUUID(),
      }),
      dispatcher.id,
    );
    await createAppointment(order.id, appointmentInput([crew.id, otherCrew.id]));
    await createAppointment(order.id, appointmentInput([], date(1)));
    const after = await orders.dashboard();
    expect(after.orderTotalCents - before.orderTotalCents).toBe(20000);
    expect(after.paidCents - before.paidCents).toBe(10000);
    expect(after.balanceCents - before.balanceCents).toBe(10000);
    expect(after.plannedCount - before.plannedCount).toBe(1);
    expect((await orders.list({ search: order.number, progress: 'PLANNED' })).total).toBe(1);
  });

  it('rejects protected payloads, ownership misuse, missing CSRF and all M4 backoffice access by crew or disabled sessions', async () => {
    const crew = await makeCrew(),
      order = await createOrder(),
      foreign = await createOrder();
    const appointment = (await createAppointment(order.id, appointmentInput([crew.id])))
      .appointment;
    const input = appointmentInput([crew.id], date(1));
    for (const body of [
      { ...input, plannedEndAt: '2030-01-07T11:00:00Z' },
      { ...input, status: 'COMPLETED' },
      { ...input, createdBy: employee.id },
      { ...input, crewIds: [crew.id, crew.id] },
      { ...input, durationMinutes: 1.5 },
      { ...input, templateIds: [randomUUID()] },
    ])
      expect((await call(appointmentPath(order.id), 'POST', body)).status).toBe(400);
    expect((await call(appointmentPath(foreign.id, appointment.id))).status).toBe(404);
    expect(
      (
        await call(appointmentPath(foreign.id, appointment.id), 'PATCH', {
          expectedVersion: 1,
          notes: 'Wrong parent',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(appointmentPath(order.id), 'POST', input, dispatcherCookie, {
          Origin: 'https://invalid.example',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(appointmentPath(order.id), 'POST', input, dispatcherCookie, {
          'X-CSRF-Protection': '',
        })
      ).status,
    ).toBe(403);
    const readPaths = [
      appointmentPath(order.id),
      appointmentPath(order.id, appointment.id),
      '/planning/calendar?from=2030-01-07&to=2030-01-08&allTeams=true&includeUnassigned=true',
      `/crews/${crew.id}/planning`,
      '/task-templates',
    ];
    for (const path of readPaths) {
      expect((await call(path, 'GET', undefined, '')).status).toBe(401);
      const denied = await call(path, 'GET', undefined, employeeCookie);
      expect(denied.status).toBe(403);
      expect(await denied.text()).not.toMatch(
        /customerName|orderTotalCents|plannedStartAt|internalNotes/,
      );
      expect((await call(path, 'GET', undefined, adminCookie)).status).toBe(200);
    }
    const mutationPaths: [string, string, unknown][] = [
      [appointmentPath(order.id), 'POST', input],
      [appointmentPath(order.id, appointment.id), 'PATCH', { expectedVersion: 1, notes: 'No' }],
      [appointmentPath(order.id, appointment.id) + '/confirm', 'POST', { expectedVersion: 1 }],
      [
        appointmentPath(order.id, appointment.id) + '/cancel',
        'POST',
        { expectedVersion: 1, reason: 'No' },
      ],
      [`/crews/${crew.id}/planning`, 'PATCH', {}],
      [`/crews/${crew.id}/unavailability`, 'POST', {}],
      [`/crews/${crew.id}/unavailability/${randomUUID()}`, 'PATCH', {}],
      ['/task-templates', 'POST', {}],
      [`/task-templates/${randomUUID()}`, 'PATCH', {}],
    ];
    for (const [path, method, body] of mutationPaths)
      expect((await call(path, method, body, employeeCookie)).status).toBe(403);
    await source.getRepository(User).update(dispatcher.id, { role: 'CREW_MEMBER' });
    expect((await call(appointmentPath(order.id))).status).toBe(403);
    await source.getRepository(User).update(dispatcher.id, { role: 'DISPATCHER', active: false });
    expect((await call(appointmentPath(order.id))).status).toBe(401);
    await source.getRepository(User).update(dispatcher.id, { active: true });
  });

  it('rolls back every planning mutation if its order audit cannot be stored', async () => {
    const crew = await makeCrew(),
      order = await createOrder();
    const visit = (await createAppointment(order.id, appointmentInput([crew.id]))).appointment;
    const before = await getAppointment(order.id, visit.id),
      orderBefore = await orders.detail(order.id),
      count = await source.getRepository(Appointment).count();
    await source.query(
      `ALTER TABLE "${schema}"."activity_log" ADD CONSTRAINT m4_audit_failure CHECK (action NOT LIKE 'APPOINTMENT_%') NOT VALID`,
    );
    try {
      expect(
        (await call(appointmentPath(order.id), 'POST', appointmentInput([], date(1)))).status,
      ).toBe(500);
      expect(await source.getRepository(Appointment).count()).toBe(count);
      for (const [path, body] of [
        [
          appointmentPath(order.id, visit.id),
          { expectedVersion: visit.version, localStart: date(1), reason: 'Should rollback' },
        ],
        [appointmentPath(order.id, visit.id) + '/confirm', { expectedVersion: visit.version }],
        [
          appointmentPath(order.id, visit.id) + '/cancel',
          { expectedVersion: visit.version, reason: 'Should rollback' },
        ],
      ] as const)
        expect(
          (
            await call(
              path,
              path.endsWith('/confirm') || path.endsWith('/cancel') ? 'POST' : 'PATCH',
              body,
            )
          ).status,
        ).toBe(500);
      expect(await getAppointment(order.id, visit.id)).toEqual(before);
      expect(await orders.detail(order.id)).toEqual(orderBefore);
    } finally {
      await source.query(`ALTER TABLE "${schema}"."activity_log" DROP CONSTRAINT m4_audit_failure`);
    }
  });

  it('keeps repeated and concurrent defaults seed non-destructive without planning existing M3 orders', async () => {
    const crew = await makeCrew();
    const current = await config(crew.id);
    const custom = await updateConfig(crew.id, 0, [
      { weekday: 6, startTime: '10:00', endTime: '16:00' },
    ]);
    const templates = (await json<TaskTemplateListResponse>(await call('/task-templates')))
      .templates;
    const template = templates[0]!;
    await source
      .getRepository(TaskTemplate)
      .update(template.id, { active: false, name: 'Manual disabled template' });
    const orderCount = await source.getRepository(Order).count(),
      appointmentCount = await source.getRepository(Appointment).count(),
      templateCount = await source.getRepository(TaskTemplate).count(),
      auditCount = await source.getRepository(ActivityLog).count();
    await Promise.all([seedPlanningDefaults(source, 'test'), seedPlanningDefaults(source, 'test')]);
    const preserved = await config(crew.id);
    expect(preserved.config).toEqual(custom.config);
    expect(
      (await source.getRepository(TaskTemplate).findOneByOrFail({ id: template.id })).name,
    ).toBe('Manual disabled template');
    expect(
      (await source.getRepository(TaskTemplate).findOneByOrFail({ id: template.id })).active,
    ).toBe(false);
    expect(await source.getRepository(Order).count()).toBe(orderCount);
    expect(await source.getRepository(Appointment).count()).toBe(appointmentCount);
    expect(await source.getRepository(TaskTemplate).count()).toBe(templateCount);
    expect(await source.getRepository(ActivityLog).count()).toBe(auditCount);
    expect(current.config.travelBufferMinutes).toBe(30);
    await expect(seedPlanningDefaults(source, 'production')).rejects.toThrow();
    expect(await source.runMigrations()).toHaveLength(0);
  });
});
