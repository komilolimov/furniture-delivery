import { markExecution } from '../realtime/realtime-marks';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ActivityAction,
  CrewAssignmentListResponse,
  CrewAssignmentQuery,
  CrewAssignmentResponse,
  DepartCommand,
  ExecutionCommand,
  FinishCommand,
  FulfillmentCommand,
  OrderExecutionResponse,
  TaskResultCommand,
} from '@furniture-delivery/contracts';
import type { EntityManager } from 'typeorm';
import { DateTime } from 'luxon';
import { DatabaseService } from '../database/database.service';
import { CrewAssignment } from '../planning/crew-assignment.entity';
import { Appointment } from '../planning/appointment.entity';
import { Task } from '../planning/task.entity';
import { OrderItem } from '../orders/order-item.entity';
import { requireOpenOrder } from '../completion/completion-state';
import { Order } from '../orders/order.entity';
import { ActivityLog } from '../orders/activity-log.entity';
import { CrewMember } from '../identity/crew-member.entity';
import { PlanningConflict } from '../planning/planning-errors';
import { readOrderAppointments } from '../planning/planning-projection';
import {
  authorizeCrewAssignment,
  lockExecutionUser,
  type CrewExecutionContext,
  type ExecutionActor,
} from './execution-access';
import { businessDate, crewSummary, readCrewAssignment } from './execution-projection';
import {
  executionFingerprint,
  findExecutionReceipt,
  mapExecutionReceipt,
  saveExecutionReceipt,
} from './execution-receipts';
import { ExecutionReceipt } from './execution-receipt.entity';
import { FinishReport } from './finish-report.entity';
import { ReturnVisitAttempt } from './return-visit-attempt.entity';
import { finishReturnAttempt } from '../return-visits/return-lifecycle';
import { ReturnVisitRequest } from './return-visit-request.entity';
import { mapCrewItem, mapCrewTask } from './execution-mappers';
import { readExecutionEvidence } from './execution-evidence-port';
import { readOrderExecutionState, readOrderExecution } from './execution-state';

const conflict = (code: string, message: string): never => {
  throw new PlanningConflict(code, message);
};
const increment = (value: number): number =>
  value >= 2147483647 ? conflict('VERSION_LIMIT', 'Revision limit reached.') : value + 1;
