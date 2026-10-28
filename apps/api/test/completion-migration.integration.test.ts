import { randomBytes, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type {
  AppointmentResponse,
  BackofficeAcceptanceResponse,
  CompletionHistoryResponse,
  CompletionOperationResponse,
  CompletionReadinessResponse,
} from '@furniture-delivery/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { readIntegrationConfig } from '../src/config/environment';
import { createDataSource } from '../src/database/data-source';
import { seedCrews } from '../src/database/demo-crews';
import { demoUsers, seedIdentity } from '../src/database/demo-identity';
import { demoOrderKeys, seedOrders } from '../src/database/demo-orders';
import { seedPlanningDefaults } from '../src/database/demo-planning';
import { CreateCrew1792886400000 } from '../src/database/migrations/1792886400000-CreateCrew';
import { CreateIdentity1792886401000 } from '../src/database/migrations/1792886401000-CreateIdentity';
import { CreateOrders1792886402000 } from '../src/database/migrations/1792886402000-CreateOrders';
import { CreatePlanning1792886403000 } from '../src/database/migrations/1792886403000-CreatePlanning';
import { CreateExecution1792886404000 } from '../src/database/migrations/1792886404000-CreateExecution';
import { CreateEvidence1792886404100 } from '../src/database/migrations/1792886404100-CreateEvidence';
import { CreateEstimates1792886405000 } from '../src/database/migrations/1792886405000-CreateEstimates';
import { CreateReturnVisits1792886405100 } from '../src/database/migrations/1792886405100-CreateReturnVisits';
import { Crew } from '../src/crews/crew.entity';
import { User } from '../src/identity/user.entity';
import { CrewMember } from '../src/identity/crew-member.entity';
import { Order } from '../src/orders/order.entity';
import { OrderItem } from '../src/orders/order-item.entity';
import { Appointment } from '../src/planning/appointment.entity';
import { FinishReport } from '../src/execution/finish-report.entity';
import { ExecutionNote } from '../src/evidence/execution-note.entity';
import { SignatureConfirmation } from '../src/acceptance/signature-confirmation.entity';
import {
  acknowledgeAcceptanceVisit,
  bytesHash,
  completeAcceptanceTasks,
  finishAcceptanceTeam,
  setAcceptanceQuantities,
} from './acceptance-fixture';
import {
  createEvidenceFixture,
  evidenceJson as json,
  freshOperation,
  type EvidenceContext,
  type EvidenceFixture,
} from './evidence-fixture';

const migrationsM6 = [
  CreateCrew1792886400000,
  CreateIdentity1792886401000,
  CreateOrders1792886402000,
  CreatePlanning1792886403000,
  CreateExecution1792886404000,
  CreateEvidence1792886404100,
  CreateEstimates1792886405000,
  CreateReturnVisits1792886405100,
];
const NOW = '2030-01-07T08:00:00.000Z';
async function schemaColumns(source: DataSource, schema: string) {
  return (await source.query(
    'SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,ordinal_position',
    [schema],
  )) as { table_name: string; column_name: string }[];
}
async function digest(
  source: DataSource,
  schema: string,
  columns?: { table_name: string; column_name: string }[],
) {
  const tables = new Map<string, string[]>();
  for (const column of columns ?? (await schemaColumns(source, schema))) {
    if (column.table_name === 'typeorm_migrations') continue;
    const names = tables.get(column.table_name) ?? [];
    names.push(column.column_name);
    tables.set(column.table_name, names);
  }
  const result: Record<string, unknown> = {};
  for (const [table, names] of tables) {
    if (!/^[a-z_]+$/.test(table) || names.some((name) => !/^[a-z_]+$/.test(name)))
      throw new Error('Unexpected fixture SQL identifier');
    result[table] = await source.query(
      `SELECT md5(row_to_json(t)::text) AS digest FROM (SELECT ${names.map((name) => '"' + name + '"').join(',')} FROM "${schema}"."${table}") t ORDER BY digest`,
    );
  }
  return result;
}
async function demoActors(source: DataSource) {
  const passwordHash = await hashPassword(randomBytes(24).toString('base64url'));
  for (const { crewCode, ...input } of demoUsers) {
    const user = await source.getRepository(User).save({ ...input, passwordHash, active: true });
    if (crewCode) {
      const crew = await source.getRepository(Crew).findOneByOrFail({ code: crewCode });
      await source
        .getRepository(CrewMember)
        .save({ userId: user.id, crewId: crew.id, active: true });
    }
  }
}

describe('M7 additive migration preserves a real M6 aggregate and never invents signatures or closure', () => {
  const schema = 'm7_upgrade_' + randomUUID().replaceAll('-', ''),
    assignmentId = randomUUID(),
    taskId = randomUUID(),
    followAssignmentId = randomUUID(),
    followTaskId = randomUUID(),
    requestId = randomUUID(),
    scopeKey = randomUUID();
  let admin: DataSource, source: DataSource;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    const config = readIntegrationConfig();
    admin = createDataSource(config);
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    source = createDataSource(config, { schema });
    source.setOptions({ migrations: migrationsM6 });
    await source.initialize();
    expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(
      migrationsM6.map((migration) => migration.name),
    );
    await seedCrews(source, 'test');
    await demoActors(source);
    await seedOrders(source, 'test');
    await seedPlanningDefaults(source, 'test');
    const dispatcher = await source
        .getRepository(User)
        .findOneByOrFail({ username: 'demo.dispatcher' }),
      employee = await source
        .getRepository(User)
        .findOneByOrFail({ username: 'demo.crew01.member01' }),
      crew = await source.getRepository(Crew).findOneByOrFail({ code: 'DEMO-01' }),
      order = await source.getRepository(Order).findOneByOrFail({ seedKey: demoOrderKeys[0] });
    await source
      .getRepository(Order)
      .update(order.id, { customerName: 'Edited fictional M6 customer', version: 11 });
    const item = await source.getRepository(OrderItem).findOneByOrFail({ orderId: order.id });
    await source
      .getRepository(OrderItem)
      .update(item.id, { deliveredQuantity: 1, fulfillmentVersion: 3 });
    const visit = await source.getRepository(Appointment).save({
      orderId: order.id,
      plannedStartAt: new Date(NOW),
      plannedEndAt: new Date('2030-01-07T09:00:00.000Z'),
      durationMinutes: 60,
      status: 'SCHEDULED',
      confirmationStatus: 'CONFIRMED',
      confirmedAt: new Date(NOW),
      confirmedBy: dispatcher.id,
      notes: 'Preserved M6 private appointment note',
      version: 7,
      idempotencyKey: freshOperation(),
      fingerprint: 'a'.repeat(64),
      createdBy: dispatcher.id,
      updatedBy: dispatcher.id,
    });
    await source.query(
      `INSERT INTO "${schema}".crew_assignment(id,appointment_id,crew_id,status,travel_buffer_minutes,execution_status,execution_version,departed_at,arrived_at,actual_start_at,actual_end_at,estimated_finish_at,estimate_updated_at,estimate_updated_by,estimate_reason,estimate_version) VALUES($1,$2,$3,'ASSIGNED',45,'PARTIALLY_COMPLETED',5,$4,$4,$4,$4,'2030-01-07T10:30:00Z',$4,$5,'Preserved M6 forecast',2)`,
      [assignmentId, visit.id, crew.id, NOW, employee.id],
    );
    await source.query(
      `INSERT INTO "${schema}".task(id,assignment_id,name,description,required,severity,priority) VALUES($1,$2,'Persisted M6 pending work','Unchanged historical source task',true,'HIGH',15)`,
      [taskId, assignmentId],
    );
    const report = await source.getRepository(FinishReport).save({
      orderId: order.id,
      appointmentId: visit.id,
      assignmentId,
      outcome: 'PARTIALLY_COMPLETED',
      summary: 'Preserved M6 immutable source report',
      reason: 'Fictional missing fitting',
      remainingWork: 'Finish source task',
      quantityScope: 'ACCUMULATED_ORDER',
      taskResults: [],
      quantities: [],
      knownIssueIds: [],
      attachmentIds: [],
      authorId: employee.id,
      actualEndAt: new Date(NOW),
    });
    await source.query(
      `INSERT INTO "${schema}".return_visit_request(id,order_id,appointment_id,assignment_id,finish_report_id,status,version,reason,remaining_work,author_id,created_at,updated_at,updated_by) VALUES($1,$2,$3,$4,$5,'PLANNED',2,'Preserved M6 return reason','Preserved remaining work',$6,$7,$7,$8)`,
      [requestId, order.id, visit.id, assignmentId, report.id, employee.id, NOW, dispatcher.id],
    );
    const follow = await source.getRepository(Appointment).save({
      orderId: order.id,
      plannedStartAt: new Date('2030-01-07T11:00:00.000Z'),
      plannedEndAt: new Date('2030-01-07T12:00:00.000Z'),
      durationMinutes: 60,
      status: 'SCHEDULED',
      confirmationStatus: 'NEEDS_CONFIRMATION',
      notes: 'Preserved M6 follow-up',
      version: 1,
      idempotencyKey: freshOperation(),
      fingerprint: 'b'.repeat(64),
      createdBy: dispatcher.id,
      updatedBy: dispatcher.id,
    });
    await source.query(
      `INSERT INTO "${schema}".crew_assignment(id,appointment_id,crew_id,status,travel_buffer_minutes) VALUES($1,$2,$3,'ASSIGNED',30)`,
      [followAssignmentId, follow.id, crew.id],
    );
    await source.query(
      `INSERT INTO "${schema}".task(id,assignment_id,source_task_id,return_scope_key,name,description,required,severity,priority) VALUES($1,$2,$3,$4,'Persisted M6 pending work','Preserved carried task',true,'HIGH',15)`,
      [followTaskId, followAssignmentId, taskId, scopeKey],
    );
    await source.query(
      `INSERT INTO "${schema}".return_visit_attempt(order_id,request_id,appointment_id,scope,created_by) VALUES($1,$2,$3,$4,$5)`,
      [
        order.id,
        requestId,
        follow.id,
        JSON.stringify({
          tasks: [
            {
              key: scopeKey,
              sourceTaskId: taskId,
              sourceAssignmentId: assignmentId,
              name: 'Persisted M6 pending work',
              description: 'Preserved carried task',
              required: true,
              severity: 'HIGH',
              priority: 15,
              crewId: crew.id,
              addedReason: null,
            },
          ],
          itemTargets: [
            { itemId: item.id, deliveredQuantity: item.quantity, assembledQuantity: 0 },
          ],
        }),
        dispatcher.id,
      ],
    );
    await source.getRepository(ExecutionNote).save({
      orderId: order.id,
      appointmentId: visit.id,
      assignmentId,
      itemId: null,
      visibility: 'CREW_VISIBLE',
      text: 'Preserved M6 execution evidence',
      authorId: employee.id,
    });
  }, 30000);
  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (admin?.isInitialized) {
      if (!/^m7_upgrade_[a-f0-9]{32}$/.test(schema))
        throw new Error('Unsafe isolated upgrade cleanup');
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
    vi.useRealTimers();
  });
  it('applies exactly the two M7 migrations, preserves all old columns/rows and defaults every existing order pointer to null', async () => {
    const oldColumns = await schemaColumns(source, schema),
      before = await digest(source, schema, oldColumns);
    await source.destroy();
    source = createDataSource(readIntegrationConfig(), { schema });
    await source.initialize();
    expect((await source.runMigrations()).map((migration) => migration.name)).toEqual([
      'CreateAcceptance1792886406000',
      'CreateCompletion1792886406100',
    ]);
    expect(await digest(source, schema, oldColumns)).toEqual(before);
    expect(
      await source.query(
        `SELECT id FROM "${schema}".delivery_order WHERE current_completion_id IS NOT NULL`,
      ),
    ).toEqual([]);
    for (const table of [
      'acceptance_snapshot',
      'acceptance_slot',
      'signature_confirmation',
      'exception_review',
      'completion_record',
      'order_reopen_event',
    ])
      expect(await source.query(`SELECT id FROM "${schema}"."${table}"`)).toEqual([]);
    expect(await source.runMigrations()).toHaveLength(0);
  });
});

