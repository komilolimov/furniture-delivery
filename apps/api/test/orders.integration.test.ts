import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type {
  CreateOrderRequest,
  CreatePaymentRequest,
  OrderDetail,
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
import { AuthSession } from '../src/identity/auth-session.entity';
import { User } from '../src/identity/user.entity';
import { ActivityLog } from '../src/orders/activity-log.entity';
import { OrderItem } from '../src/orders/order-item.entity';
import { Order } from '../src/orders/order.entity';
import { Payment } from '../src/orders/payment.entity';
import { OrderDto } from '../src/orders/orders.dto';
import { OrdersService } from '../src/orders/orders.service';

const requestInput = (total = 100000): CreateOrderRequest =>
  OrderDto.create({
    customerName: 'Fictional Test Customer',
    phoneNumbers: ['+39 000 111'],
    address: 'Demo road 12',
    city: 'Rome',
    country: 'Italy',
    serviceType: 'DELIVERY_AND_ASSEMBLY',
    workDescription: 'Delivery and assembly',
    estimatedDurationMinutes: 90,
    orderTotalCents: total,
    items: [
      { description: 'Table', quantity: 2, requiresAssembly: true, sortOrder: 0 },
      { description: 'Chair', quantity: 4, requiresAssembly: false, sortOrder: 1 },
    ],
  });
const paymentInput = (amountCents = 10000, key = randomUUID()): CreatePaymentRequest =>
  OrderDto.payment({
    amountCents,
    paidOn: '2026-10-25',
    method: 'BANK_TRANSFER',
    note: 'Manual fixture',
    idempotencyKey: key,
  });

describe('M3 orders and payments on isolated Compose PostgreSQL', () => {
  const schema = `m3_orders_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource | undefined,
    source: DataSource,
    service: OrdersService,
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
    fetch(`${base}/api${path}`, {
      method,
      headers: {
        Origin: origin,
        'X-CSRF-Protection': '1',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  beforeAll(async () => {
    const config = readIntegrationConfig();
    admin = createDataSource(config);
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    source = createDataSource(config, { schema });
    await source.initialize();
    await source.runMigrations();
    const passwordHash = await hashPassword(randomBytes(24).toString('base64url'));
    const user = async (role: UserRole) =>
      source.getRepository(User).save({
        username: `orders.${role.toLowerCase()}`,
        displayName: `Test ${role}`,
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
      return `fd_session=${token}`;
    };
    dispatcherCookie = await session(dispatcher);
    employeeCookie = await session(employee);
    adminCookie = await session(administrator);
    service = new OrdersService(new DatabaseService(source));
    app = await createApplication({ ...config, database: { ...config.database, schema } });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
    if (source?.isInitialized) await source.destroy();
    if (admin?.isInitialized) {
      if (!/^m3_orders_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe schema cleanup.');
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });
  const create = (total = 100000) => service.create(requestInput(total), dispatcher.id);
  const auditCount = (id: string) => source.getRepository(ActivityLog).countBy({ orderId: id });
  /** Hold the real parent lock while both independent operation connections queue behind it. */
  async function overlap<T, U>(orderId: string, first: () => Promise<T>, second: () => Promise<U>) {
    const barrier = source.createQueryRunner();
    await barrier.connect();
    await barrier.startTransaction('READ COMMITTED');
    const pidRows = (await barrier.query('SELECT pg_backend_pid() AS pid')) as { pid: number }[];
    const pid = pidRows[0]!.pid;
    await barrier.manager
      .getRepository(Order)
      .findOne({ where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
    const results = Promise.allSettled([first(), second()]);
    let confirmed = false;
    try {
      const deadline = Date.now() + 1200;
      while (Date.now() < deadline) {
        const blocked = (await source.query(
          'WITH RECURSIVE blocked AS (SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))) SELECT COUNT(*)::int AS count FROM blocked',
          [pid],
        )) as { count: number }[];
        const count = blocked[0]!.count;
        if (count >= 2) {
          confirmed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(
        confirmed,
        'Both operation connections must actually wait on the held Order row lock',
      ).toBe(true);
    } finally {
      await barrier.rollbackTransaction();
      await barrier.release();
    }
    return results;
  }
  it('creates atomic order/items with unique server numbers, reads through a new connection and edits with version protection', async () => {
    const response = await call('/orders', 'POST', requestInput());
    expect(response.status).toBe(201);
    const order = ((await response.json()) as { order: OrderDetail }).order;
    expect(order.progress).toBe('INBOX');
    expect(order.version).toBe(1);
    expect(order.items).toHaveLength(2);
    expect(order.paidCents).toBe(0);
    const config = readIntegrationConfig();
    const fresh = createDataSource(config, { schema });
    await fresh.initialize();
    try {
      expect(
        (await fresh.getRepository(Order).findOneByOrFail({ id: order.id })).customerName,
      ).toBe(order.customerName);
    } finally {
      await fresh.destroy();
    }
    const edited = await service.update(
      order.id,
      {
        expectedVersion: order.version,
        city: 'Milan',
        items: [{ ...order.items[0]!, description: 'Updated table' }].map(
          ({
            id,
            description,
            quantity,
            requiresAssembly,
            sortOrder,
            configuration,
            ambient,
            notes,
          }) => ({
            id,
            description,
            quantity,
            requiresAssembly,
            sortOrder,
            configuration,
            ambient,
            notes,
          }),
        ),
      },
      dispatcher.id,
    );
    expect(edited.city).toBe('Milan');
    expect(edited.items).toHaveLength(1);
    expect(edited.version).toBe(2);
    expect(
      await source.getRepository(OrderItem).countBy({ orderId: order.id, active: false }),
    ).toBe(1);
    const events = await auditCount(order.id);
    await expect(
      service.update(order.id, { expectedVersion: 1, city: 'Stale overwrite' }, dispatcher.id),
    ).rejects.toMatchObject({ status: 409 });
    expect(await auditCount(order.id)).toBe(events);
    const parallel = await Promise.all([create(), create(), create()]);
    expect(new Set(parallel.map((value) => value.number)).size).toBe(3);
  });
  it('rejects forged/incomplete fields and invalid items without a partial form, verifies item/order ownership', async () => {
    const before = await source.getRepository(Order).count();
    for (const body of [
      { ...requestInput(), paidCents: 999 },
      { ...requestInput(), createdBy: administrator.id },
      { ...requestInput(), orderTotalCents: 1.2 },
      { ...requestInput(), orderTotalCents: -1 },
      { ...requestInput(), orderTotalCents: 2000000001 },
      { ...requestInput(), items: [{ ...requestInput().items[0], quantity: 0 }] },
    ])
      expect((await call('/orders', 'POST', body)).status).toBe(400);
    expect(await source.getRepository(Order).count()).toBe(before);
    const itemCount = await source.getRepository(OrderItem).count();
    const activityCount = await source.getRepository(ActivityLog).count();
    const invalid = requestInput();
    invalid.items[1]!.quantity = 0;
    // Fail at PostgreSQL after the parent and first item have already been inserted.
    await expect(service.create(invalid, dispatcher.id)).rejects.toThrow();
    expect(await source.getRepository(Order).count()).toBe(before);
    expect(await source.getRepository(OrderItem).count()).toBe(itemCount);
    expect(await source.getRepository(ActivityLog).count()).toBe(activityCount);
    const a = await create(),
      b = await create();
    const history = await auditCount(a.id);
    const foreignItem = b.items[0]!;
    await expect(
      service.update(
        a.id,
        {
          expectedVersion: a.version,
          customerName: 'Must rollback',
          items: [
            {
              id: foreignItem.id,
              description: foreignItem.description,
              quantity: foreignItem.quantity,
              configuration: foreignItem.configuration,
              ambient: foreignItem.ambient,
              notes: foreignItem.notes,
              requiresAssembly: foreignItem.requiresAssembly,
              sortOrder: 0,
            },
          ],
        },
        dispatcher.id,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect((await service.detail(a.id)).customerName).toBe(a.customerName);
    expect(await auditCount(a.id)).toBe(history);
  });
  it('denies anonymous and crew financial/API access, applies current roles/disabled status and CSRF', async () => {
    const order = await create();
    for (const path of ['/orders', `/orders/${order.id}`, '/dashboard']) {
      expect((await call(path, 'GET', undefined, '')).status).toBe(401);
      const response = await call(path, 'GET', undefined, employeeCookie);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toMatch(
        /orderTotalCents|internalNotes|paidCents|balanceCents/,
      );
      expect((await call(path, 'GET', undefined, adminCookie)).status).toBe(200);
    }
    expect(
      (await call(`/orders/${order.id}/payments`, 'POST', paymentInput(), employeeCookie)).status,
    ).toBe(403);
    expect(
      (
        await call('/orders', 'POST', requestInput(), dispatcherCookie, {
          Origin: 'https://invalid.example',
        })
      ).status,
    ).toBe(403);
    expect(
      (await call('/orders', 'POST', requestInput(), dispatcherCookie, { 'X-CSRF-Protection': '' }))
        .status,
    ).toBe(403);
    await source.getRepository(User).update(dispatcher.id, { role: 'CREW_MEMBER' });
    expect((await call('/orders')).status).toBe(403);
    await source.getRepository(User).update(dispatcher.id, { role: 'DISPATCHER', active: false });
    expect((await call('/orders')).status).toBe(401);
    await source.getRepository(User).update(dispatcher.id, { active: true });
    expect((await call('/orders')).status).toBe(200);
  });
  it('replays sequential and concurrent identical payments once, rejects changed payload and protects ownership', async () => {
    const order = await create(10000),
      input = paymentInput(10000);
    const initial = await auditCount(order.id);
    const first = await service.recordPayment(order.id, input, dispatcher.id);
    const replay = await service.recordPayment(order.id, input, administrator.id);
    expect(replay.payment.id).toBe(first.payment.id);
    expect(replay.order.version).toBe(first.order.version);
    expect(replay.order.paymentStatus).toBe('PAID');
    expect(await auditCount(order.id)).toBe(initial + 1);
    await expect(
      service.recordPayment(
        order.id,
        { ...input, note: 'Different normalized request' },
        dispatcher.id,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const other = await create(10000);
    const parallelInput = paymentInput(10000);
    const results = await overlap(
      other.id,
      () => service.recordPayment(other.id, parallelInput, dispatcher.id),
      () => service.recordPayment(other.id, parallelInput, dispatcher.id),
    );
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(await source.getRepository(Payment).countBy({ orderId: other.id })).toBe(1);
    expect(
      await source
        .getRepository(ActivityLog)
        .countBy({ orderId: other.id, action: 'PAYMENT_RECORDED' }),
    ).toBe(1);
    const text = JSON.stringify(await service.detail(other.id));
    expect(text).not.toMatch(/fingerprint|idempotencyKey|passwordHash|tokenHash/);
    await expect(
      service.voidPayment(other.id, first.payment.id, 'Wrong order', dispatcher.id),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('serializes two competing 60000 payments for a 100000 order: exactly one succeeds', async () => {
    const order = await create(100000);
    const results = await overlap(
      order.id,
      () => service.recordPayment(order.id, paymentInput(60000), dispatcher.id),
      () => service.recordPayment(order.id, paymentInput(60000), dispatcher.id),
    );
    expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((value) => value.status === 'rejected')).toHaveLength(1);
    expect(results.find((value) => value.status === 'rejected')).toMatchObject({
      reason: { status: 409 },
    });
    const current = await service.detail(order.id);
    expect(current.paidCents).toBe(60000);
    expect(current.balanceCents).toBe(40000);
    expect(current.payments).toHaveLength(1);
    expect(current.activity.filter((value) => value.action === 'PAYMENT_RECORDED')).toHaveLength(1);
  });
  it('serializes payment against total reduction and two stale edits without violating the invariant', async () => {
    const order = await create(100000);
    const results = await overlap(
      order.id,
      () => service.recordPayment(order.id, paymentInput(60000), dispatcher.id),
      () =>
        service.update(
          order.id,
          { expectedVersion: order.version, orderTotalCents: 50000 },
          dispatcher.id,
        ),
    );
    expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((value) => value.status === 'rejected')).toHaveLength(1);
    const current = await service.detail(order.id);
    expect(current.paidCents).toBeLessThanOrEqual(current.orderTotalCents);
    const edit = await create();
    const edits = await overlap(
      edit.id,
      () => service.update(edit.id, { expectedVersion: 1, city: 'First' }, dispatcher.id),
      () => service.update(edit.id, { expectedVersion: 1, city: 'Second' }, dispatcher.id),
    );
    expect(edits.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(edits.find((value) => value.status === 'rejected')).toMatchObject({
      reason: { status: 409 },
    });
  });
  it('voids once with a reason, replays VOIDED original without restoring payment and derives all statuses', async () => {
    const free = await create(0);
    expect(free.paymentStatus).toBe('NOT_REQUIRED');
    await expect(
      service.recordPayment(free.id, paymentInput(1), dispatcher.id),
    ).rejects.toMatchObject({ status: 409 });
    const order = await create(10000),
      input = paymentInput(4000);
    expect(order.paymentStatus).toBe('UNPAID');
    const first = await service.recordPayment(order.id, input, dispatcher.id);
    expect(first.order.paymentStatus).toBe('PARTIALLY_PAID');
    expect(
      (await call(`/orders/${order.id}/payments/${first.payment.id}/void`, 'POST', { reason: ' ' }))
        .status,
    ).toBe(400);
    const results = await overlap(
      order.id,
      () => service.voidPayment(order.id, first.payment.id, 'Duplicate entry', dispatcher.id),
      () => service.voidPayment(order.id, first.payment.id, 'Second request', dispatcher.id),
    );
    expect(results.every((value) => value.status === 'fulfilled')).toBe(true);
    const voided = await service.detail(order.id);
    expect(voided.paidCents).toBe(0);
    expect(voided.payments[0]?.voidReason).toBeTruthy();
    expect(voided.activity.filter((value) => value.action === 'PAYMENT_VOIDED')).toHaveLength(1);
    const replay = await service.recordPayment(order.id, input, dispatcher.id);
    expect(replay.payment.status).toBe('VOIDED');
    expect(replay.order.version).toBe(voided.version);
    expect(replay.order.paidCents).toBe(0);
    const full = await service.recordPayment(order.id, paymentInput(10000), dispatcher.id);
    expect(full.order.paymentStatus).toBe('PAID');
    await expect(
      service.update(
        order.id,
        { expectedVersion: full.order.version, orderTotalCents: 9999 },
        dispatcher.id,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('rolls back order/items/payment/VOID when their audit write is rejected', async () => {
    const order = await create(20000);
    const before = await service.detail(order.id);
    await source.query(
      `ALTER TABLE "${schema}"."activity_log" ADD CONSTRAINT m3_test_audit_failure CHECK (action NOT IN ('ORDER_CREATED','ORDER_UPDATED','PAYMENT_RECORDED','PAYMENT_VOIDED')) NOT VALID`,
    );
    try {
      const count = await source.getRepository(Order).count();
      await expect(create()).rejects.toThrow();
      expect(await source.getRepository(Order).count()).toBe(count);
      await expect(
        service.update(
          order.id,
          { expectedVersion: order.version, city: 'Must rollback' },
          dispatcher.id,
        ),
      ).rejects.toThrow();
      await expect(
        service.recordPayment(order.id, paymentInput(1000), dispatcher.id),
      ).rejects.toThrow();
      expect(await service.detail(order.id)).toEqual(before);
    } finally {
      await source.query(
        `ALTER TABLE "${schema}"."activity_log" DROP CONSTRAINT m3_test_audit_failure`,
      );
    }
    const recorded = await service.recordPayment(order.id, paymentInput(1000), dispatcher.id);
    await source.query(
      `ALTER TABLE "${schema}"."activity_log" ADD CONSTRAINT m3_test_audit_failure CHECK (action <> 'PAYMENT_VOIDED') NOT VALID`,
    );
    try {
      await expect(
        service.voidPayment(order.id, recorded.payment.id, 'Must rollback', dispatcher.id),
      ).rejects.toThrow();
      expect((await service.detail(order.id)).paidCents).toBe(1000);
    } finally {
      await source.query(
        `ALTER TABLE "${schema}"."activity_log" DROP CONSTRAINT m3_test_audit_failure`,
      );
    }
  });
  it('searches and paginates with deterministic order; global aggregates do not multiply items or payments', async () => {
    const before = await service.dashboard();
    const order = await service.create(
      { ...requestInput(20000), customerName: 'Unique Search Fixture', city: 'SearchCity' },
      dispatcher.id,
    );
    await service.recordPayment(order.id, paymentInput(4000), dispatcher.id);
    await service.recordPayment(order.id, paymentInput(6000), dispatcher.id);
    const dashboard = await service.dashboard();
    expect(dashboard.inboxCount - before.inboxCount).toBe(1);
    expect(dashboard.orderTotalCents - before.orderTotalCents).toBe(20000);
    expect(dashboard.paidCents - before.paidCents).toBe(10000);
    expect(dashboard.balanceCents - before.balanceCents).toBe(10000);
    for (const search of ['Unique Search Fixture', 'SearchCity', order.number])
      expect((await service.list({ search })).orders.map((value) => value.id)).toEqual([order.id]);
    expect(
      (await service.list({ search: 'Unique Search Fixture', serviceType: 'DELIVERY_ONLY' })).total,
    ).toBe(0);
    expect(
      (await service.list({ search: 'Unique Search Fixture', paymentStatus: 'PARTIALLY_PAID' }))
        .total,
    ).toBe(1);
    const first = await service.list({ page: 1, pageSize: 2 }),
      second = await service.list({ page: 2, pageSize: 2 });
    expect(first.orders).toHaveLength(2);
    expect(second.orders).toHaveLength(2);
    expect(new Set([...first.orders, ...second.orders].map((value) => value.id)).size).toBe(4);
    expect(first.total).toBe(second.total);
    expect((await service.list({ search: '%', page: 1, pageSize: 2 })).total).toBe(0);
    const http = await call('/orders?paymentStatus=PARTIALLY_PAID&page=1&pageSize=2');
    expect(http.status).toBe(200);
    expect(((await http.json()) as { orders: unknown[] }).orders.length).toBeLessThanOrEqual(2);
  });
});
