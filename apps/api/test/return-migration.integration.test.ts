import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type {
  AppointmentResponse,
  AttachmentResponse,
  CrewAssignmentResponse,
  PlanReturnVisitCommand,
  ReturnRequestResponse,
} from '@furniture-delivery/contracts';
import sharp from 'sharp';
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
import { Crew } from '../src/crews/crew.entity';
import { User } from '../src/identity/user.entity';
import { CrewMember } from '../src/identity/crew-member.entity';
import { Order } from '../src/orders/order.entity';
import { OrderItem } from '../src/orders/order-item.entity';
import { Appointment } from '../src/planning/appointment.entity';
import { FinishReport } from '../src/execution/finish-report.entity';
import { ExecutionNote } from '../src/evidence/execution-note.entity';
import {
  createEvidenceFixture,
  evidenceJson as json,
  freshOperation,
  type EvidenceFixture,
} from './evidence-fixture';

const oldMigrations = [
  CreateCrew1792886400000,
  CreateIdentity1792886401000,
  CreateOrders1792886402000,
  CreatePlanning1792886403000,
  CreateExecution1792886404000,
  CreateEvidence1792886404100,
];
const NOW = '2030-01-07T08:00:00.000Z';
async function columns(source: DataSource, schema: string) {
  return (await source.query(
    'SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,ordinal_position',
    [schema],
  )) as { table_name: string; column_name: string }[];
}
async function digest(
  source: DataSource,
  schema: string,
  selected?: { table_name: string; column_name: string }[],
) {
  const byTable = new Map<string, string[]>();
  for (const column of selected ?? (await columns(source, schema))) {
    if (column.table_name === 'typeorm_migrations') continue;
    const names = byTable.get(column.table_name) ?? [];
    names.push(column.column_name);
    byTable.set(column.table_name, names);
  }
  const result: Record<string, unknown> = {};
  for (const [table, names] of byTable) {
    if (!/^[a-z_]+$/.test(table) || names.some((name) => !/^[a-z_]+$/.test(name)))
      throw new Error('Unexpected fixture SQL identifier');
    result[table] = await source.query(
      `SELECT md5(row_to_json(t)::text) AS digest FROM (SELECT ${names.map((name) => '"' + name + '"').join(',')} FROM "${schema}"."${table}") t ORDER BY digest`,
    );
  }
  return result;
}
async function createDemoActors(source: DataSource) {
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

describe('M6 migrations preserve an existing M5 aggregate without rewriting applied migrations', () => {
  const schema = 'm6_upgrade_' + randomUUID().replaceAll('-', ''),
    assignmentId = randomUUID(),
    taskId = randomUUID(),
    requestId = randomUUID();
  let admin: DataSource, source: DataSource;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    const config = readIntegrationConfig();
    admin = createDataSource(config);
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    source = createDataSource(config, { schema });
    source.setOptions({ migrations: oldMigrations });
    await source.initialize();
    expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(
      oldMigrations.map((migration) => migration.name),
    );
    await seedCrews(source, 'test');
    await createDemoActors(source);
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
      .update(order.id, { customerName: 'Edited fictional M5 customer', version: 9 });
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
      notes: 'Preserved private M5 note',
      version: 7,
      idempotencyKey: freshOperation(),
      fingerprint: 'a'.repeat(64),
      createdBy: dispatcher.id,
      updatedBy: dispatcher.id,
    });
    await source.query(
      `INSERT INTO "${schema}".crew_assignment(id,appointment_id,crew_id,status,travel_buffer_minutes,execution_status,execution_version,departed_at,arrived_at,actual_start_at,actual_end_at) VALUES($1,$2,$3,'ASSIGNED',45,'PARTIALLY_COMPLETED',5,$4,$4,$4,$4)`,
      [assignmentId, visit.id, crew.id, NOW],
    );
    await source.query(
      `INSERT INTO "${schema}".task(id,assignment_id,name,description,required,severity,priority) VALUES($1,$2,'Persisted M5 pending work','Unchanged source snapshot',true,'HIGH',15)`,
      [taskId, assignmentId],
    );
    const report = await source.getRepository(FinishReport).save({
      orderId: order.id,
      appointmentId: visit.id,
      assignmentId,
      outcome: 'PARTIALLY_COMPLETED',
      summary: 'Persisted M5 source report',
      reason: 'Fictional missing material',
      remainingWork: 'Finish one source task',
      quantityScope: 'ACCUMULATED_ORDER',
      taskResults: [],
      quantities: [],
      knownIssueIds: [],
      attachmentIds: [],
      authorId: employee.id,
      actualEndAt: new Date(NOW),
    });
    await source.query(
      `INSERT INTO "${schema}".return_visit_request(id,order_id,appointment_id,assignment_id,finish_report_id,status,reason,remaining_work,author_id,created_at) VALUES($1,$2,$3,$4,$5,'OPEN','Original M5 reason','Original M5 remaining work',$6,$7)`,
      [requestId, order.id, visit.id, assignmentId, report.id, employee.id, NOW],
    );
    await source.getRepository(ExecutionNote).save({
      orderId: order.id,
      appointmentId: visit.id,
      assignmentId,
      itemId: null,
      visibility: 'CREW_VISIBLE',
      text: 'Persisted M5 evidence note',
      authorId: employee.id,
    });
  }, 30000);
  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (admin?.isInitialized) {
      if (!/^m6_upgrade_[a-f0-9]{32}$/.test(schema))
        throw new Error('Unsafe isolated upgrade cleanup');
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
    vi.useRealTimers();
  });
  it('adds estimates and return lifecycle metadata while preserving every pre-existing business column and then applies no further migration', async () => {
    const oldColumns = await columns(source, schema),
      before = await digest(source, schema, oldColumns);
    await source.destroy();
    source = createDataSource(readIntegrationConfig(), { schema });
    await source.initialize();
    expect((await source.runMigrations()).map((migration) => migration.name)).toEqual([
      'CreateEstimates1792886405000',
      'CreateReturnVisits1792886405100',
      'CreateAcceptance1792886406000',
      'CreateCompletion1792886406100',
    ]);
    expect(await digest(source, schema, oldColumns)).toEqual(before);
    expect(
      await source.query(
        `SELECT estimated_finish_at,estimate_version FROM "${schema}".crew_assignment WHERE id=$1`,
        [assignmentId],
      ),
    ).toEqual([{ estimated_finish_at: null, estimate_version: 1 }]);
    expect(
      await source.query(
        `SELECT source_task_id,return_scope_key FROM "${schema}".task WHERE id=$1`,
        [taskId],
      ),
    ).toEqual([{ source_task_id: null, return_scope_key: null }]);
    expect(
      await source.query(
        `SELECT status,version,updated_at=created_at AS preserved_time,updated_by,resolved_at,resolved_by,resolution FROM "${schema}".return_visit_request WHERE id=$1`,
        [requestId],
      ),
    ).toEqual([
      {
        status: 'OPEN',
        version: 1,
        preserved_time: true,
        updated_by: null,
        resolved_at: null,
        resolved_by: null,
        resolution: null,
      },
    ]);
    expect(await source.query(`SELECT id FROM "${schema}".return_visit_attempt`)).toEqual([]);
    expect(await source.runMigrations()).toHaveLength(0);
  });
});

