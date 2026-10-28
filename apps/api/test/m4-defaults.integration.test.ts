import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { readIntegrationConfig } from '../src/config/environment';
import { Crew } from '../src/crews/crew.entity';
import { createDataSource } from '../src/database/data-source';
import { seedCrews } from '../src/database/demo-crews';
import { seedOrders } from '../src/database/demo-orders';
import { seedPlanningDefaults } from '../src/database/demo-planning';
import { User } from '../src/identity/user.entity';
import { Order } from '../src/orders/order.entity';
import { CrewPlanningConfig } from '../src/planning/crew-planning-config.entity';
import { CrewUnavailability } from '../src/planning/crew-unavailability.entity';
import { TaskTemplate } from '../src/planning/task-template.entity';

describe('M4 defaults preserve existing data on isolated Compose test PostgreSQL', () => {
  const schema = `m4_defaults_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource | undefined, source: DataSource;
  beforeAll(async () => {
    const config = readIntegrationConfig();
    admin = createDataSource(config);
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    source = createDataSource(config, { schema });
    await source.initialize();
  });
  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (admin?.isInitialized) {
      if (!/^m4_defaults_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema.');
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });
  const snapshot = async () => {
    const values: Record<string, unknown> = {};
    for (const table of [
      'crew',
      'app_user',
      'delivery_order',
      'order_item',
      'payment',
      'activity_log',
      'crew_planning_config',
      'crew_unavailability',
      'task_template',
    ]) {
      values[table] = await source.query(
        `SELECT row_to_json(t) AS row FROM "${schema}"."${table}" t ORDER BY ${table === 'crew_planning_config' ? 'crew_id' : 'id'}`,
      );
    }
    return values;
  };
  it('migrates once with real defaults and never schedules old M3 orders', async () => {
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
    await source.getRepository(User).save({
      username: 'demo.dispatcher',
      displayName: 'Fictional Dispatcher',
      role: 'DISPATCHER',
      active: true,
      passwordHash: await hashPassword('fixture-only-M4-seed-password'),
    });
    await seedOrders(source, 'test');
    const before = await source.getRepository(Order).find({ order: { id: 'ASC' } });
    await seedPlanningDefaults(source, 'test');
    expect(await source.getRepository(CrewPlanningConfig).count()).toBe(10);
    expect(await source.getRepository(TaskTemplate).count()).toBe(6);
    expect((await source.getRepository(CrewPlanningConfig).find())[0]?.weeklyWindows).toEqual(
      [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '08:00', endTime: '18:00' })),
    );
    expect(await source.getRepository(Order).find({ order: { id: 'ASC' } })).toEqual(before);
    expect(await source.query(`SELECT id FROM "${schema}".appointment`)).toEqual([]);
    await expect(seedPlanningDefaults(source, 'production')).rejects.toThrow('development or test');
  });
  it('repeated and genuinely concurrent defaults preserve windows, unavailability, templates and all M1-M3 rows', async () => {
    const crew = await source
      .getRepository(Crew)
      .findOneOrFail({ where: {}, order: { id: 'ASC' } });
    const author = await source
      .getRepository(User)
      .findOneByOrFail({ username: 'demo.dispatcher' });
    await source.getRepository(Crew).update(crew.id, { name: 'Edited crew', active: false });
    await source
      .getRepository(User)
      .update(author.id, { displayName: 'Edited author', active: false });
    await source.getRepository(CrewPlanningConfig).update(crew.id, {
      weeklyWindows: [{ weekday: 6, startTime: '10:00', endTime: '12:00' }],
      travelBufferMinutes: 75,
      version: 3,
    });
    await source.getRepository(TaskTemplate).update(
      { code: 'CHECK_PRODUCTS' },
      {
        name: 'Edited inactive template',
        active: false,
        required: false,
        severity: 'LOW',
        defaultPriority: 91,
      },
    );
    await source.getRepository(CrewUnavailability).save({
      crewId: crew.id,
      startAt: new Date('2027-01-04T00:00:00Z'),
      endAt: new Date('2027-01-07T00:00:00Z'),
      reason: 'Preserved fictional absence',
      active: true,
      createdBy: author.id,
      updatedBy: author.id,
    });
    const order = await source
      .getRepository(Order)
      .findOneOrFail({ where: {}, order: { id: 'ASC' } });
    await source.getRepository(Order).update(order.id, {
      customerName: 'Edited fictional customer',
      orderTotalCents: 2000000,
      version: 9,
    });
    await source.query(
      `UPDATE "${schema}".order_item SET active=false WHERE id=(SELECT id FROM "${schema}".order_item WHERE order_id=$1 ORDER BY id LIMIT 1)`,
      [order.id],
    );
    const before = await snapshot();
    await seedPlanningDefaults(source, 'test');
    expect(await snapshot()).toEqual(before);
    const barrier = source.createQueryRunner();
    await barrier.connect();
    await barrier.startTransaction('READ COMMITTED');
    const pid = ((await barrier.query('SELECT pg_backend_pid() AS pid')) as { pid: number }[])[0]!
      .pid;
    await barrier.manager
      .getRepository(Crew)
      .findOne({ where: { id: crew.id }, lock: { mode: 'pessimistic_write' } });
    const operations = Promise.all([
      seedPlanningDefaults(source, 'test'),
      seedPlanningDefaults(source, 'test'),
    ]);
    let confirmed = false;
    try {
      const deadline = Date.now() + 1200;
      while (Date.now() < deadline) {
        const rows = (await source.query(
          'WITH RECURSIVE blocked AS (SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))) SELECT COUNT(*)::int AS count FROM blocked',
          [pid],
        )) as { count: number }[];
        if (rows[0]!.count >= 2) {
          confirmed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(confirmed, 'Both independent seed sessions must wait on the Crew resource').toBe(true);
    } finally {
      await barrier.rollbackTransaction();
      await barrier.release();
    }
    await operations;
    expect(await snapshot()).toEqual(before);
    expect(await source.query(`SELECT id FROM "${schema}".appointment`)).toEqual([]);
  });
});
