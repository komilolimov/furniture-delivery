import { markReturn } from '../realtime/realtime-marks';
import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateReturnRequestCommand,
  PlanReturnVisitCommand,
  ResolveReturnRequestCommand,
  ReturnAttemptScope,
  ReturnQueueQuery,
  ReturnQueueResponse,
  ReturnRequestResponse,
  ActivityAction,
} from '@furniture-delivery/contracts';
import type { EntityManager } from 'typeorm';
import { DatabaseService } from '../database/database.service';
import { lockExecutionUser, type ExecutionActor } from '../execution/execution-access';
import { ReturnVisitRequest } from '../execution/return-visit-request.entity';
import { ReturnVisitAttempt } from '../execution/return-visit-attempt.entity';
import { FinishReport } from '../execution/finish-report.entity';
import { Appointment } from '../planning/appointment.entity';
import { CrewAssignment } from '../planning/crew-assignment.entity';
import { CrewPlanningConfig } from '../planning/crew-planning-config.entity';
import { Task } from '../planning/task.entity';
import { Crew } from '../crews/crew.entity';
import { requireOpenOrder } from '../completion/completion-state';
import { Order } from '../orders/order.entity';
import { OrderItem } from '../orders/order-item.entity';
import { ActivityLog } from '../orders/activity-log.entity';
import { PlanningConflict } from '../planning/planning-errors';
import { resolveLocalWindow } from '../planning/planning-time';
import { reservationAttention } from '../planning/planning-projection';
import {
  evidenceFingerprint,
  findEvidenceReceipt,
  mapEvidenceReceipt,
  saveEvidenceReceipt,
} from '../evidence/evidence-receipts';
import { readReturnDetail, returnScopeCandidates } from './return-projection';
import { bumpReturn, returnResolveBlockers } from './return-lifecycle';