@Injectable()
export class ExecutionService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  async list(
    actor: ExecutionActor,
    input: CrewAssignmentQuery,
  ): Promise<CrewAssignmentListResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('REPEATABLE READ', async (manager) => {
      await lockExecutionUser(manager, actor, ['CREW_MEMBER']);
      const now = DateTime.fromJSDate(new Date(), { zone: 'Europe/Rome' });
      const start = now.startOf('day').toJSDate(),
        end = now.startOf('day').plus({ days: 1 }).toJSDate();
      const query = manager
        .getRepository(CrewAssignment)
        .createQueryBuilder('a')
        .innerJoin(Appointment, 'v', 'v.id = a.appointmentId')
        .innerJoin(
          CrewMember,
          'member',
          'member.crewId = a.crewId AND member.userId = :actorId AND member.active',
          { actorId: actor.id },
        )
        .where("a.status = 'ASSIGNED' AND v.status = 'SCHEDULED'");
      if (input.view === 'today')
        query.andWhere('v.plannedStartAt >= :start AND v.plannedStartAt < :end', { start, end });
      if (input.view === 'upcoming')
        query.andWhere("v.plannedStartAt >= :end AND a.executionStatus = 'NOT_STARTED'", { end });
      if (input.view === 'open') query.andWhere("a.executionStatus <> 'COMPLETED'");
      if (input.view === 'completed') query.andWhere("a.executionStatus = 'COMPLETED'");
      const total = await query.getCount();
      const assignments = await query
        .orderBy('v.plannedStartAt', 'ASC')
        .addOrderBy('a.id', 'ASC')
        .offset((input.page - 1) * input.pageSize)
        .limit(input.pageSize)
        .getMany();
      const rows = [];
      for (const assignment of assignments)
        rows.push({
          ...crewSummary(
            await authorizeCrewAssignment(manager, actor, assignment.id, { lock: false }),
          ),
          orderProgress: (
            await readOrderExecutionState(
              manager,
              (
                await manager
                  .getRepository(Appointment)
                  .findOneByOrFail({ id: assignment.appointmentId })
              ).orderId,
            )
          ).progress,
        });
      return {
        assignments: rows,
        total,
        page: input.page,
        pageSize: input.pageSize,
        businessDate: businessDate(),
        timeZone: 'Europe/Rome',
      };
    });
  }
  async detail(actor: ExecutionActor, id: string): Promise<CrewAssignmentResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('REPEATABLE READ', async (manager) => {
      await lockExecutionUser(manager, actor, ['CREW_MEMBER']);
      return {
        assignment: await readCrewAssignment(
          manager,
          await authorizeCrewAssignment(manager, actor, id, { lock: false }),
        ),
      };
    });
  }
  private async response(
    manager: EntityManager,
    context: CrewExecutionContext,
    receipt: ExecutionReceipt,
  ): Promise<CrewAssignmentResponse> {
    return {
      assignment: await readCrewAssignment(manager, context),
      receipt: mapExecutionReceipt(receipt),
    };
  }
  private async audit(
    manager: EntityManager,
    c: CrewExecutionContext,
    actorId: string,
    action: ActivityAction,
    targetId: string,
    changes: Record<string, unknown>,
    reason: string | null = null,
  ): Promise<void> {
    await manager.save(
      ActivityLog,
      manager.create(ActivityLog, {
        orderId: c.order.id,
        actorId,
        action,
        targetId,
        changes: { ...changes, ...(reason ? { reason } : {}) },
        reason: reason?.slice(0, 1000) ?? null,
      }),
    );
    markExecution(manager, c.order.id);
  }
  private async touch(
    manager: EntityManager,
    c: CrewExecutionContext,
    actorId: string,
  ): Promise<void> {
    c.assignment.executionVersion = increment(c.assignment.executionVersion);
    c.order.version = increment(c.order.version);
    c.order.updatedBy = actorId;
    await manager.save(CrewAssignment, c.assignment);
    await manager.save(Order, c.order);
  }
  private requireVersion(c: CrewExecutionContext, expected: number): void {
    if (c.assignment.executionVersion !== expected)
      conflict('STALE_EXECUTION', 'Execution changed. Reload the current assignment.');
  }
  private requireWorking(c: CrewExecutionContext): void {
    if (c.assignment.executionStatus !== 'IN_PROGRESS')
      conflict('EXECUTION_TRANSITION', 'Task and quantity changes require work in progress.');
  }
  async action(
    actor: ExecutionActor,
    id: string,
    action: 'DEPART' | 'ARRIVE' | 'START',
    input: ExecutionCommand | DepartCommand,
  ): Promise<CrewAssignmentResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      const c = await authorizeCrewAssignment(manager, actor, id, { lock: true });
      const fingerprint = executionFingerprint({ action, ...input });
      const replay = await findExecutionReceipt(
        manager,
        actor.id,
        id,
        action,
        input.operationKey,
        fingerprint,
      );
      if (replay) return this.response(manager, c, replay);
      await requireOpenOrder(manager, c.order);
      this.requireVersion(c, input.expectedExecutionVersion);
      const before = c.assignment.executionStatus;
      const now = new Date();
      const previousActual =
        c.assignment.actualStartAt ?? c.assignment.arrivedAt ?? c.assignment.departedAt;
      if (previousActual && now < previousActual)
        conflict(
          'CLOCK_CHANGED',
          'The server clock precedes the previous recorded action. Retry after the clock is corrected.',
        );
      if (action === 'DEPART') {
        if (before !== 'NOT_STARTED')
          conflict('EXECUTION_TRANSITION', 'This assignment has already departed.');
        if (
          !('expectedAppointmentVersion' in input) ||
          c.appointment.version !== input.expectedAppointmentVersion
        )
          conflict(
            'STALE_APPOINTMENT',
            'The planned appointment changed. Reload before departing.',
          );
        if (!c.crew.active) conflict('CREW_INACTIVE', 'An inactive team cannot depart.');
        if (c.appointment.confirmationStatus !== 'CONFIRMED')
          conflict(
            'CONFIRMATION_REQUIRED',
            'The client must confirm this appointment before departure.',
          );
        if (businessDate(c.appointment.plannedStartAt) !== businessDate(now))
          conflict(
            'WRONG_BUSINESS_DATE',
            'Departure is available only on the planned date in Europe/Rome.',
          );
        const active = await manager
          .getRepository(CrewAssignment)
          .createQueryBuilder('a')
          .where(
            "a.crewId = :crewId AND a.status = 'ASSIGNED' AND a.executionStatus IN ('ON_THE_WAY','ARRIVED','IN_PROGRESS')",
            { crewId: c.crew.id },
          )
          .getExists();
        if (active)
          conflict('CREW_ALREADY_EXECUTING', 'This team already has an active execution.');
        c.assignment.executionStatus = 'ON_THE_WAY';
        c.assignment.departedAt = now;
      } else if (action === 'ARRIVE') {
        if (before !== 'ON_THE_WAY')
          conflict('EXECUTION_TRANSITION', 'Arrival requires an assignment on the way.');
        c.assignment.executionStatus = 'ARRIVED';
        c.assignment.arrivedAt = now;
      } else {
        if (before !== 'ARRIVED')
          conflict('EXECUTION_TRANSITION', 'Work can start only after arrival.');
        c.assignment.executionStatus = 'IN_PROGRESS';
        c.assignment.actualStartAt = now;
      }
      await this.touch(manager, c, actor.id);
      const auditAction =
        action === 'DEPART'
          ? 'EXECUTION_DEPARTED'
          : action === 'ARRIVE'
            ? 'EXECUTION_ARRIVED'
            : 'EXECUTION_STARTED';
      await this.audit(manager, c, actor.id, auditAction, id, {
        before,
        after: c.assignment.executionStatus,
        actualAt: now.toISOString(),
        executionVersion: c.assignment.executionVersion,
      });
      const receipt = await saveExecutionReceipt(
        manager,
        actor.id,
        id,
        action,
        input.operationKey,
        fingerprint,
        id,
      );
      return this.response(manager, c, receipt);
    });
  }
  async taskResult(
    actor: ExecutionActor,
    id: string,
    taskId: string,
    input: TaskResultCommand,
  ): Promise<CrewAssignmentResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      const c = await authorizeCrewAssignment(manager, actor, id, { lock: true });
      const task = await manager.getRepository(Task).findOne({
        where: { id: taskId, assignmentId: id, active: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!task) throw new NotFoundException('Task not found.');
      const fingerprint = executionFingerprint({ taskId, ...input });
      const replay = await findExecutionReceipt(
        manager,
        actor.id,
        id,
        'TASK_RESULT',
        input.operationKey,
        fingerprint,
      );
      if (replay) return this.response(manager, c, replay);
      await requireOpenOrder(manager, c.order);
      this.requireWorking(c);
      if (task.resultVersion !== input.expectedTaskVersion)
        conflict('STALE_TASK', 'This task result changed. Reload the assignment.');
      if (input.resultStatus === 'SKIPPED' && task.required)
        throw new BadRequestException('A required task cannot be skipped.');
      if (input.resultStatus === 'SKIPPED' && !input.reason)
        throw new BadRequestException('Skipping an optional task requires a reason.');
      if (input.resultStatus === 'PENDING' && task.resultStatus !== 'PENDING' && !input.reason)
        throw new BadRequestException('Resetting a task requires a reason.');
      if (
        task.resultStatus !== input.resultStatus ||
        task.resultReason !== (input.reason ?? null)
      ) {
        const before = mapCrewTask(task);
        task.resultStatus = input.resultStatus;
        task.resultReason = input.reason ?? null;
        task.resultVersion = increment(task.resultVersion);
        task.doneBy = input.resultStatus === 'PENDING' ? null : actor.id;
        task.doneAt = input.resultStatus === 'PENDING' ? null : new Date();
        await manager.save(Task, task);
        await this.touch(manager, c, actor.id);
        await this.audit(
          manager,
          c,
          actor.id,
          'TASK_RESULT_CHANGED',
          task.id,
          { before, after: mapCrewTask(task) },
          input.reason ?? null,
        );
      }
      return this.response(
        manager,
        c,
        await saveExecutionReceipt(
          manager,
          actor.id,
          id,
          'TASK_RESULT',
          input.operationKey,
          fingerprint,
          taskId,
        ),
      );
    });
  }
  async fulfillment(
    actor: ExecutionActor,
    id: string,
    itemId: string,
    input: FulfillmentCommand,
  ): Promise<CrewAssignmentResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      const c = await authorizeCrewAssignment(manager, actor, id, { lock: true });
      const item = await manager.getRepository(OrderItem).findOne({
        where: { id: itemId, orderId: c.order.id, active: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) throw new NotFoundException('Item not found.');
      const fingerprint = executionFingerprint({ itemId, ...input });
      const replay = await findExecutionReceipt(
        manager,
        actor.id,
        id,
        'ITEM_FULFILLMENT',
        input.operationKey,
        fingerprint,
      );
      if (replay) return this.response(manager, c, replay);
      await requireOpenOrder(manager, c.order);
      this.requireWorking(c);
      if (item.fulfillmentVersion !== input.expectedFulfillmentVersion)
        conflict(
          'STALE_FULFILLMENT',
          'These accumulated quantities changed. Reload the assignment.',
        );
      if (
        input.assembledQuantity > input.deliveredQuantity ||
        input.deliveredQuantity > item.quantity
      )
        throw new BadRequestException('Quantities must satisfy assembled ≤ delivered ≤ ordered.');
      if (
        (!item.requiresAssembly || c.order.serviceType === 'DELIVERY_ONLY') &&
        input.assembledQuantity !== 0
      )
        throw new BadRequestException('This item does not require assembly.');
      if (
        (input.deliveredQuantity < item.deliveredQuantity ||
          input.assembledQuantity < item.assembledQuantity) &&
        !input.reason
      )
        throw new BadRequestException('Reducing an accumulated quantity requires a reason.');
      if (
        input.deliveredQuantity !== item.deliveredQuantity ||
        input.assembledQuantity !== item.assembledQuantity
      ) {
        const before = {
          deliveredQuantity: item.deliveredQuantity,
          assembledQuantity: item.assembledQuantity,
          fulfillmentVersion: item.fulfillmentVersion,
        };
        item.deliveredQuantity = input.deliveredQuantity;
        item.assembledQuantity = input.assembledQuantity;
        item.fulfillmentVersion = increment(item.fulfillmentVersion);
        await manager.save(OrderItem, item);
        await this.touch(manager, c, actor.id);
        await this.audit(
          manager,
          c,
          actor.id,
          'ITEM_FULFILLMENT',
          item.id,
          {
            before,
            after: {
              deliveredQuantity: item.deliveredQuantity,
              assembledQuantity: item.assembledQuantity,
              fulfillmentVersion: item.fulfillmentVersion,
            },
          },
          input.reason ?? null,
        );
      }
      return this.response(
        manager,
        c,
        await saveExecutionReceipt(
          manager,
          actor.id,
          id,
          'ITEM_FULFILLMENT',
          input.operationKey,
          fingerprint,
          itemId,
        ),
      );
    });
  }
  async finish(
    actor: ExecutionActor,
    id: string,
    input: FinishCommand,
  ): Promise<CrewAssignmentResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      const c = await authorizeCrewAssignment(manager, actor, id, { lock: true });
      const fingerprint = executionFingerprint(input);
      const replay = await findExecutionReceipt(
        manager,
        actor.id,
        id,
        'FINISH',
        input.operationKey,
        fingerprint,
      );
      if (replay) return this.response(manager, c, replay);
      await requireOpenOrder(manager, c.order);
      this.requireVersion(c, input.expectedExecutionVersion);
      if (
        input.outcome === 'BLOCKED'
          ? !['ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS'].includes(c.assignment.executionStatus)
          : c.assignment.executionStatus !== 'IN_PROGRESS'
      )
        conflict(
          'EXECUTION_TRANSITION',
          'This outcome is not available from the current execution state.',
        );
      const tasks = await manager
        .getRepository(Task)
        .find({ where: { assignmentId: id, active: true }, order: { priority: 'ASC', id: 'ASC' } });
      if (
        input.outcome === 'COMPLETED' &&
        tasks.some((t) => (t.required ? t.resultStatus !== 'DONE' : t.resultStatus === 'PENDING'))
      )
        conflict(
          'TASKS_INCOMPLETE',
          'Complete required tasks and complete or explicitly skip every optional task.',
        );
      const items = await manager.getRepository(OrderItem).find({
        where: { orderId: c.order.id, active: true },
        order: { sortOrder: 'ASC', id: 'ASC' },
      });
      const evidence = await readExecutionEvidence(manager, c.order.id, {
        crewVisible: true,
        assignmentId: id,
      });
      const now = new Date(),
        before = c.assignment.executionStatus;
      const previousActual =
        c.assignment.actualStartAt ?? c.assignment.arrivedAt ?? c.assignment.departedAt;
      if (previousActual && now < previousActual)
        conflict(
          'CLOCK_CHANGED',
          'The server clock precedes the previous recorded action. Retry after the clock is corrected.',
        );
      const report = await manager.save(
        FinishReport,
        manager.create(FinishReport, {
          orderId: c.order.id,
          appointmentId: c.appointment.id,
          assignmentId: id,
          outcome: input.outcome,
          summary: input.summary,
          reason: input.reason ?? null,
          remainingWork: input.remainingWork ?? null,
          quantityScope: 'ACCUMULATED_ORDER',
          taskResults: tasks.map(mapCrewTask),
          quantities: items.map(mapCrewItem),
          knownIssueIds: evidence.knownIssueIds,
          attachmentIds: evidence.knownAttachmentIds,
          authorId: actor.id,
          actualEndAt: now,
        }),
      );
      const followUp = await manager
        .getRepository(ReturnVisitAttempt)
        .findOneBy({ appointmentId: c.appointment.id });
      if (input.returnVisitRequired && !followUp) {
        const request = await manager.save(
          ReturnVisitRequest,
          manager.create(ReturnVisitRequest, {
            orderId: c.order.id,
            appointmentId: c.appointment.id,
            assignmentId: id,
            finishReportId: report.id,
            status: 'OPEN',
            reason: input.returnReason!,
            remainingWork: input.remainingWork!,
            authorId: actor.id,
          }),
        );
        await this.audit(
          manager,
          c,
          actor.id,
          'RETURN_VISIT_REQUESTED',
          request.id,
          { assignmentId: id, finishReportId: report.id },
          input.returnReason ?? null,
        );
      }
      c.assignment.executionStatus = input.outcome;
      c.assignment.actualEndAt = now;
      await this.touch(manager, c, actor.id);
      await finishReturnAttempt(manager, c.appointment.id, actor.id, input);
      await this.audit(
        manager,
        c,
        actor.id,
        'EXECUTION_FINISHED',
        id,
        {
          before,
          after: input.outcome,
          finishReportId: report.id,
          actualEndAt: now.toISOString(),
          returnVisitRequired: input.returnVisitRequired,
        },
        input.reason ?? null,
      );
      return this.response(
        manager,
        c,
        await saveExecutionReceipt(
          manager,
          actor.id,
          id,
          'FINISH',
          input.operationKey,
          fingerprint,
          report.id,
        ),
      );
    });
  }
  async orderExecution(actor: ExecutionActor, orderId: string): Promise<OrderExecutionResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('REPEATABLE READ', async (manager) => {
      await lockExecutionUser(manager, actor);
      if (!(await manager.getRepository(Order).existsBy({ id: orderId })))
        throw new NotFoundException('Order not found.');
      return {
        execution: await readOrderExecution(manager, orderId),
        appointments: await readOrderAppointments(manager, orderId),
      };
    });
  }
}