describe('M6 fresh migration and repeated normal seed preserve estimates, attempts, scopes and M5 evidence', () => {
  let f: EvidenceFixture;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    f = await createEvidenceFixture('m6_return', (config, root) => ({
      ...config,
      storage: { root },
    }));
  }, 30000);
  afterAll(async () => {
    await f?.close();
    vi.useRealTimers();
  });
  it('runs all current migrations once on fresh schema and repeats without changes', async () => {
    const rows = (await f.source.query(
      `SELECT name FROM "${f.schema}".typeorm_migrations ORDER BY id`,
    )) as { name: string }[];
    expect(rows.map((row) => row.name)).toEqual([
      ...oldMigrations.map((migration) => migration.name),
      'CreateEstimates1792886405000',
      'CreateReturnVisits1792886405100',
      'CreateAcceptance1792886406000',
      'CreateCompletion1792886406100',
    ]);
    expect(await f.source.runMigrations()).toHaveLength(0);
  });
  it('preserves the edited demo aggregate, estimate history, cancelled attempt and a new current plan through two full seeds', async () => {
    const ctx = await f.context(),
      actor = ctx.actors[0]![0]!,
      id = ctx.assignmentIds[0]!;
    await f.source.getRepository(Order).update(ctx.order.id, {
      seedKey: demoOrderKeys[0],
      customerName: 'User-edited fictional demo customer',
    });
    await seedCrews(f.source, 'test');
    await createDemoActors(f.source);
    const seed = async () => {
      await seedCrews(f.source, 'test');
      await seedIdentity(f.source, 'test');
      await seedOrders(f.source, 'test');
      await seedPlanningDefaults(f.source, 'test');
    };
    await seed();
    await f.start(ctx);
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#625533' } })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append('operationKey', freshOperation());
    form.append('proofType', 'DELIVERY');
    form.append(
      'file',
      new Blob([new Uint8Array(png)], { type: 'image/png' }),
      'fictional-seed-preservation.png',
    );
    const uploaded = await json<AttachmentResponse>(
      await f.call(actor, f.path(id, '/attachments'), 'POST', form),
    );
    const contentPath = uploaded.attachment.contentUrl.replace(/^\/api/, '');
    const content = await f.call(actor, contentPath);
    expect(content.status).toBe(200);
    const contentHash = createHash('sha256')
      .update(new Uint8Array(await content.arrayBuffer()))
      .digest('hex');
    await json(
      await f.call(actor, f.path(id, '/estimate'), 'POST', {
        operationKey: freshOperation(),
        expectedEstimateVersion: 1,
        localFinish: '2030-01-07T11:30',
        reason: 'Preserved fictional estimate',
      }),
    );
    await json(
      await f.call(actor, f.path(id, '/notes'), 'POST', {
        operationKey: freshOperation(),
        text: 'Preserved M5 crew evidence in M6 aggregate',
      }),
    );
    const current = await f.detail(actor, id),
      terminal = await json<CrewAssignmentResponse>(
        await f.action(actor, id, 'finish', {
          operationKey: freshOperation(),
          expectedExecutionVersion: current.execution.version,
          outcome: 'PARTIALLY_COMPLETED',
          summary: 'Preserved original M5 partial facts',
          reason: 'Fictional missing material',
          remainingWork: 'Finish remaining assembly',
          returnVisitRequired: true,
          returnReason: 'Preserved original need',
        }),
      );
    const requestId = terminal.assignment.returnRequests.find(
        (entry) => entry.assignmentId === id,
      )!.id,
      route = '/backoffice/return-requests/' + requestId;
    const detail = (await json<ReturnRequestResponse>(await f.call(f.dispatcher, route))).request;
    const input: PlanReturnVisitCommand = {
      operationKey: freshOperation(),
      expectedVersion: detail.request.version,
      localStart: '2030-01-07T12:00',
      durationMinutes: 60,
      crewIds: ctx.crews.map((crew) => crew.id),
      carriedTasks: detail.scopeCandidates.map((task) => ({
        sourceTaskId: task.sourceTaskId,
        crewId: ctx.crews[0]!.id,
      })),
      newTasks: [
        {
          crewId: ctx.crews[0]!.id,
          name: 'Explicit follow-up integrity recheck',
          description: 'New work, no reset of source tasks',
          required: true,
          severity: 'HIGH',
          priority: 95,
          reason: 'Verify fitting replaced on follow-up',
        },
      ],
      itemTargets: detail.items.map((item) => ({
        itemId: item.id,
        deliveredQuantity: item.quantity,
        assembledQuantity: item.requiresAssembly ? item.quantity : 0,
      })),
      reason: 'Preserved explicit scope',
    };
    const first = (
      await json<ReturnRequestResponse>(await f.call(f.dispatcher, route + '/plan', 'POST', input))
    ).request.currentAppointment!;
    await json<AppointmentResponse>(
      await f.call(
        f.dispatcher,
        '/orders/' + ctx.order.id + '/appointments/' + first.id + '/cancel',
        'POST',
        { expectedVersion: first.version, reason: 'Preserved cancelled attempt history' },
      ),
      201,
    );
    const reopened = (await json<ReturnRequestResponse>(await f.call(f.dispatcher, route))).request;
    const latest = await json<ReturnRequestResponse>(
      await f.call(f.dispatcher, route + '/plan', 'POST', {
        ...input,
        operationKey: freshOperation(),
        expectedVersion: reopened.request.version,
        localStart: '2030-01-07T15:00',
        carriedTasks: reopened.scopeCandidates.map((task) => ({
          sourceTaskId: task.sourceTaskId,
          crewId: ctx.crews[0]!.id,
        })),
      }),
    );
    expect(latest.request.request.status).toBe('PLANNED');
    expect(latest.request.attempts).toHaveLength(2);
    await f.source
      .getRepository(User)
      .update(actor.user.id, { displayName: 'User-edited crew identity' });
    const before = await digest(f.source, f.schema);
    await seed();
    expect(await digest(f.source, f.schema)).toEqual(before);
    await seed();
    expect(await digest(f.source, f.schema)).toEqual(before);
    const after = await json<ReturnRequestResponse>(await f.call(f.dispatcher, route));
    expect(after.request).toEqual(latest.request);
    expect((await f.detail(actor, id)).finishReport).toEqual(terminal.assignment.finishReport);
    const preservedContent = await f.call(actor, contentPath);
    expect(preservedContent.status).toBe(200);
    expect(
      createHash('sha256')
        .update(new Uint8Array(await preservedContent.arrayBuffer()))
        .digest('hex'),
    ).toBe(contentHash);
  });
});