@Injectable()
export class ReturnVisitsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  private async orderLock(m: EntityManager, id: string): Promise<Order> {
    const o = await m
      .getRepository(Order)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!o) throw new NotFoundException('Order not found.');
    return o;
  }
  private async request(m: EntityManager, id: string): Promise<ReturnVisitRequest> {
    const r = await m.getRepository(ReturnVisitRequest).findOneBy({ id });
    if (!r) throw new NotFoundException('Return request not found.');
    return r;
  }
  private requireVersion(r: ReturnVisitRequest, v: number) {
    if (r.version !== v)
      throw new PlanningConflict(
        'STALE_RETURN_VERSION',
        'The return request changed. Reload it before saving.',
      );
  }
  private async audit(
    m: EntityManager,
    o: Order,
    actorId: string,
    action: ActivityAction,
    targetId: string,
    changes: Record<string, unknown>,
    reason: string,
  ): Promise<void> {
    if (o.version >= 2147483647)
      throw new PlanningConflict('REVISION_LIMIT', 'Order revision limit reached.');
    o.version++;
    o.updatedBy = actorId;
    await m.save(Order, o);
    await m.save(
      ActivityLog,
      m.create(ActivityLog, {
        orderId: o.id,
        actorId,
        action,
        targetId,
        changes,
        reason: reason.slice(0, 1000),
      }),
    );
    markReturn(m, o.id);
  }
  async list(actor: ExecutionActor, q: ReturnQueueQuery): Promise<ReturnQueueResponse> {
    return (await this.database.getDataSource()).transaction('REPEATABLE READ', async (m) => {
      await lockExecutionUser(m, actor);
      const query = m.getRepository(ReturnVisitRequest).createQueryBuilder('r');
      if (q.status) query.andWhere('r.status=:status', { status: q.status });
      if (q.orderId) query.andWhere('r.orderId=:orderId', { orderId: q.orderId });
      const [rows, total] = await query
        .orderBy('r.createdAt', 'ASC')
        .addOrderBy('r.id', 'ASC')
        .skip((q.page - 1) * q.pageSize)
        .take(q.pageSize)
        .getManyAndCount();
      const requests = [];
      for (const r of rows) {
        const d = await readReturnDetail(m, r),
          o = await m.getRepository(Order).findOneByOrFail({ id: r.orderId });
        requests.push({
          request: d.request,
          orderNumber: o.number,
          customerName: o.customerName,
          currentAppointmentId: d.currentAppointment?.id ?? null,
          readyToResolve: d.readyToResolve,
        });
      }
      return { requests, total, page: q.page, pageSize: q.pageSize };
    });
  }
  async detail(actor: ExecutionActor, id: string): Promise<ReturnRequestResponse> {
    return (await this.database.getDataSource()).transaction('REPEATABLE READ', async (m) => {
      await lockExecutionUser(m, actor);
      return { request: await readReturnDetail(m, await this.request(m, id)) };
    });
  }
  async create(
    actor: ExecutionActor,
    assignmentId: string,
    input: CreateReturnRequestCommand,
  ): Promise<ReturnRequestResponse> {
    return (await this.database.getDataSource()).transaction('READ COMMITTED', async (m) => {
      await lockExecutionUser(m, actor);
      const initial = await m.getRepository(CrewAssignment).findOneBy({ id: assignmentId });
      const visit =
        initial && (await m.getRepository(Appointment).findOneBy({ id: initial.appointmentId }));
      if (!initial || !visit) throw new NotFoundException('Assignment not found.');
      const order = await this.orderLock(m, visit.orderId);
      await lockExecutionUser(m, actor);
      const fingerprint = evidenceFingerprint({ assignmentId, ...input });
      const replay = await findEvidenceReceipt(
        m,
        actor.id,
        order.id,
        'RETURN_CREATE',
        input.operationKey,
        fingerprint,
      );
      if (replay)
        return {
          request: await readReturnDetail(m, await this.request(m, replay.resultId!)),
          receipt: mapEvidenceReceipt(replay),
        };
      await m
        .getRepository(Appointment)
        .findOne({ where: { id: visit.id }, lock: { mode: 'pessimistic_write' } });
      await m
        .getRepository(Crew)
        .findOne({ where: { id: initial.crewId }, lock: { mode: 'pessimistic_write' } });
      const assignment = await m
        .getRepository(CrewAssignment)
        .findOneByOrFail({ id: assignmentId });
      await lockExecutionUser(m, actor);
      const attempt = await m
        .getRepository(ReturnVisitAttempt)
        .findOneBy({ appointmentId: visit.id });
      let request = attempt
        ? await this.request(m, attempt.requestId)
        : await m.getRepository(ReturnVisitRequest).findOneBy({ assignmentId });
      if (!request) {
        await requireOpenOrder(m, order);
        if (assignment.executionVersion !== input.expectedExecutionVersion)
          throw new PlanningConflict(
            'STALE_EXECUTION_VERSION',
            'The execution changed. Reload it.',
          );
        if (
          !['COMPLETED', 'PARTIALLY_COMPLETED', 'BLOCKED'].includes(assignment.executionStatus) ||
          visit.status !== 'SCHEDULED' ||
          assignment.status !== 'ASSIGNED'
        )
          throw new PlanningConflict(
            'EXECUTION_NOT_TERMINAL',
            'A return request requires a finished assignment.',
          );
        const report = await m.getRepository(FinishReport).findOneBy({ assignmentId });
        if (!report)
          throw new PlanningConflict('FINISH_REPORT_REQUIRED', 'A finish report is required.');
        request = await m.save(
          ReturnVisitRequest,
          m.create(ReturnVisitRequest, {
            orderId: order.id,
            appointmentId: visit.id,
            assignmentId,
            finishReportId: report.id,
            status: 'OPEN',
            version: 1,
            reason: input.reason,
            remainingWork: input.remainingWork,
            authorId: actor.id,
            updatedBy: actor.id,
          }),
        );
        await this.audit(
          m,
          order,
          actor.id,
          'RETURN_VISIT_REQUESTED',
          request.id,
          { assignmentId, finishReportId: report.id },
          input.reason,
        );
      }
      const receipt = await saveEvidenceReceipt(
        m,
        actor.id,
        order.id,
        'RETURN_CREATE',
        input.operationKey,
        fingerprint,
        request.id,
      );
      return { request: await readReturnDetail(m, request), receipt: mapEvidenceReceipt(receipt) };
    });
  }
  async plan(
    actor: ExecutionActor,
    id: string,
    input: PlanReturnVisitCommand,
  ): Promise<ReturnRequestResponse> {
    return (await this.database.getDataSource()).transaction('READ COMMITTED', async (m) => {
      await lockExecutionUser(m, actor);
      const initial = await this.request(m, id);
      const order = await this.orderLock(m, initial.orderId);
      await lockExecutionUser(m, actor);
      const request = await m
        .getRepository(ReturnVisitRequest)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!request) throw new NotFoundException('Return request not found.');
      const fingerprint = evidenceFingerprint({
        id,
        ...input,
        crewIds: [...input.crewIds].sort(),
        carriedTasks: [...input.carriedTasks].sort((a, b) =>
          a.sourceTaskId.localeCompare(b.sourceTaskId),
        ),
        itemTargets: [...input.itemTargets].sort((a, b) => a.itemId.localeCompare(b.itemId)),
      });
      const replay = await findEvidenceReceipt(
        m,
        actor.id,
        order.id,
        'RETURN_PLAN',
        input.operationKey,
        fingerprint,
      );
      if (replay)
        return { request: await readReturnDetail(m, request), receipt: mapEvidenceReceipt(replay) };
      await requireOpenOrder(m, order);
      this.requireVersion(request, input.expectedVersion);
      if (
        request.status !== 'OPEN' ||
        (await m.getRepository(ReturnVisitAttempt).existsBy({ requestId: id, current: true }))
      )
        throw new PlanningConflict(
          'RETURN_ALREADY_PLANNED',
          'This request already has a current follow-up or has been resolved.',
        );
      const crews = new Map<string, Crew>();
      for (const crewId of [...input.crewIds].sort()) {
        const crew = await m
          .getRepository(Crew)
          .findOne({ where: { id: crewId }, lock: { mode: 'pessimistic_write' } });
        if (!crew) throw new NotFoundException('Team not found.');
        crews.set(crewId, crew);
      }
      await lockExecutionUser(m, actor);
      const window = resolveLocalWindow(input.localStart, input.durationMinutes);
      if (window.plannedStartAt.getTime() < Date.now())
        throw new PlanningConflict('PAST_START', 'Choose a future start for a follow-up.');
      const buffers = new Map<string, number>();
      for (const crew of crews.values()) {
        const config = await m.getRepository(CrewPlanningConfig).findOneBy({ crewId: crew.id }),
          buffer = config?.travelBufferMinutes ?? 30;
        buffers.set(crew.id, buffer);
        const issue = (
          await reservationAttention(m, crew, window.plannedStartAt, window.plannedEndAt, buffer)
        )[0];
        if (issue)
          throw new PlanningConflict(issue.code, issue.message, {
            crewId: crew.id,
            appointmentId: issue.appointmentId,
          });
      }
      const candidates = await returnScopeCandidates(m, request);
      for (const c of candidates)
        if (c.required && !input.carriedTasks.some((t) => t.sourceTaskId === c.sourceTaskId))
          throw new PlanningConflict(
            'REQUIRED_RETURN_SCOPE',
            'Every unfinished required source task must be assigned once.',
          );
      const scope: ReturnAttemptScope = { tasks: [], itemTargets: input.itemTargets };
      for (const carry of input.carriedTasks) {
        const c = candidates.find((c) => c.sourceTaskId === carry.sourceTaskId);
        if (!c || !crews.has(carry.crewId))
          throw new BadRequestException(
            'A carried task must be an unfinished source of this request assigned to a selected team.',
          );
        scope.tasks.push({
          key: randomUUID(),
          sourceTaskId: c.sourceTaskId,
          sourceAssignmentId: c.sourceAssignmentId,
          name: c.name,
          description: c.description,
          required: c.required,
          severity: c.severity,
          priority: c.priority,
          crewId: carry.crewId,
          addedReason: null,
        });
      }
      for (const task of input.newTasks) {
        if (!crews.has(task.crewId))
          throw new BadRequestException('A new task must belong to a selected team.');
        scope.tasks.push({
          key: randomUUID(),
          sourceTaskId: null,
          sourceAssignmentId: null,
          name: task.name,
          description: task.description,
          required: task.required,
          severity: task.severity,
          priority: task.priority,
          crewId: task.crewId,
          addedReason: task.reason,
        });
      }
      const items = await m.getRepository(OrderItem).findBy({ orderId: order.id, active: true });
      const priorAttempts = await m
        .getRepository(ReturnVisitAttempt)
        .findBy({ requestId: id, closedOutcome: 'FAILED' });
      for (const previous of priorAttempts)
        for (const accepted of previous.scope.itemTargets) {
          const item = items.find((i) => i.id === accepted.itemId);
          if (!item)
            throw new PlanningConflict(
              'RETURN_TARGET_MISSING',
              'An accepted source item is no longer active.',
            );
          if (
            item.deliveredQuantity >= accepted.deliveredQuantity &&
            item.assembledQuantity >= accepted.assembledQuantity
          )
            continue;
          const next = scope.itemTargets.find((t) => t.itemId === accepted.itemId);
          if (
            !next ||
            next.deliveredQuantity < accepted.deliveredQuantity ||
            next.assembledQuantity < accepted.assembledQuantity
          )
            throw new PlanningConflict(
              'REQUIRED_RETURN_TARGET',
              'Unfulfilled targets from a failed follow-up must be carried into the next plan.',
            );
        }

      for (const target of scope.itemTargets) {
        const item = items.find((i) => i.id === target.itemId);
        if (
          !item ||
          target.deliveredQuantity < item.deliveredQuantity ||
          target.assembledQuantity < item.assembledQuantity ||
          target.deliveredQuantity > item.quantity ||
          target.assembledQuantity > target.deliveredQuantity ||
          (!item.requiresAssembly && target.assembledQuantity !== 0)
        )
          throw new BadRequestException(
            'Item targets must be absolute accumulated quantities within the active order item and cannot lower existing results.',
          );
      }
      if (!scope.tasks.length && !scope.itemTargets.length)
        throw new BadRequestException('Select explicit remaining tasks or item targets.');
      if (scope.tasks.length > 100)
        throw new BadRequestException('A follow-up supports at most 100 explicit tasks.');
      const appointment = await m.save(
        Appointment,
        m.create(Appointment, {
          ...window,
          orderId: order.id,
          status: 'SCHEDULED',
          confirmationStatus: 'NEEDS_CONFIRMATION',
          confirmedAt: null,
          confirmedBy: null,
          cancelledAt: null,
          cancelledBy: null,
          cancelReason: null,
          notes: input.notes ?? '',
          version: 1,
          idempotencyKey: 'return_' + randomUUID(),
          fingerprint,
          createdBy: actor.id,
          updatedBy: actor.id,
        }),
      );
      for (const crew of crews.values()) {
        const assignment = await m.save(
          CrewAssignment,
          m.create(CrewAssignment, {
            appointmentId: appointment.id,
            crewId: crew.id,
            status: 'ASSIGNED',
            travelBufferMinutes: buffers.get(crew.id),
            cancelledAt: null,
            cancelledBy: null,
            cancelReason: null,
            executionStatus: 'NOT_STARTED',
            executionVersion: 1,
          }),
        );
        for (const task of scope.tasks.filter((t) => t.crewId === crew.id))
          await m.save(
            Task,
            m.create(Task, {
              assignmentId: assignment.id,
              templateId: null,
              sourceTaskId: task.sourceTaskId,
              returnScopeKey: task.key,
              name: task.name,
              description: task.description,
              required: task.required,
              severity: task.severity,
              priority: task.priority,
              active: true,
              resultStatus: 'PENDING',
              resultVersion: 1,
              doneBy: null,
              doneAt: null,
              resultReason: null,
            }),
          );
      }
      const attempt = await m.save(
        ReturnVisitAttempt,
        m.create(ReturnVisitAttempt, {
          orderId: order.id,
          requestId: id,
          appointmentId: appointment.id,
          current: true,
          scope,
          returnRequested: false,
          createdBy: actor.id,
          closedOutcome: null,
          closedAt: null,
          closedBy: null,
          closeReason: null,
        }),
      );
      request.status = 'PLANNED';
      bumpReturn(request, actor.id);
      await m.save(ReturnVisitRequest, request);
      await this.audit(
        m,
        order,
        actor.id,
        'RETURN_VISIT_PLANNED',
        id,
        { attemptId: attempt.id, appointmentId: appointment.id, version: request.version, scope },
        input.reason,
      );
      const receipt = await saveEvidenceReceipt(
        m,
        actor.id,
        order.id,
        'RETURN_PLAN',
        input.operationKey,
        fingerprint,
        id,
      );
      return { request: await readReturnDetail(m, request), receipt: mapEvidenceReceipt(receipt) };
    });
  }
  async resolve(
    actor: ExecutionActor,
    id: string,
    input: ResolveReturnRequestCommand,
  ): Promise<ReturnRequestResponse> {
    return (await this.database.getDataSource()).transaction('READ COMMITTED', async (m) => {
      await lockExecutionUser(m, actor);
      const initial = await this.request(m, id),
        order = await this.orderLock(m, initial.orderId);
      await lockExecutionUser(m, actor);
      const request = await this.request(m, id),
        fingerprint = evidenceFingerprint({ id, ...input });
      const replay = await findEvidenceReceipt(
        m,
        actor.id,
        order.id,
        'RETURN_RESOLVE',
        input.operationKey,
        fingerprint,
      );
      if (replay)
        return { request: await readReturnDetail(m, request), receipt: mapEvidenceReceipt(replay) };
      this.requireVersion(request, input.expectedVersion);
      const attempt = await m
        .getRepository(ReturnVisitAttempt)
        .findOneBy({ requestId: id, current: true });
      if (request.status !== 'PLANNED' || !attempt)
        throw new PlanningConflict(
          'RETURN_NOT_READY',
          'A current completed follow-up is required.',
        );
      await m
        .getRepository(Appointment)
        .findOne({ where: { id: attempt.appointmentId }, lock: { mode: 'pessimistic_write' } });
      const assignments = await m
        .getRepository(CrewAssignment)
        .findBy({ appointmentId: attempt.appointmentId, status: 'ASSIGNED' });
      for (const crewId of assignments.map((a) => a.crewId).sort())
        await m
          .getRepository(Crew)
          .findOne({ where: { id: crewId }, lock: { mode: 'pessimistic_write' } });
      await lockExecutionUser(m, actor);
      const blockers = await returnResolveBlockers(m, attempt);
      if (blockers.length) throw new PlanningConflict('RETURN_NOT_READY', blockers.join(' '));
      request.status = 'RESOLVED';
      request.resolvedAt = new Date();
      request.resolvedBy = actor.id;
      request.resolution = input.reason;
      bumpReturn(request, actor.id);
      attempt.current = false;
      attempt.closedOutcome = 'RESOLVED';
      attempt.closedAt = request.resolvedAt;
      attempt.closedBy = actor.id;
      attempt.closeReason = input.reason;
      await m.save(ReturnVisitAttempt, attempt);
      await m.save(ReturnVisitRequest, request);
      await this.audit(
        m,
        order,
        actor.id,
        'RETURN_VISIT_RESOLVED',
        id,
        { attemptId: attempt.id, appointmentId: attempt.appointmentId, version: request.version },
        input.reason,
      );
      const receipt = await saveEvidenceReceipt(
        m,
        actor.id,
        order.id,
        'RETURN_RESOLVE',
        input.operationKey,
        fingerprint,
        id,
      );
      return { request: await readReturnDetail(m, request), receipt: mapEvidenceReceipt(receipt) };
    });
  }
}
