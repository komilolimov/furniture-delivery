import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type {
  AcceptanceDocumentRecord,
  OrderDetail,
  PlanReturnVisitCommand,
} from '@furniture-delivery/contracts';
import { DateTime } from 'luxon';
import { hashPassword } from '../auth/password';
import { DatabaseService } from '../database/database.service';
import { seedCrews } from '../database/demo-crews';
import { demoUsers, seedIdentity } from '../database/demo-identity';
import { seedPlanningDefaults } from '../database/demo-planning';
import { Crew } from '../crews/crew.entity';
import { CrewMember } from '../identity/crew-member.entity';
import { User } from '../identity/user.entity';
import { CrewPlanningConfig } from '../planning/crew-planning-config.entity';
import { CrewAvailabilityService } from '../planning/crew-availability.service';
import { PlanningService } from '../planning/planning.service';
import { localToUtc } from '../planning/planning-time';
import { OrdersService } from '../orders/orders.service';
import { OrderDto } from '../orders/orders.dto';
import { ExecutionService } from '../execution/execution.service';
import { EvidenceService } from '../evidence/evidence.service';
import { EvidenceDto } from '../evidence/evidence.dto';
import { AttachmentsService } from '../evidence/attachments.service';
import { PrivateStorage } from '../evidence/private-storage';
import { ReschedulingService } from '../rescheduling/rescheduling.service';
import { ReturnVisitsService } from '../return-visits/return-visits.service';
import { AcceptanceService } from '../acceptance/acceptance.service';
import { CompletionService } from '../completion/completion.service';
import { syntheticDemoPng } from './demo-images';
import type { DemoCredential, DemoManifest, DemoOrderReference, DemoRunState } from './demo-types';