describe('M7 fresh migration, repeated seed and durable bytea confirmation history', () => {
  let f: EvidenceFixture;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    f = await createEvidenceFixture('m7_complete', (config, root) => ({
      ...config,
      storage: { root },
    }));
  }, 30000);
  afterAll(async () => {
    await f?.close();
    vi.useRealTimers();
  });
  const ready = async (id: string) =>
    (
      await json<CompletionReadinessResponse>(
        await f.call(f.dispatcher, '/orders/' + id + '/completion-readiness'),
      )
    ).readiness;
  const complete = async (id: string) =>
    await json<CompletionOperationResponse>(
      await f.call(f.dispatcher, '/orders/' + id + '/complete', 'POST', {
        operationKey: freshOperation(),
        expectedVersion: (await ready(id)).orderVersion,
        reason: 'Explicit preserved completion decision',
      }),
    );
  it('applies all ten migrations on fresh schema, repeats without changes and starts new orders with a null completion pointer', async () => {
    const rows = (await f.source.query(
      `SELECT name FROM "${f.schema}".typeorm_migrations ORDER BY id`,
    )) as { name: string }[];
    expect(rows.map((row) => row.name)).toEqual([
      ...migrationsM6.map((migration) => migration.name),
      'CreateAcceptance1792886406000',
      'CreateCompletion1792886406100',
    ]);
    expect(await f.source.runMigrations()).toHaveLength(0);
    const ctx = await f.context();
    expect(
      await f.source.query(
        `SELECT current_completion_id FROM "${f.schema}".delivery_order WHERE id=$1`,
        [ctx.order.id],
      ),
    ).toEqual([{ current_completion_id: null }]);
  });
  it('preserves signed PNG bytes, approved absence, invalidated documents and completion/reopen/reclose history through two normal full seeds', async () => {
    await seedCrews(f.source, 'test');
    await demoActors(f.source);
    const seed = async () => {
      await seedCrews(f.source, 'test');
      await seedIdentity(f.source, 'test');
      await seedOrders(f.source, 'test');
      await seedPlanningDefaults(f.source, 'test');
    };
    await seed();
    expect(
      await f.source.query(
        `SELECT count(*)::int AS count FROM "${f.schema}".delivery_order WHERE seed_key=ANY($1::varchar[])`,
        [demoOrderKeys],
      ),
    ).toEqual([{ count: demoOrderKeys.length }]);
    const seeded = await f.source
      .getRepository(Order)
      .findOneByOrFail({ seedKey: demoOrderKeys[0] });
    const assertSeedKey = async (step: string) => {
      const rows = await f.source.query(
        `SELECT seed_key FROM "${f.schema}".delivery_order WHERE id=$1`,
        [seeded.id],
      );
      expect(rows, 'Seed key must survive ' + step).toEqual([{ seed_key: demoOrderKeys[0] }]);
    };
    await assertSeedKey('full seed and existing demo selection');
    await f.source
      .getRepository(Order)
      .update(seeded.id, { customerName: 'User-edited fictional signed demo customer' });
    await assertSeedKey('fixture customer edit');
    const crew = await f.makeCrew(),
      actors = [
        [await f.makeActor('CREW_MEMBER', crew.id), await f.makeActor('CREW_MEMBER', crew.id)],
      ];
    const planned = await f.planning.create(
      seeded.id,
      {
        localStart: '2030-01-07T09:00',
        durationMinutes: 60,
        crewIds: [crew.id],
        idempotencyKey: freshOperation(),
      },
      f.dispatcher.user.id,
    );
    await assertSeedKey('planning create');
    const confirmed = await json<AppointmentResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + seeded.id + '/appointments/' + planned.appointment.id + '/confirm',
        'POST',
        { expectedVersion: planned.appointment.version },
      ),
      201,
    );
    await assertSeedKey('appointment confirmation');
    const ctx: EvidenceContext = {
      order: confirmed.order,
      appointmentId: confirmed.appointment.id,
      appointmentVersion: confirmed.appointment.version,
      crews: [crew],
      actors,
      assignmentIds: [
        confirmed.appointment.assignments.find((assignment) => assignment.status === 'ASSIGNED')!
          .id,
      ],
    };
    await f.start(ctx);
    await assertSeedKey('execution start');
    await completeAcceptanceTasks(f, actors[0]![0]!, ctx.assignmentIds[0]!);
    await assertSeedKey('task results');
    await setAcceptanceQuantities(f, actors[0]![0]!, ctx.assignmentIds[0]!);
    await assertSeedKey('quantity results');
    await finishAcceptanceTeam(f, ctx);
    await assertSeedKey('team finish');
    const doc = await acknowledgeAcceptanceVisit(f, ctx, true, (step) =>
      assertSeedKey('first acknowledgement: ' + step),
    );
    const first = await complete(ctx.order.id);
    await assertSeedKey('first completion');
    let state = await ready(ctx.order.id);
    await json<CompletionOperationResponse>(
      await f.call(f.dispatcher, '/orders/' + ctx.order.id + '/reopen', 'POST', {
        operationKey: freshOperation(),
        expectedVersion: state.orderVersion,
        expectedCompletionId: first.readiness.currentCompletion!.id,
        reason: 'Preserved explicit reopening history',
      }),
    );
    await assertSeedKey('manual reopen');
    await complete(ctx.order.id);
    await assertSeedKey('second completion');
    await json<BackofficeAcceptanceResponse>(
      await f.call(f.dispatcher, '/acceptance/' + doc.snapshot.id + '/invalidate', 'POST', {
        operationKey: freshOperation(),
        expectedVersion: doc.snapshot.version,
        reason: 'Preserved explicit document correction',
      }),
    );
    await assertSeedKey('snapshot invalidation and automatic reopen');
    const next = await acknowledgeAcceptanceVisit(f, ctx, false, (step) =>
      assertSeedKey('second acknowledgement: ' + step),
    );
    const latest = await complete(ctx.order.id);
    await assertSeedKey('third completion');
    expect(next.snapshot.id).not.toBe(doc.snapshot.id);
    const recorded = await json<CompletionHistoryResponse>(
      await f.call(f.dispatcher, '/orders/' + ctx.order.id + '/completion-history'),
    );
    expect(recorded.completions).toHaveLength(3);
    expect(recorded.reopenEvents).toHaveLength(2);
    const signedRows = await f.source
      .getRepository(SignatureConfirmation)
      .findBy({ method: 'SIGNED' });
    expect(signedRows.length).toBeGreaterThanOrEqual(3);
    const imageHashes = new Map<string, string>();
    for (const signature of signedRows) {
      const response = await f.call(
        f.dispatcher,
        '/acceptance/' + signature.snapshotId + '/signatures/' + signature.id + '/content',
      );
      expect(response.status).toBe(200);
      imageHashes.set(signature.id, bytesHash(new Uint8Array(await response.arrayBuffer())));
    }
    await f.source.getRepository(User).update(ctx.actors[0]![0]!.user.id, {
      displayName: 'User-edited name after historical signatures',
    });
    expect(
      await f.source.query(`SELECT seed_key FROM "${f.schema}".delivery_order WHERE id=$1`, [
        ctx.order.id,
      ]),
    ).toEqual([{ seed_key: demoOrderKeys[0] }]);
    expect(
      await f.source.query(
        `SELECT count(*)::int AS count FROM "${f.schema}".delivery_order WHERE seed_key=ANY($1::varchar[])`,
        [demoOrderKeys],
      ),
    ).toEqual([{ count: demoOrderKeys.length }]);
    const before = await digest(f.source, f.schema);
    await seed();
    expect(await digest(f.source, f.schema)).toEqual(before);
    await seed();
    expect(await digest(f.source, f.schema)).toEqual(before);
    expect(
      await json<CompletionHistoryResponse>(
        await f.call(f.dispatcher, '/orders/' + ctx.order.id + '/completion-history'),
      ),
    ).toEqual(recorded);
    state = await ready(ctx.order.id);
    expect(state.currentCompletion!.id).toBe(latest.readiness.currentCompletion!.id);
    expect(
      await f.source.query(
        `SELECT current_completion_id FROM "${f.schema}".delivery_order WHERE id=$1`,
        [ctx.order.id],
      ),
    ).toEqual([{ current_completion_id: latest.readiness.currentCompletion!.id }]);
    for (const signature of signedRows) {
      const response = await f.call(
        f.dispatcher,
        '/acceptance/' + signature.snapshotId + '/signatures/' + signature.id + '/content',
      );
      expect(response.status).toBe(200);
      expect(bytesHash(new Uint8Array(await response.arrayBuffer()))).toBe(
        imageHashes.get(signature.id),
      );
    }
  });
});
