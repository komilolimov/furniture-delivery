import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readIntegrationConfig } from '../src/config/environment';
import { Crew } from '../src/crews/crew.entity';
import { createDataSource } from '../src/database/data-source';
import { seedCrews } from '../src/database/demo-crews';
import { demoOrderKeys, seedOrders } from '../src/database/demo-orders';
import { CrewMember } from '../src/identity/crew-member.entity';
import { User } from '../src/identity/user.entity';
import { ActivityLog } from '../src/orders/activity-log.entity';
import { OrderItem } from '../src/orders/order-item.entity';
import { Order } from '../src/orders/order.entity';
import { Payment } from '../src/orders/payment.entity';

describe('M3 repeatable demo aggregate seed on isolated Compose PostgreSQL', () => {
  const schema = `m3_seed_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let source: DataSource;
  let actorId: string;
  let crewId: string;
  let membershipId: string;
  const table = (name: string) => `"${schema}"."${name}"`;

  beforeAll(async () => {
    const config = readIntegrationConfig();
    admin = createDataSource(config);
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    source = createDataSource(config, { schema });
    await source.initialize();
    expect((await source.runMigrations()).map(({ name }) => name)).toEqual([
      'CreateCrew1792886400000',
      'CreateIdentity1792886401000',
      'CreateOrders1792886402000',
      'CreatePlanning1792886403000',
      'CreateExecution1792886404000',
      'CreateEvidence1792886404100',
      'CreateEstimates1792886405000',
      'CreateReturnVisits1792886405100',
      'CreateAcceptance1792886406000',
      'CreateCompletion1792886406100',
    ]);
    expect(await source.runMigrations()).toHaveLength(0);
    await seedCrews(source, 'test');
    const actor = await source.getRepository(User).save({
      username: 'demo.dispatcher',
      displayName: 'Fictional Dispatcher',
      role: 'DISPATCHER',
      active: true,
      passwordHash: 'fixture-only-hash',
    });
    actorId = actor.id;
    const crew = await source.getRepository(Crew).findOneByOrFail({ code: 'DEMO-01' });
    crewId = crew.id;
    const employee = await source.getRepository(User).save({
      username: 'fixture.employee',
      displayName: 'Fictional Employee',
      role: 'CREW_MEMBER',
      active: true,
      passwordHash: 'fixture-only-employee-hash',
    });
    const membership = await source
      .getRepository(CrewMember)
      .save({ userId: employee.id, crewId, active: true });
    membershipId = membership.id;
  });

  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (admin?.isInitialized) {
      if (!/^m3_seed_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema cleanup.');
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  async function snapshot(): Promise<string> {
    const snapshots: unknown[] = [];
    for (const name of [
      'crew',
      'app_user',
      'crew_member',
      'delivery_order',
      'order_item',
      'payment',
      'activity_log',
    ]) {
      snapshots.push(await source.query(`SELECT * FROM ${table(name)} ORDER BY id`));
    }
    return JSON.stringify(snapshots);
  }

  it('rejects production before changing data', async () => {
    await expect(seedOrders(source, 'production')).rejects.toThrow('development or test');
    expect(await source.getRepository(Order).count()).toBe(0);
  });

  it('overlaps two seed transactions on separate connections, generates unique orders and all demo payment states', async () => {
    const gate = source.createQueryRunner();
    await gate.connect();
    await gate.startTransaction();
    await gate.query(`LOCK TABLE ${table('delivery_order')} IN SHARE ROW EXCLUSIVE MODE`);
    const pending = [seedOrders(source, 'test'), seedOrders(source, 'test')];
    const settled = Promise.allSettled(pending);
    try {
      const deadline = Date.now() + 1500;
      let waiters = 0;
      while (Date.now() < deadline && waiters < 2) {
        const rows = (await source.query(
          `SELECT count(DISTINCT pid)::int AS count FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE $1`,
          [`%INSERT INTO "${schema}"."delivery_order"%`],
        )) as { count: number }[];
        waiters = rows[0]?.count ?? 0;
        if (waiters < 2) await pause(10);
      }
      expect(waiters).toBe(2);
    } finally {
      await gate.commitTransaction();
      await gate.release();
    }
    expect((await settled).map(({ status }) => status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await source.getRepository(Order).count()).toBe(demoOrderKeys.length);
    expect(await source.getRepository(OrderItem).count()).toBe(20);
    const orders = await source.getRepository(Order).find();
    expect(new Set(orders.map(({ number }) => number)).size).toBe(10);
    expect(orders.every(({ number }) => /^ORD-\d+$/.test(number))).toBe(true);
    const rows = (await source.query(
      `SELECT DISTINCT CASE WHEN o.order_total_cents = 0 THEN 'NOT_REQUIRED' WHEN coalesce(p.paid, 0) = 0 THEN 'UNPAID' WHEN p.paid = o.order_total_cents THEN 'PAID' ELSE 'PARTIALLY_PAID' END AS status FROM ${table('delivery_order')} o LEFT JOIN (SELECT order_id, sum(amount_cents) AS paid FROM ${table('payment')} WHERE status = 'RECORDED' GROUP BY order_id) p ON p.order_id = o.id`,
    )) as { status: string }[];
    expect(rows.map(({ status }) => status).sort()).toEqual([
      'NOT_REQUIRED',
      'PAID',
      'PARTIALLY_PAID',
      'UNPAID',
    ]);
    expect(await source.getRepository(Payment).countBy({ status: 'VOIDED' })).toBe(1);
  });

  it('preserves M1/M2/M3 manual changes, removed items, voided payments and history on repeated/concurrent seed and a new connection', async () => {
    const first = await source.getRepository(Order).findOneByOrFail({ seedKey: demoOrderKeys[0] });
    const second = await source.getRepository(Order).findOneByOrFail({ seedKey: demoOrderKeys[1] });
    await source.transaction(async (manager) => {
      const locked = await manager
        .getRepository(Order)
        .findOneOrFail({ where: { id: first.id }, lock: { mode: 'pessimistic_write' } });
      locked.customerName = 'Edited fictional customer';
      locked.orderTotalCents = 777777;
      locked.version += 1;
      await manager.save(Order, locked);
      const item = await manager.getRepository(OrderItem).findOneByOrFail({ orderId: first.id });
      await manager.update(OrderItem, item.id, {
        active: false,
        description: 'Manually removed demonstration item',
      });
      await manager.insert(ActivityLog, {
        orderId: first.id,
        actorId,
        action: 'ITEM_REMOVED',
        targetId: item.id,
        reason: null,
        changes: { fields: ['active'] },
      });
    });
    await source.transaction(async (manager) => {
      await manager
        .getRepository(Order)
        .findOneOrFail({ where: { id: second.id }, lock: { mode: 'pessimistic_write' } });
      const payment = await manager
        .getRepository(Payment)
        .findOneByOrFail({ orderId: second.id, status: 'RECORDED' });
      await manager.update(Payment, payment.id, {
        status: 'VOIDED',
        voidedBy: actorId,
        voidedAt: new Date(),
        voidReason: 'Manual fixture correction',
      });
      await manager.insert(ActivityLog, {
        orderId: second.id,
        actorId,
        action: 'PAYMENT_VOIDED',
        targetId: payment.id,
        reason: 'Manual fixture correction',
        changes: {},
      });
    });
    await source.getRepository(User).update(actorId, {
      active: false,
      displayName: 'Edited dispatcher',
      role: 'ADMIN',
      passwordHash: 'edited-fixture-hash',
    });
    await source.getRepository(Crew).update(crewId, { name: 'Edited crew', active: false });
    await source.getRepository(CrewMember).update(membershipId, { active: false });
    const before = await snapshot();
    await seedOrders(source, 'test');
    await Promise.all([
      seedOrders(source, 'test'),
      seedOrders(source, 'test'),
      seedCrews(source, 'test'),
    ]);
    expect(await snapshot()).toBe(before);
    const fresh = createDataSource(readIntegrationConfig(), { schema });
    try {
      await fresh.initialize();
      const persisted = await fresh.getRepository(Order).findOneByOrFail({ id: first.id });
      expect(persisted.customerName).toBe('Edited fictional customer');
      expect(persisted.orderTotalCents).toBe(777777);
      expect(
        await fresh.getRepository(OrderItem).countBy({ orderId: first.id, active: false }),
      ).toBe(1);
      expect(await fresh.getRepository(Payment).countBy({ status: 'VOIDED' })).toBe(2);
    } finally {
      if (fresh.isInitialized) await fresh.destroy();
    }
  });
});