interface PreparedVisit {
  order: OrderDetail;
  appointmentId: string;
  version: number;
  crews: Crew[];
  assignmentIds: string[];
}
export async function buildDemoScenarios(
  app: INestApplication,
  state: DemoRunState,
): Promise<{ manifest: DemoManifest; credentials: DemoCredential[] }> {
  const source = await app.get(DatabaseService).getDataSource(),
    orders = app.get(OrdersService),
    planning = app.get(PlanningService),
    execution = app.get(ExecutionService),
    evidence = app.get(EvidenceService),
    attachments = app.get(AttachmentsService),
    storage = app.get(PrivateStorage),
    estimates = app.get(ReschedulingService),
    returns = app.get(ReturnVisitsService),
    acceptance = app.get(AcceptanceService),
    completion = app.get(CompletionService),
    availability = app.get(CrewAvailabilityService);
  await seedCrews(source, 'test');
  const crews = await source.getRepository(Crew).find({ order: { code: 'ASC' } }),
    users = new Map<string, User>(),
    credentials: DemoCredential[] = [];
  if (crews.length !== 10 || (await source.getRepository(User).count()) !== 0)
    throw new Error('The new isolated demo schema is not empty.');
  for (const { crewCode, ...input } of demoUsers) {
    const password = randomBytes(24).toString('base64url'),
      passwordHash = await hashPassword(password);
    const user = await source.getRepository(User).save({ ...input, passwordHash, active: true });
    users.set(user.username, user);
    if (crewCode)
      await source.getRepository(CrewMember).save({
        userId: user.id,
        crewId: crews.find((crew) => crew.code === crewCode)!.id,
        active: true,
      });
    credentials.push({ ...input, ...(crewCode ? { crewCode } : {}), password });
  }
  // Existing identity helper confirms all demo identities exist; it never resets an existing password.
  await seedIdentity(source, 'test');
  await seedPlanningDefaults(source, 'test');
  const dispatcher = users.get('demo.dispatcher')!,
    admin = users.get('demo.admin')!,
    actor = { id: dispatcher.id },
    staff = new Map(
      crews.map((crew) => [crew.id, users.get('demo.crew' + crew.code.slice(-2) + '.member01')!]),
    );
  for (const crew of crews) {
    const config = await source
      .getRepository(CrewPlanningConfig)
      .findOneByOrFail({ crewId: crew.id });
    await availability.updateConfig(
      crew.id,
      {
        expectedVersion: config.version,
        travelBufferMinutes: 30,
        weeklyWindows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          startTime: '00:00',
          endTime: '23:59',
        })),
      },
      dispatcher.id,
    );
  }
  const date = (offset = 0) =>
    DateTime.fromISO(state.baseDate, { zone: 'Europe/Rome' }).plus({ days: offset }).toISODate()!;
  const slots = new Map<string, number>();
  function allocate(selected: Crew[], tomorrow: boolean): string {
    const prefix = tomorrow ? 'tomorrow:' : 'today:',
      base = tomorrow ? 9 * 60 : 3 * 60;
    const next = Math.max(0, ...selected.map((crew) => slots.get(prefix + crew.id) ?? 0));
    for (const crew of selected) slots.set(prefix + crew.id, next + 1);
    const minute = base + next * 90;
    if (minute + 90 > 23 * 60 + 59)
      throw new Error('The synthetic visit schedule exceeded its explicit working day.');
    return (
      date(tomorrow ? 1 : 0) +
      'T' +
      String(Math.floor(minute / 60)).padStart(2, '0') +
      ':' +
      String(minute % 60).padStart(2, '0')
    );
  }
  const references: DemoOrderReference[] = [],
    visits = new Map<number, PreparedVisit>();
  const intended = (index: number) =>
    index < 8
      ? 'INBOX'
      : index < 12
        ? 'PLANNED'
        : index < 20 || index === 23
          ? 'ASSIGNED'
          : index < 24
            ? 'IN_PROGRESS'
            : index < 30
              ? 'PARTIALLY_COMPLETED'
              : index < 34
                ? 'AWAITING_REVIEW'
                : index < 37
                  ? 'COMPLETED'
                  : index === 38
                    ? 'REQUIRES_ATTENTION'
                    : 'AWAITING_REVIEW';
  const scenario = (i: number) =>
    i < 8
      ? 'inbox'
      : i < 12
        ? 'unassigned'
        : i < 16
          ? 'needs-confirmation'
          : i < 20
            ? 'upcoming'
            : i < 22
              ? 'active'
              : i === 22
                ? 'delay'
                : i === 23
                  ? 'next-at-risk'
                  : i < 28
                    ? 'partial-issue-return'
                    : i < 30
                      ? 'return-planned'
                      : i < 34
                        ? 'awaiting-acknowledgement'
                        : i < 37
                          ? 'completed'
                          : i === 37
                            ? 'manual-reopened'
                            : i === 38
                              ? 'issue-reopened'
                              : 'snapshot-invalidated-reopened';
  for (let index = 0; index < 40; index++) {
    const number = String(index + 1).padStart(2, '0'),
      assembly = index % 2 === 0,
      total = index % 10 === 0 ? 0 : 10000 + index * 100;
    const order = await orders.create(
      OrderDto.create({
        customerName: 'SYNTHETIC Demo Customer ' + number,
        phoneNumbers: ['+39 000 0000000'],
        email: 'demo' + number + '@example.invalid',
        address: 'Via Dimostrativa ' + number,
        city: 'Roma',
        country: 'Italy',
        serviceType: assembly ? 'DELIVERY_AND_ASSEMBLY' : 'DELIVERY_ONLY',
        workDescription: 'Synthetic demo furniture delivery' + (assembly ? ' and assembly' : ''),
        estimatedDurationMinutes: 60,
        orderTotalCents: total,
        internalNotes: 'SYNTHETIC DEMO — backoffice-only fixture notes',
        crewNotes: 'SYNTHETIC DEMO — no real customer or signature',
        items: [
          {
            description: 'Synthetic demonstration table',
            quantity: 2,
            requiresAssembly: assembly,
            sortOrder: 0,
          },
          {
            description: 'Synthetic demonstration chair',
            quantity: 1,
            requiresAssembly: false,
            sortOrder: 1,
          },
        ],
      }),
      dispatcher.id,
    );
    const ref: DemoOrderReference = {
      key: 'order-' + number,
      orderId: order.id,
      orderNumber: order.number,
      scenario: scenario(index),
      intendedState: intended(index),
      appointmentIds: [],
      crewCodes: [],
      crewAssignments: [],
      requestIds: [],
      issueIds: [],
      snapshotIds: [],
      completionIds: [],
      backofficePath: '/backoffice/orders/' + order.id,
    };
    references.push(ref);
    if (total > 0 && index % 3 !== 0) {
      const paid = await orders.recordPayment(
        order.id,
        {
          amountCents: index % 3 === 1 ? Math.floor(total / 2) : total,
          paidOn: state.baseDate,
          method: index % 2 ? 'CASH' : 'BANK_TRANSFER',
          idempotencyKey: randomUUID(),
          note: 'Synthetic manual demo payment',
        },
        dispatcher.id,
      );
      if (index === 5)
        await orders.voidPayment(
          order.id,
          paid.payment.id,
          'Synthetic correction retained in the manual ledger',
          dispatcher.id,
        );
    }
    if (index < 8) continue;
    const selected =
      index < 12
        ? []
        : index === 20
          ? [crews[7]!]
          : index === 21
            ? [crews[8]!]
            : index === 22 || index === 23
              ? [crews[9]!]
              : index === 34
                ? [crews[4]!, crews[5]!]
                : [crews[(index - 24 + 10) % 10] ?? crews[index % 10]!];
    // Every initial reservation is made before any execution. No old plan is rewritten to manufacture a result.
    const localStart =
      index === 22
        ? date() + 'T00:00'
        : index === 23
          ? date() + 'T01:00'
          : selected.length
            ? allocate(selected, index < 20)
            : date(1) + 'T09:00';
    let planned = await planning.create(
      order.id,
      {
        localStart,
        durationMinutes: index === 22 ? 1 : 60,
        crewIds: selected.map((crew) => crew.id),
        idempotencyKey: randomUUID(),
        notes: 'SYNTHETIC DEMO planning fixture',
      },
      dispatcher.id,
    );
    if (index >= 16)
      planned = await planning.confirm(
        order.id,
        planned.appointment.id,
        planned.appointment.version,
        dispatcher.id,
      );
    const visit: PreparedVisit = {
      order: planned.order,
      appointmentId: planned.appointment.id,
      version: planned.appointment.version,
      crews: selected,
      assignmentIds: selected.map(
        (crew) =>
          planned.appointment.assignments.find(
            (assignment) => assignment.crewId === crew.id && assignment.status === 'ASSIGNED',
          )!.id,
      ),
    };
    visits.set(index, visit);
    ref.appointmentIds.push(visit.appointmentId);
    ref.crewCodes.push(...selected.map((crew) => crew.code));
    for (const [team, assignmentId] of visit.assignmentIds.entries())
      ref.crewAssignments.push({
        assignmentId,
        crewCode: selected[team]!.code,
        crewPath: '/crew/assignments/' + assignmentId,
      });
  }
  const png = await syntheticDemoPng();
  async function detail(visit: PreparedVisit, team = 0) {
    return (
      await execution.detail(
        { id: staff.get(visit.crews[team]!.id)!.id },
        visit.assignmentIds[team]!,
      )
    ).assignment;
  }
  async function start(visit: PreparedVisit, team = 0) {
    const who = { id: staff.get(visit.crews[team]!.id)!.id },
      id = visit.assignmentIds[team]!;
    let current = await detail(visit, team);
    current = (
      await execution.action(who, id, 'DEPART', {
        operationKey: randomUUID(),
        expectedExecutionVersion: current.execution.version,
        expectedAppointmentVersion: current.appointmentVersion,
      })
    ).assignment;
    for (const action of ['ARRIVE', 'START'] as const)
      current = (
        await execution.action(who, id, action, {
          operationKey: randomUUID(),
          expectedExecutionVersion: current.execution.version,
        })
      ).assignment;
    return current;
  }
  async function results(visit: PreparedVisit, team = 0, partial = false) {
    const who = { id: staff.get(visit.crews[team]!.id)!.id },
      id = visit.assignmentIds[team]!;
    let current = await detail(visit, team);
    const tasks = partial
      ? current.tasks.filter((task) => task.required).slice(0, 1)
      : current.tasks;
    for (const task of tasks)
      current = (
        await execution.taskResult(who, id, task.id, {
          operationKey: randomUUID(),
          expectedTaskVersion: task.resultVersion,
          resultStatus: 'DONE',
        })
      ).assignment;
    if (team === 0)
      for (const item of current.items)
        current = (
          await execution.fulfillment(who, id, item.id, {
            operationKey: randomUUID(),
            expectedFulfillmentVersion: item.fulfillmentVersion,
            deliveredQuantity: partial ? Math.min(1, item.quantity) : item.quantity,
            assembledQuantity: partial ? 0 : item.requiresAssembly ? item.quantity : 0,
          })
        ).assignment;
    return current;
  }
  async function photo(visit: PreparedVisit, ref: DemoOrderReference) {
    const id = visit.assignmentIds[0]!,
      who = { id: staff.get(visit.crews[0]!.id)!.id },
      directory = await storage.stagingDirectory(),
      path = join(directory, randomUUID());
    await writeFile(path, png, { flag: 'wx', mode: 0o600 });
    const uploaded = await attachments.upload(
      who,
      { assignmentId: id },
      {
        operationKey: randomUUID(),
        visibility: 'CREW_VISIBLE',
        proofType: 'MISSING_PARTS',
        itemId: visit.order.items[0]!.id,
      },
      { path, size: png.length, originalname: 'SYNTHETIC-demo-material.png' },
    );
    const issue = await evidence.createIssue(
      who,
      { assignmentId: id },
      EvidenceDto.issue(
        {
          operationKey: randomUUID(),
          type: 'MISSING_PARTS',
          description: 'SYNTHETIC DEMO missing fitting, no real customer damage',
          reportedSource: 'CREW',
          itemIds: [visit.order.items[0]!.id],
          attachmentIds: [uploaded.attachment.id],
        },
        true,
      ),
    );
    ref.issueIds.push(issue.issue.id);
  }
  async function finish(visit: PreparedVisit, ref: DemoOrderReference, partial = false) {
    for (let team = 0; team < visit.crews.length; team++) {
      await start(visit, team);
      const done = await results(visit, team, partial),
        who = { id: staff.get(visit.crews[team]!.id)!.id };
      if (partial && ref.scenario === 'partial-issue-return') await photo(visit, ref);
      const terminal = await execution.finish(who, visit.assignmentIds[team]!, {
        operationKey: randomUUID(),
        expectedExecutionVersion: done.execution.version,
        outcome: partial ? 'PARTIALLY_COMPLETED' : 'COMPLETED',
        summary: partial
          ? 'SYNTHETIC partial demonstration result'
          : 'SYNTHETIC completed team result',
        ...(partial
          ? {
              reason: 'Synthetic missing fitting',
              remainingWork: 'Deliver remaining furniture and finish assembly',
              returnVisitRequired: true,
              returnReason: 'Bring the synthetic fitting on a repeat visit',
            }
          : { returnVisitRequired: false }),
      });
      for (const request of terminal.assignment.returnRequests)
        if (!ref.requestIds.includes(request.id)) ref.requestIds.push(request.id);
    }
  }
  async function acknowledge(
    visit: PreparedVisit,
    ref: DemoOrderReference,
    customer: 'SIGN' | 'APPROVE_ABSENCE' | 'PENDING_ABSENCE' | 'MISSING' = 'SIGN',
  ): Promise<AcceptanceDocumentRecord> {
    const prepared = await acceptance.prepare(
        actor,
        { orderId: visit.order.id, appointmentId: visit.appointmentId },
        { operationKey: randomUUID() },
      ),
      doc = prepared.acceptance.current! as AcceptanceDocumentRecord;
    ref.snapshotIds.push(doc.snapshot.id);
    for (const slot of doc.slots.filter((slot) => slot.kind === 'CREW')) {
      const team = visit.assignmentIds.indexOf(slot.assignmentId!),
        who = { id: staff.get(visit.crews[team]!.id)!.id };
      await acceptance.sign(
        who,
        doc.snapshot.id,
        slot.id,
        { operationKey: randomUUID(), expectedVersion: doc.snapshot.version, consent: true },
        png,
      );
    }
    const slot = doc.slots.find((slot) => slot.kind === 'CUSTOMER')!,
      who = { id: staff.get(visit.crews[0]!.id)!.id };
    if (customer === 'SIGN')
      await acceptance.sign(
        who,
        doc.snapshot.id,
        slot.id,
        {
          operationKey: randomUUID(),
          expectedVersion: doc.snapshot.version,
          consent: true,
          customerName: 'SYNTHETIC DEMO representative',
          customerRelation: 'Synthetic fixture, no identity verification',
        },
        png,
      );
    if (customer === 'APPROVE_ABSENCE' || customer === 'PENDING_ABSENCE') {
      await acceptance.absence(who, doc.snapshot.id, slot.id, {
        operationKey: randomUUID(),
        expectedVersion: doc.snapshot.version,
        kind: 'ABSENT',
        reason: 'SYNTHETIC DEMO absent customer confirmation',
      });
      if (customer === 'APPROVE_ABSENCE')
        await acceptance.review(actor, doc.snapshot.id, slot.id, {
          operationKey: randomUUID(),
          expectedVersion: doc.snapshot.version,
          decision: 'APPROVED',
          reason: 'SYNTHETIC DEMO dispatcher considered this one absent confirmation',
        });
    }
    return doc;
  }
  for (let index = 24; index < 40; index++) {
    const visit = visits.get(index)!,
      ref = references[index]!;
    await finish(visit, ref, index < 30);
    if (index === 28 || index === 29) {
      const request = (await returns.detail(actor, ref.requestIds[0]!)).request;
      const input: PlanReturnVisitCommand = {
        operationKey: randomUUID(),
        expectedVersion: request.request.version,
        localStart: allocate(visit.crews, true),
        durationMinutes: 60,
        crewIds: visit.crews.map((crew) => crew.id),
        carriedTasks: request.scopeCandidates.map((task) => ({
          sourceTaskId: task.sourceTaskId,
          crewId: visit.crews[0]!.id,
        })),
        newTasks: [],
        itemTargets: request.items.map((item) => ({
          itemId: item.id,
          deliveredQuantity: item.quantity,
          assembledQuantity: item.requiresAssembly ? item.quantity : 0,
        })),
        reason: 'SYNTHETIC DEMO explicit remaining-work plan',
      };
      const planned = await returns.plan(actor, request.request.id, input);
      ref.appointmentIds.push(planned.request.currentAppointment!.id);
      for (const assignment of planned.request.currentAppointment!.assignments.filter(
        (entry) => entry.status === 'ASSIGNED',
      ))
        ref.crewAssignments.push({
          assignmentId: assignment.id,
          crewCode: assignment.crewCode,
          crewPath: '/crew/assignments/' + assignment.id,
        });
    }
    if (index === 32) await acknowledge(visit, ref, 'MISSING');
    if (index === 33) await acknowledge(visit, ref, 'PENDING_ABSENCE');
    if (index >= 34) {
      const doc = await acknowledge(visit, ref, index === 35 ? 'APPROVE_ABSENCE' : 'SIGN');
      const ready = (await completion.readiness(actor, visit.order.id)).readiness;
      if (!ready.canComplete)
        throw new Error('A synthetic completed scenario did not meet actual server readiness.');
      const closed = await completion.complete(actor, visit.order.id, {
        operationKey: randomUUID(),
        expectedVersion: ready.orderVersion,
        reason: 'SYNTHETIC DEMO explicit operational closure',
      });
      ref.completionIds.push(closed.readiness.currentCompletion!.id);
      if (index === 37)
        await completion.reopen(actor, visit.order.id, {
          operationKey: randomUUID(),
          expectedVersion: closed.readiness.orderVersion,
          expectedCompletionId: closed.readiness.currentCompletion!.id,
          reason: 'SYNTHETIC DEMO explicit manual reopen',
        });
      if (index === 38) {
        const issue = await evidence.createIssue(
          { id: staff.get(visit.crews[0]!.id)!.id },
          { assignmentId: visit.assignmentIds[0]! },
          EvidenceDto.issue(
            {
              operationKey: randomUUID(),
              type: 'DAMAGE',
              description: 'SYNTHETIC DEMO issue after closure',
              reportedSource: 'CREW',
            },
            true,
          ),
        );
        ref.issueIds.push(issue.issue.id);
      }
      if (index === 39)
        await acceptance.invalidate(actor, doc.snapshot.id, {
          operationKey: randomUUID(),
          expectedVersion: doc.snapshot.version,
          reason: 'SYNTHETIC DEMO explicit snapshot correction and reopen',
        });
    }
  }
  // Active work is last, so it cannot prevent the earlier legitimate terminal workflows.
  for (const index of [20, 21, 22]) await start(visits.get(index)!);
  const delayed = visits.get(22)!,
    delayActor = { id: staff.get(delayed.crews[0]!.id)!.id };
  let future = DateTime.now().setZone('Europe/Rome').plus({ minutes: 60 }).startOf('minute'),
    localFinish: string | undefined;
  for (let attempt = 0; attempt < 48; attempt++, future = future.plus({ minutes: 15 })) {
    const local = future.toFormat("yyyy-MM-dd'T'HH:mm");
    try {
      if (localToUtc(local) > new Date()) {
        localFinish = local;
        break;
      }
    } catch {
      /* A DST gap/fold must never be silently normalized. */
    }
  }
  if (!localFinish) throw new Error('A valid explicit Rome estimate could not be prepared.');
  await estimates.estimate(
    delayActor,
    delayed.assignmentIds[0]!,
    {
      operationKey: randomUUID(),
      expectedEstimateVersion: (await detail(delayed)).execution.estimateVersion,
      localFinish,
      reason: 'SYNTHETIC DEMO delayed active work, plan remains unchanged',
    },
    true,
  );
  const risk = await estimates.risks(actor, {
    from: state.baseDate,
    to: date(1),
    allTeams: false,
    crewIds: [delayed.crews[0]!.id],
  });
  if (
    !risk.risks.some(
      (visit) =>
        visit.appointmentId === visits.get(23)!.appointmentId &&
        visit.reasons.some((reason) => reason.code === 'NEXT_VISIT_AT_RISK'),
    )
  )
    throw new Error(
      'The synthetic delayed/next-visit scenario did not satisfy the actual risk resolver.',
    );
  const observedProgress: Record<string, number> = {};
  for (const ref of references) {
    const live = await orders.detail(ref.orderId);
    if (live.progress !== ref.intendedState)
      throw new Error('Synthetic scenario ' + ref.key + ' did not satisfy its actual resolver.');
    observedProgress[live.progress] = (observedProgress[live.progress] ?? 0) + 1;
  }
  if (
    (await source.getRepository(User).count()) !== 42 ||
    (await source.getRepository(Crew).count()) !== 10 ||
    references.length !== 40 ||
    credentials.filter((entry) => entry.role === 'CREW_MEMBER').length !== 40 ||
    admin.role !== 'ADMIN'
  )
    throw new Error('The isolated demo aggregate counts are inconsistent.');
  return {
    credentials,
    manifest: {
      version: 1,
      synthetic: true,
      runId: state.owner.runId,
      baseDate: state.baseDate,
      createdAt: new Date().toISOString(),
      orders: references,
      counts: { orders: 40, crews: 10, employees: 40, backofficeUsers: 2 },
      observedProgress,
      narratives: [
        {
          key: 'two-crews-close',
          title: 'Two teams, independent reports and explicit acknowledgement/closure',
          orderIds: [references[34]!.orderId],
          steps: [
            'Open the two-team completed order and its separate team reports.',
            'Compare accumulated quantities without adding reports.',
            'Review its synthetic snapshot, signatures and completion decision.',
          ],
        },
        {
          key: 'delay-return',
          title: 'Active delay and explicit repeat-work planning',
          orderIds: [
            references[22]!.orderId,
            references[23]!.orderId,
            references[24]!.orderId,
            references[28]!.orderId,
          ],
          steps: [
            'Inspect the active estimate and next-visit risk; search/preview/apply manually.',
            'Inspect partial quantities, the protected synthetic material and linked issue.',
            'Open the repeat request and its explicit carried work; follow-up is planned tomorrow.',
          ],
        },
        {
          key: 'issue-reopens',
          title: 'Issue after closure preserves history and reopens the order',
          orderIds: [references[38]!.orderId],
          steps: [
            'Inspect the old completion and the currently open post-closure issue.',
            'Resolve the issue manually; the order does not close automatically.',
            'Review readiness and explicitly close again if all current conditions hold.',
          ],
        },
      ],
      limitations: [
        'SYNTHETIC DATA ONLY: images and signatures are generated fixtures, not real customers or verified identities.',
        'New runs use today in Europe/Rome and actual server timestamps. Repeat never shifts an old run.',
        'Broad demo working windows are explicit synthetic configuration, not company availability.',
        'Historical scenario intentions remain in this manifest after manual edits; current state comes from canonical API.',
        'Browser, physical camera and touch/canvas behavior remain deferred to final acceptance.',
      ],
    },
  };
}
