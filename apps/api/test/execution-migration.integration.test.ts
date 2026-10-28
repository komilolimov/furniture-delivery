import { randomBytes, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { readIntegrationConfig } from '../src/config/environment';
import { createDataSource } from '../src/database/data-source';
import { seedCrews } from '../src/database/demo-crews';
import { demoUsers, seedIdentity } from '../src/database/demo-identity';
import { seedOrders } from '../src/database/demo-orders';
import { seedPlanningDefaults } from '../src/database/demo-planning';
import { DatabaseService } from '../src/database/database.service';
import { CreateCrew1792886400000 } from '../src/database/migrations/1792886400000-CreateCrew';
import { CreateIdentity1792886401000 } from '../src/database/migrations/1792886401000-CreateIdentity';
import { CreateOrders1792886402000 } from '../src/database/migrations/1792886402000-CreateOrders';
import { CreatePlanning1792886403000 } from '../src/database/migrations/1792886403000-CreatePlanning';
import { Crew } from '../src/crews/crew.entity';
import { User } from '../src/identity/user.entity';
import { CrewMember } from '../src/identity/crew-member.entity';
import { ExecutionService } from '../src/execution/execution.service';

const legacyMigrations = [
  CreateCrew1792886400000,
  CreateIdentity1792886401000,
  CreateOrders1792886402000,
  CreatePlanning1792886403000,
];
describe('M5 migration and repeated full default seed preserve actual work', () => {
  const schema = 'm5_migrate_' + randomUUID().replaceAll('-', ''),
    orderId = randomUUID(),
    itemId = randomUUID(),
    appointmentId = randomUUID(),
    assignmentId = randomUUID(),
    taskId = randomUUID();
  let admin: DataSource | undefined,
    source: DataSource,
    crewId: string,
    actorId: string,
    authorId: string;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-07T08:00:00.000Z'));
    const config = readIntegrationConfig();
    admin = createDataSource(config);
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    source = createDataSource(config, { schema });
    source.setOptions({ migrations: legacyMigrations });
    await source.initialize();
    expect((await source.runMigrations()).map((m) => m.name)).toEqual(
      legacyMigrations.map((m) => m.name),
    );
    await seedCrews(source, 'test');
    const passwordHash = await hashPassword(randomBytes(24).toString('base64url'));
    for (const { crewCode, ...user } of demoUsers) {
      const actor = await source.getRepository(User).save({ ...user, passwordHash, active: true });
      if (user.username === 'demo.dispatcher') authorId = actor.id;
      if (crewCode) {
        const crew = await source.getRepository(Crew).findOneByOrFail({ code: crewCode });
        await source
          .getRepository(CrewMember)
          .save({ crewId: crew.id, userId: actor.id, active: true });
        if (user.username === 'demo.crew01.member01') {
          actorId = actor.id;
          crewId = crew.id;
        }
      }
    }
    await seedPlanningDefaults(source, 'test');
    await source.query(
      `INSERT INTO "${schema}".delivery_order(id,seed_key,customer_name,phone_numbers,address,city,country,service_type,work_description,estimated_duration_minutes,order_total_cents,created_by,updated_by) VALUES($1,'m3-demo-order-01','Preserved legacy customer','["+39 000"]','Legacy fixture address','Roma','Italy','DELIVERY_AND_ASSEMBLY','Legacy assembly',60,100000,$2,$2)`,
      [orderId, authorId],
    );
    await source.query(
      `INSERT INTO "${schema}".order_item(id,order_id,description,quantity,requires_assembly) VALUES($1,$2,'Legacy furniture',3,true)`,
      [itemId, orderId],
    );
    await source.query(
      `INSERT INTO "${schema}".appointment(id,order_id,planned_start_at,planned_end_at,duration_minutes,confirmation_status,confirmed_at,confirmed_by,version,idempotency_key,fingerprint,created_by,updated_by,notes) VALUES($1,$2,'2030-01-07T08:00:00Z','2030-01-07T09:00:00Z',60,'CONFIRMED','2030-01-06T10:00:00Z',$3,7,'legacy-migration-appointment',repeat('a',64),$3,$3,'Preserved internal appointment note')`,
      [appointmentId, orderId, authorId],
    );
    await source.query(
      `INSERT INTO "${schema}".crew_assignment(id,appointment_id,crew_id,status,travel_buffer_minutes) VALUES($1,$2,$3,'ASSIGNED',30)`,
      [assignmentId, appointmentId, crewId],
    );
    await source.query(
      `INSERT INTO "${schema}".task(id,assignment_id,name,description,required,severity,priority) VALUES($1,$2,'Legacy snapshot task','Preserved snapshot description',true,'HIGH',15)`,
      [taskId, assignmentId],
    );
    await source.query(
      `INSERT INTO "${schema}".payment(order_id,amount_cents,paid_on,method,idempotency_key,fingerprint,created_by,note) VALUES($1,2500,'2026-10-25','CASH','legacy-migration-payment',repeat('b',64),$2,'Preserved legacy payment')`,
      [orderId, authorId],
    );
    await source.query(
      `INSERT INTO "${schema}".activity_log(order_id,actor_id,action,target_id,changes) VALUES($1,$2,'ORDER_CREATED',$1,'{"source":"legacy-fixture"}')`,
      [orderId, authorId],
    );
  }, 30000);
  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (admin?.isInitialized) {
      if (!/^m5_migrate_[a-f0-9]{32}$/.test(schema))
        throw new Error('Unsafe isolated schema cleanup');
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
    vi.useRealTimers();
  });
  async function columns() {
    return (await source.query(
      'SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,ordinal_position',
      [schema],
    )) as { table_name: string; column_name: string }[];
  }
  async function digest(selected?: { table_name: string; column_name: string }[]) {
    const byTable = new Map<string, string[]>();
    for (const col of selected ?? (await columns())) {
      if (col.table_name === 'typeorm_migrations') continue;
      const cols = byTable.get(col.table_name) ?? [];
      cols.push(col.column_name);
      byTable.set(col.table_name, cols);
    }
    const result: Record<string, unknown> = {};
    for (const [table, cols] of byTable) {
      if (!/^[a-z_]+$/.test(table) || cols.some((c) => !/^[a-z_]+$/.test(c)))
        throw new Error('Unexpected SQL identifier');
      result[table] = await source.query(
        `SELECT md5(row_to_json(t)::text) AS digest FROM (SELECT ${cols.map((c) => '"' + c + '"').join(',')} FROM "${schema}"."${table}") t ORDER BY digest`,
      );
    }
    return result;
  }
  it('adds defaults to real M1–M4 rows without changing any old business field, confirmation, payment or snapshot', async () => {
    const oldColumns = await columns(),
      before = await digest(oldColumns),
      config = readIntegrationConfig();
    await source.destroy();
    source = createDataSource(config, { schema });
    await source.initialize();
    const applied = (await source.runMigrations()).map((m) => m.name);
    expect(applied).toEqual([
      'CreateExecution1792886404000',
      'CreateEvidence1792886404100',
      'CreateEstimates1792886405000',
      'CreateReturnVisits1792886405100',
      'CreateAcceptance1792886406000',
      'CreateCompletion1792886406100',
    ]);
    expect(await digest(oldColumns)).toEqual(before);
    expect(
      await source.query(
        `SELECT execution_status,execution_version,departed_at,arrived_at,actual_start_at,actual_end_at FROM "${schema}".crew_assignment WHERE id=$1`,
        [assignmentId],
      ),
    ).toEqual([
      {
        execution_status: 'NOT_STARTED',
        execution_version: 1,
        departed_at: null,
        arrived_at: null,
        actual_start_at: null,
        actual_end_at: null,
      },
    ]);
    expect(
      await source.query(
        `SELECT result_status,result_version,done_by,done_at,result_reason FROM "${schema}".task WHERE id=$1`,
        [taskId],
      ),
    ).toEqual([
      {
        result_status: 'PENDING',
        result_version: 1,
        done_by: null,
        done_at: null,
        result_reason: null,
      },
    ]);
    expect(
      await source.query(
        `SELECT delivered_quantity,assembled_quantity,fulfillment_version FROM "${schema}".order_item WHERE id=$1`,
        [itemId],
      ),
    ).toEqual([{ delivered_quantity: 0, assembled_quantity: 0, fulfillment_version: 1 }]);
    for (const table of ['execution_receipt', 'finish_report', 'return_visit_request'])
      expect(await source.query(`SELECT id FROM "${schema}"."${table}"`)).toEqual([]);
    expect(await source.runMigrations()).toHaveLength(0);
  });
  it('repeats the complete normal seed without resetting persisted outcomes, quantities, requests, credentials or history', async () => {
    const seed = async () => {
      await seedCrews(source, 'test');
      await seedIdentity(source, 'test');
      await seedOrders(source, 'test');
      await seedPlanningDefaults(source, 'test');
    };
    await seed();
    const service = new ExecutionService(new DatabaseService(source)),
      actor = { id: actorId };
    let response = await service.action(actor, assignmentId, 'DEPART', {
      operationKey: randomUUID(),
      expectedExecutionVersion: 1,
      expectedAppointmentVersion: 7,
    });
    response = await service.action(actor, assignmentId, 'ARRIVE', {
      operationKey: randomUUID(),
      expectedExecutionVersion: response.assignment.execution.version,
    });
    response = await service.action(actor, assignmentId, 'START', {
      operationKey: randomUUID(),
      expectedExecutionVersion: response.assignment.execution.version,
    });
    expect(response.assignment.execution.status).toBe('IN_PROGRESS');
    response = await service.taskResult(actor, assignmentId, taskId, {
      operationKey: randomUUID(),
      expectedTaskVersion: 1,
      resultStatus: 'DONE',
    });
    expect(response.assignment.tasks.find((t) => t.id === taskId)?.resultStatus).toBe('DONE');
    response = await service.fulfillment(actor, assignmentId, itemId, {
      operationKey: randomUUID(),
      expectedFulfillmentVersion: 1,
      deliveredQuantity: 2,
      assembledQuantity: 1,
    });
    response = await service.finish(actor, assignmentId, {
      operationKey: randomUUID(),
      expectedExecutionVersion: response.assignment.execution.version,
      outcome: 'PARTIALLY_COMPLETED',
      summary: 'Persisted partial fixture',
      reason: 'Missing parts',
      remainingWork: 'One delivery and two assemblies',
      returnVisitRequired: true,
      returnReason: 'Bring fittings',
    });
    expect(response.assignment.execution.status).toBe('PARTIALLY_COMPLETED');
    const before = await digest();
    await seed();
    expect(await digest()).toEqual(before);
    await seed();
    expect(await digest()).toEqual(before);
    expect((await service.detail(actor, assignmentId)).assignment).toEqual(response.assignment);
  });
});
