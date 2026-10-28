import { markPlanning } from '../realtime/realtime-marks';
import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ActivityAction,
  AppointmentListResponse,
  AppointmentResponse,
  CalendarQuery,
  CalendarResponse,
  CreateAppointmentRequest,
  PlannedTaskInput,
  ServiceType,
  UpdateAppointmentRequest,
} from '@furniture-delivery/contracts';
import { DateTime } from 'luxon';
import { In, type EntityManager } from 'typeorm';
import { DatabaseService } from '../database/database.service';
import { Crew } from '../crews/crew.entity';
import { ActivityLog } from '../orders/activity-log.entity';
import { requireOpenOrder } from '../completion/completion-state';
import { Order } from '../orders/order.entity';
import { OrdersService } from '../orders/orders.service';
import { Appointment } from './appointment.entity';
import { CrewAssignment } from './crew-assignment.entity';
import { CrewPlanningConfig } from './crew-planning-config.entity';
import { TaskTemplate } from './task-template.entity';
import { Task } from './task.entity';
import { PlanningConflict } from './planning-errors';
import { BUSINESS_ZONE, resolveLocalWindow, validateRange } from './planning-time';
import { lockExecutionUser } from '../execution/execution-access';
import { ReturnVisitAttempt } from '../execution/return-visit-attempt.entity';
import { cancelReturnAttempt } from '../return-visits/return-lifecycle';
import {
  readAppointment,
  readOrderAppointments,
  reservationAttention,
} from './planning-projection';

export function appointmentFingerprint(input: CreateAppointmentRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.localStart.trim(),
        input.durationMinutes,
        [...input.crewIds].sort(),
        [...(input.templateIds ?? [])].sort(),
        input.notes?.trim() ?? '',
      ]),
    )
    .digest('hex');
}
function applicable(template: TaskTemplate, service: ServiceType): boolean {
  return template.applicability === 'ALL' || template.applicability === service;
}

@Injectable()
export class PlanningService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(OrdersService) private readonly orders: OrdersService,
  ) {}

  private async orderLock(manager: EntityManager, id: string): Promise<Order> {
    const order = await manager
      .getRepository(Order)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!order) throw new NotFoundException('Order not found.');
    return order;
  }
  private async appointmentLock(
    manager: EntityManager,
    orderId: string,
    id: string,
  ): Promise<Appointment> {
    const appointment = await manager
      .getRepository(Appointment)
      .findOne({ where: { id, orderId }, lock: { mode: 'pessimistic_write' } });
    if (!appointment) throw new NotFoundException('Appointment not found for this order.');
    return appointment;
  }
  private async crewLocks(manager: EntityManager, ids: string[]): Promise<Map<string, Crew>> {
    const crews = new Map<string, Crew>();
    // Always lock the entire union in UUID order, never request an Order while holding Crew.
    for (const id of [...new Set(ids)].sort()) {
      const crew = await manager
        .getRepository(Crew)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!crew) throw new NotFoundException('Team not found.');
      crews.set(id, crew);
    }
    return crews;
  }
  private requireVersion(appointment: Appointment, expectedVersion: number): void {
    if (appointment.version !== expectedVersion)
      throw new PlanningConflict(
        'STALE_APPOINTMENT_VERSION',
        'This visit changed. Reload it before saving.',
        { appointmentId: appointment.id },
      );
  }
  private requireScheduled(appointment: Appointment): void {
    if (appointment.status !== 'SCHEDULED')
      throw new PlanningConflict(
        'APPOINTMENT_CANCELLED',
        'This visit is cancelled and cannot be changed.',
        { appointmentId: appointment.id },
      );
  }
  private async touch(
    manager: EntityManager,
    order: Order,
    appointment: Appointment,
    actorId: string,
  ): Promise<void> {
    if (order.version >= 2147483647 || appointment.version >= 2147483647)
      throw new PlanningConflict('REVISION_LIMIT', 'The record revision limit has been reached.');
    order.version += 1;
    order.updatedBy = actorId;
    appointment.version += 1;
    appointment.updatedBy = actorId;
    await manager.save(Appointment, appointment);
    await manager.save(Order, order);
  }
  private async touchOrder(manager: EntityManager, order: Order, actorId: string): Promise<void> {
    if (order.version >= 2147483647)
      throw new PlanningConflict('REVISION_LIMIT', 'The order revision limit has been reached.');
    order.version += 1;
    order.updatedBy = actorId;
    await manager.save(Order, order);
  }
  private async audit(
    manager: EntityManager,
    orderId: string,
    appointmentId: string,
    actorId: string,
    action: ActivityAction,
    changes: Record<string, unknown>,
    reason: string | null = null,
  ): Promise<void> {
    await manager.save(
      ActivityLog,
      manager.create(ActivityLog, {
        orderId,
        targetId: appointmentId,
        actorId,
        action,
        changes,
        reason,
      }),
    );
    if (action !== 'APPOINTMENT_UPDATED')
      markPlanning(
        manager,
        orderId,
        Array.isArray(changes.crewIds) ? (changes.crewIds as string[]) : [],
      );
  }
  async responseInTransaction(
    manager: EntityManager,
    orderId: string,
    appointmentId: string,
  ): Promise<AppointmentResponse> {
    return {
      appointment: await readAppointment(manager, appointmentId),
      order: await this.orders.detailIn(manager, orderId),
    };
  }
  private async verifyReservation(
    manager: EntityManager,
    crew: Crew,
    appointment: Pick<Appointment, 'plannedStartAt' | 'plannedEndAt'>,
    buffer: number,
    exclude?: string,
  ): Promise<void> {
    const issues = await reservationAttention(
      manager,
      crew,
      appointment.plannedStartAt,
      appointment.plannedEndAt,
      buffer,
      exclude,
    );
    const issue = issues[0];
    if (issue)
      throw new PlanningConflict(issue.code, issue.message, {
        crewId: issue.crewId,
        appointmentId: issue.appointmentId,
        from: issue.from,
        to: issue.to,
      });
  }
  private async templates(
    manager: EntityManager,
    service: ServiceType,
    selected: readonly string[],
    includeRequired = true,
  ): Promise<TaskTemplate[]> {
    const active = await manager
      .getRepository(TaskTemplate)
      .find({ where: { active: true }, order: { defaultPriority: 'ASC', id: 'ASC' } });
    const selectedSet = new Set(selected);
    for (const id of selectedSet)
      if (!active.some((template) => template.id === id && applicable(template, service)))
        throw new BadRequestException(
          'A selected task template is inactive, missing or unsuitable for this service.',
        );
    const result = active.filter(
      (template) =>
        applicable(template, service) &&
        ((includeRequired && template.required) || selectedSet.has(template.id)),
    );
    if (result.length > 100)
      throw new BadRequestException(
        'An assignment supports at most 100 required and selected tasks. Review the template catalog.',
      );
    return result;
  }
  private async snapshot(
    manager: EntityManager,
    assignmentId: string,
    template: TaskTemplate,
    input?: PlannedTaskInput,
  ): Promise<void> {
    await manager.save(
      Task,
      manager.create(Task, {
        assignmentId,
        templateId: template.id,
        name: template.name,
        description: template.description,
        required: template.required,
        severity: input?.severity ?? template.severity,
        priority: input?.priority ?? template.defaultPriority,
        active: true,
      }),
    );
  }
  private async newAssignment(
    manager: EntityManager,
    appointmentId: string,
    crew: Crew,
    templates: TaskTemplate[],
  ): Promise<CrewAssignment> {
    const config = await manager.getRepository(CrewPlanningConfig).findOneBy({ crewId: crew.id });
    const assignment = await manager.save(
      CrewAssignment,
      manager.create(CrewAssignment, {
        appointmentId,
        crewId: crew.id,
        status: 'ASSIGNED',
        travelBufferMinutes: config?.travelBufferMinutes ?? 30,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
      }),
    );
    for (const template of templates) await this.snapshot(manager, assignment.id, template);
    return assignment;
  }
  async list(orderId: string): Promise<AppointmentListResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('REPEATABLE READ', async (manager) => {
      if (!(await manager.getRepository(Order).existsBy({ id: orderId })))
        throw new NotFoundException('Order not found.');
      return { appointments: await readOrderAppointments(manager, orderId) };
    });
  }
  async detail(orderId: string, id: string): Promise<AppointmentResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('REPEATABLE READ', async (manager) => {
      if (!(await manager.getRepository(Appointment).existsBy({ id, orderId })))
        throw new NotFoundException('Appointment not found for this order.');
      return this.responseInTransaction(manager, orderId, id);
    });
  }
  async create(
    orderId: string,
    input: CreateAppointmentRequest,
    actorId: string,
    sessionId?: string,
  ): Promise<AppointmentResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      await lockExecutionUser(manager, { id: actorId, sessionId });
      const order = await this.orderLock(manager, orderId);
      const prior = await manager
        .getRepository(Appointment)
        .createQueryBuilder('appointment')
        .addSelect('appointment.fingerprint')
        .where('appointment.orderId = :orderId AND appointment.idempotencyKey = :key', {
          orderId,
          key: input.idempotencyKey,
        })
        .getOne();
      const fingerprint = appointmentFingerprint(input);
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new PlanningConflict(
            'IDEMPOTENCY_CONFLICT',
            'This operation key was used for different visit details.',
            { appointmentId: prior.id },
          );
        return this.responseInTransaction(manager, orderId, prior.id);
      }
      await requireOpenOrder(manager, order);
      const window = resolveLocalWindow(input.localStart, input.durationMinutes);
      const crews = await this.crewLocks(manager, input.crewIds);
      const templates = await this.templates(
        manager,
        order.serviceType,
        input.templateIds ?? [],
        crews.size > 0,
      );
      for (const crew of crews.values()) {
        const config = await manager
          .getRepository(CrewPlanningConfig)
          .findOneBy({ crewId: crew.id });
        await this.verifyReservation(manager, crew, window, config?.travelBufferMinutes ?? 30);
      }
      const appointment = await manager.save(
        Appointment,
        manager.create(Appointment, {
          ...window,
          orderId,
          notes: input.notes ?? '',
          idempotencyKey: input.idempotencyKey,
          fingerprint,
          status: 'SCHEDULED',
          confirmationStatus: 'NEEDS_CONFIRMATION',
          confirmedAt: null,
          confirmedBy: null,
          cancelledAt: null,
          cancelledBy: null,
          cancelReason: null,
          version: 1,
          createdBy: actorId,
          updatedBy: actorId,
        }),
      );
      for (const crew of crews.values())
        await this.newAssignment(manager, appointment.id, crew, templates);
      await this.touchOrder(manager, order, actorId);
      await this.audit(manager, orderId, appointment.id, actorId, 'APPOINTMENT_CREATED', {
        plannedStartAt: appointment.plannedStartAt.toISOString(),
        plannedEndAt: appointment.plannedEndAt.toISOString(),
        crewIds: [...crews.keys()],
      });
      return this.responseInTransaction(manager, orderId, appointment.id);
    });
  }
  private async editTasks(
    manager: EntityManager,
    assignment: CrewAssignment,
    input: PlannedTaskInput[],
    service: ServiceType,
  ): Promise<boolean> {
    const current = await manager
      .getRepository(Task)
      .find({ where: { assignmentId: assignment.id, active: true } });
    const byId = new Map(current.map((task) => [task.id, task]));
    const supplied = new Set(input.flatMap((task) => (task.id ? [task.id] : [])));
    for (const task of current)
      if (task.required && !supplied.has(task.id))
        throw new BadRequestException('Required task snapshots cannot be removed.');
    for (const task of input)
      if (task.id && !byId.has(task.id))
        throw new NotFoundException('Task does not belong to this active assignment.');
    const additions = await this.templates(
      manager,
      service,
      input.flatMap((task) => (task.templateId ? [task.templateId] : [])),
      false,
    );
    let changed = false;
    for (const task of current)
      if (!supplied.has(task.id)) {
        task.active = false;
        await manager.save(Task, task);
        changed = true;
      }
    const activeTemplateIds = new Set(
      current.filter((task) => supplied.has(task.id)).map((task) => task.templateId),
    );
    for (const task of input) {
      if (task.id) {
        const record = byId.get(task.id)!;
        if (record.severity !== task.severity || record.priority !== task.priority) {
          record.severity = task.severity;
          record.priority = task.priority;
          await manager.save(Task, record);
          changed = true;
        }
      } else if (task.templateId) {
        if (activeTemplateIds.has(task.templateId))
          throw new BadRequestException(
            'A template already has an active snapshot in this assignment.',
          );
        const template = additions.find((template) => template.id === task.templateId);
        if (!template) throw new BadRequestException('Task template not available.');
        await this.snapshot(manager, assignment.id, template, task);
        activeTemplateIds.add(task.templateId);
        changed = true;
      }
    }
    return changed;
  }
  private async hasDeparted(manager: EntityManager, appointmentId: string): Promise<boolean> {
    return manager
      .getRepository(CrewAssignment)
      .createQueryBuilder('assignment')
      .where('assignment.appointmentId = :appointmentId AND assignment.departedAt IS NOT NULL', {
        appointmentId,
      })
      .getExists();
  }
  private async tasksWouldChange(
    manager: EntityManager,
    assignments: CrewAssignment[],
    requested: string[],
    edits: UpdateAppointmentRequest['tasks'],
  ): Promise<boolean> {
    let changed = false;
    for (const edit of edits ?? []) {
      const assignment = assignments.find(
        (record) => record.id === edit.assignmentId && requested.includes(record.crewId),
      );
      if (!assignment)
        throw new NotFoundException('Assignment does not belong to the current visit composition.');
      const current = await manager.getRepository(Task).find({
        where: { assignmentId: assignment.id, active: true },
      });
      changed =
        changed ||
        current.length !== edit.tasks.length ||
        edit.tasks.some((input) => {
          const task = input.id ? current.find((record) => record.id === input.id) : undefined;
          return !task || task.severity !== input.severity || task.priority !== input.priority;
        });
    }
    return changed;
  }
  async update(
    orderId: string,
    id: string,
    input: UpdateAppointmentRequest,
    actorId: string,
    sessionId?: string,
  ): Promise<AppointmentResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', (manager) =>
      this.updateInTransaction(manager, orderId, id, input, actorId, sessionId),
    );
  }
  /** Reuses the same M4 rules and lock order for explicit M6 commands and their receipt. */
  async updateInTransaction(
    manager: EntityManager,
    orderId: string,
    id: string,
    input: UpdateAppointmentRequest,
    actorId: string,
    sessionId?: string,
    options: { requireUnstarted?: boolean; rejectPastStart?: boolean } = {},
  ): Promise<AppointmentResponse> {
    await lockExecutionUser(manager, { id: actorId, sessionId });
    const order = await this.orderLock(manager, orderId);
    const appointment = await this.appointmentLock(manager, orderId, id);
    this.requireVersion(appointment, input.expectedVersion);
    this.requireScheduled(appointment);
    const returnAttempt = await manager
      .getRepository(ReturnVisitAttempt)
      .findOneBy({ appointmentId: id, current: true });
    if (returnAttempt && input.tasks !== undefined)
      throw new PlanningConflict(
        'RETURN_SCOPE_IMMUTABLE',
        'Follow-up task scope must be preserved. Plan explicit remaining work through the return request.',
      );
    const previous = await manager
      .getRepository(CrewAssignment)
      .find({ where: { appointmentId: id, status: 'ASSIGNED' } });
    const oldCrews = previous.map((assignment) => assignment.crewId).sort(),
      requested = input.crewIds ?? oldCrews;
    if (returnAttempt && !requested.length)
      throw new PlanningConflict(
        'RETURN_SCOPE_IMMUTABLE',
        'A follow-up needs a team responsible for its planned scope.',
      );
    const localStart =
      input.localStart ??
      DateTime.fromJSDate(appointment.plannedStartAt, { zone: BUSINESS_ZONE }).toFormat(
        "yyyy-MM-dd'T'HH:mm",
      );
    const window = resolveLocalWindow(
      localStart,
      input.durationMinutes ?? appointment.durationMinutes,
    );
    const timeChanged =
      window.plannedStartAt.getTime() !== appointment.plannedStartAt.getTime() ||
      window.plannedEndAt.getTime() !== appointment.plannedEndAt.getTime();
    const crewsChanged = JSON.stringify(oldCrews) !== JSON.stringify([...requested].sort());
    const tasksChanged = await this.tasksWouldChange(manager, previous, requested, input.tasks);
    if (timeChanged || crewsChanged || tasksChanged) await requireOpenOrder(manager, order);
    if (
      (options.requireUnstarted || timeChanged || crewsChanged || tasksChanged) &&
      (await this.hasDeparted(manager, id))
    )
      throw new PlanningConflict(
        'EXECUTION_STARTED',
        'A team has already departed. This visit cannot be moved, cancelled or have its teams/tasks rewritten; add a note instead.',
        { appointmentId: id },
      );
    const crews = await this.crewLocks(manager, [...oldCrews, ...requested]);
    await lockExecutionUser(manager, { id: actorId, sessionId });
    if (options.rejectPastStart && window.plannedStartAt < new Date())
      throw new BadRequestException('A new visit time cannot be earlier than server time.');
    if ((timeChanged || crewsChanged) && !input.reason?.trim())
      throw new BadRequestException(
        'A reason is required when changing the visit time or assigned teams.',
      );
    if (timeChanged || crewsChanged)
      for (const crewId of requested) {
        const retained = previous.find((assignment) => assignment.crewId === crewId);
        const config = await manager.getRepository(CrewPlanningConfig).findOneBy({ crewId });
        await this.verifyReservation(
          manager,
          crews.get(crewId)!,
          window,
          retained?.travelBufferMinutes ?? config?.travelBufferMinutes ?? 30,
          id,
        );
      }
    const beforeWindow = {
      plannedStartAt: appointment.plannedStartAt.toISOString(),
      plannedEndAt: appointment.plannedEndAt.toISOString(),
      confirmationStatus: appointment.confirmationStatus,
      confirmedAt: appointment.confirmedAt?.toISOString() ?? null,
      confirmedBy: appointment.confirmedBy,
    };
    let changed =
      timeChanged ||
      crewsChanged ||
      (input.notes !== undefined && input.notes !== appointment.notes);
    if (timeChanged) {
      Object.assign(appointment, window);
      appointment.confirmationStatus = 'NEEDS_CONFIRMATION';
      appointment.confirmedAt = null;
      appointment.confirmedBy = null;
    }
    if (input.notes !== undefined) appointment.notes = input.notes;
    for (const assignment of previous)
      if (!requested.includes(assignment.crewId)) {
        assignment.status = 'CANCELLED';
        assignment.cancelledAt = new Date();
        assignment.cancelledBy = actorId;
        assignment.cancelReason = input.reason!;
        await manager.save(CrewAssignment, assignment);
      }
    const newCrewIds = requested.filter((crewId) => !oldCrews.includes(crewId));
    const templates =
      newCrewIds.length && !returnAttempt
        ? await this.templates(manager, order.serviceType, [])
        : [];
    const activeByCrew = new Map(
      previous
        .filter((assignment) => requested.includes(assignment.crewId))
        .map((assignment) => [assignment.crewId, assignment]),
    );
    for (const crewId of requested)
      if (!oldCrews.includes(crewId))
        activeByCrew.set(
          crewId,
          await this.newAssignment(manager, id, crews.get(crewId)!, templates),
        );
    if (returnAttempt && crewsChanged) {
      const sourceAssignments = new Set(previous.map((assignment) => assignment.id));
      const scopeTasks = await manager.getRepository(Task).find({
        where: { assignmentId: In([...sourceAssignments]), active: true },
        order: { id: 'ASC' },
      });
      const keys = scopeTasks.map((task) => task.returnScopeKey);
      const expectedKeys = new Set(returnAttempt.scope.tasks.map((task) => task.key));
      if (
        keys.some((key) => key === null || !expectedKeys.has(key)) ||
        new Set(keys).size !== keys.length ||
        keys.length !== expectedKeys.size
      )
        throw new PlanningConflict(
          'RETURN_SCOPE_INCOMPLETE',
          'The follow-up task scope is incomplete. Refresh the return request before changing teams.',
        );
      const removed = new Set(
        previous
          .filter((assignment) => !requested.includes(assignment.crewId))
          .map((assignment) => assignment.id),
      );
      const target = activeByCrew.get([...requested].sort()[0]!)!;
      const transfers: {
        fromTaskId: string;
        taskId: string;
        fromAssignmentId: string;
        assignmentId: string;
        scopeKey: string | null;
      }[] = [];
      for (const task of scopeTasks.filter((task) => removed.has(task.assignmentId))) {
        if (task.resultStatus !== 'PENDING')
          throw new PlanningConflict(
            'EXECUTION_STARTED',
            'A task with execution history cannot be reassigned.',
          );
        const copied = await manager.save(
          Task,
          manager.create(Task, {
            assignmentId: target.id,
            templateId: null,
            sourceTaskId: task.sourceTaskId,
            returnScopeKey: task.returnScopeKey,
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
        transfers.push({
          fromTaskId: task.id,
          taskId: copied.id,
          fromAssignmentId: task.assignmentId,
          assignmentId: target.id,
          scopeKey: task.returnScopeKey,
        });
      }
      if (transfers.length)
        await this.audit(
          manager,
          orderId,
          id,
          actorId,
          'APPOINTMENT_UPDATED',
          { returnScopeTransfers: transfers },
          input.reason ?? null,
        );
    }
    for (const edit of input.tasks ?? []) {
      const assignment = previous.find(
        (assignment) =>
          assignment.id === edit.assignmentId && requested.includes(assignment.crewId),
      );
      if (!assignment)
        throw new NotFoundException('Assignment does not belong to the current visit composition.');
      changed =
        (await this.editTasks(manager, assignment, edit.tasks, order.serviceType)) || changed;
    }
    if (!changed) return this.responseInTransaction(manager, orderId, id);
    markPlanning(
      manager,
      orderId,
      crewsChanged ? [...oldCrews, ...requested] : [],
      timeChanged || crewsChanged || tasksChanged,
    );
    await this.touch(manager, order, appointment, actorId);
    await this.audit(
      manager,
      orderId,
      id,
      actorId,
      'APPOINTMENT_UPDATED',
      {
        fields: Object.keys(input).filter(
          (field) => !['expectedVersion', 'reason'].includes(field),
        ),
        version: appointment.version,
        ...(crewsChanged ? { beforeCrewIds: oldCrews, crewIds: [...requested].sort() } : {}),
        ...(timeChanged
          ? {
              before: beforeWindow,
              plannedStartAt: appointment.plannedStartAt.toISOString(),
              plannedEndAt: appointment.plannedEndAt.toISOString(),
              confirmationStatus: appointment.confirmationStatus,
            }
          : {}),
      },
      input.reason ?? null,
    );
    return this.responseInTransaction(manager, orderId, id);
  }
  async confirm(
    orderId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    sessionId?: string,
  ): Promise<AppointmentResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      await lockExecutionUser(manager, { id: actorId, sessionId });
      const order = await this.orderLock(manager, orderId),
        appointment = await this.appointmentLock(manager, orderId, id);
      this.requireVersion(appointment, expectedVersion);
      this.requireScheduled(appointment);
      const assignments = await manager
        .getRepository(CrewAssignment)
        .find({ where: { appointmentId: id, status: 'ASSIGNED' } });
      await this.crewLocks(
        manager,
        assignments.map(({ crewId }) => crewId),
      );
      if (appointment.confirmationStatus === 'CONFIRMED')
        return this.responseInTransaction(manager, orderId, id);
      appointment.confirmationStatus = 'CONFIRMED';
      appointment.confirmedBy = actorId;
      appointment.confirmedAt = new Date();
      await this.touch(manager, order, appointment, actorId);
      await this.audit(manager, orderId, id, actorId, 'APPOINTMENT_CONFIRMED', {
        plannedStartAt: appointment.plannedStartAt.toISOString(),
        plannedEndAt: appointment.plannedEndAt.toISOString(),
      });
      return this.responseInTransaction(manager, orderId, id);
    });
  }
  async cancel(
    orderId: string,
    id: string,
    expectedVersion: number,
    reason: string,
    actorId: string,
    sessionId?: string,
  ): Promise<AppointmentResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      await lockExecutionUser(manager, { id: actorId, sessionId });
      const order = await this.orderLock(manager, orderId),
        appointment = await this.appointmentLock(manager, orderId, id);
      // A cancelled replay returns the current snapshot even with the original version.
      if (appointment.status === 'CANCELLED')
        return this.responseInTransaction(manager, orderId, id);
      this.requireVersion(appointment, expectedVersion);
      await requireOpenOrder(manager, order);
      if (await this.hasDeparted(manager, id))
        throw new PlanningConflict(
          'EXECUTION_STARTED',
          'A team has already departed. An execution attempt cannot be cancelled or erased.',
          { appointmentId: id },
        );
      const assignments = await manager
        .getRepository(CrewAssignment)
        .find({ where: { appointmentId: id, status: 'ASSIGNED' } });
      await this.crewLocks(
        manager,
        assignments.map(({ crewId }) => crewId),
      );
      await lockExecutionUser(manager, { id: actorId, sessionId });
      const now = new Date();
      appointment.status = 'CANCELLED';
      appointment.cancelledAt = now;
      appointment.cancelledBy = actorId;
      appointment.cancelReason = reason;
      for (const assignment of assignments) {
        assignment.status = 'CANCELLED';
        assignment.cancelledAt = now;
        assignment.cancelledBy = actorId;
        assignment.cancelReason = reason;
        await manager.save(CrewAssignment, assignment);
      }
      await this.touch(manager, order, appointment, actorId);
      markPlanning(
        manager,
        orderId,
        assignments.map(({ crewId }) => crewId),
      );
      await this.audit(manager, orderId, id, actorId, 'APPOINTMENT_CANCELLED', {}, reason);
      await cancelReturnAttempt(manager, appointment, actorId, reason);
      return this.responseInTransaction(manager, orderId, id);
    });
  }
  async calendar(input: CalendarQuery): Promise<CalendarResponse> {
    const range = validateRange(input.from, input.to);
    const source = await this.database.getDataSource();
    return source.transaction('REPEATABLE READ', async (manager) => {
      for (const id of input.crewIds)
        if (!(await manager.getRepository(Crew).existsBy({ id })))
          throw new NotFoundException('A selected team does not exist.');
      const query = manager
        .getRepository(Appointment)
        .createQueryBuilder('appointment')
        .where(
          'appointment.status = :scheduled AND appointment.plannedStartAt < :to AND appointment.plannedEndAt > :from',
          { scheduled: 'SCHEDULED', ...range },
        );
      const anyAssignment = query
        .subQuery()
        .select('1')
        .from(CrewAssignment, 'assignment')
        .where('assignment.appointmentId = appointment.id AND assignment.status = :assigned', {
          assigned: 'ASSIGNED',
        });
      const assignedSql = anyAssignment.getQuery();
      if (input.allTeams) {
        if (!input.includeUnassigned) query.andWhere(`EXISTS ${assignedSql}`);
      } else {
        const filters: string[] = [];
        if (input.crewIds.length) {
          const selected = query
            .subQuery()
            .select('1')
            .from(CrewAssignment, 'selected')
            .where(
              'selected.appointmentId = appointment.id AND selected.status = :assigned AND selected.crewId IN (:...crewIds)',
              { assigned: 'ASSIGNED', crewIds: input.crewIds },
            )
            .getQuery();
          filters.push(`EXISTS ${selected}`);
        }
        if (input.includeUnassigned) filters.push(`NOT EXISTS ${assignedSql}`);
        query.andWhere(filters.length ? `(${filters.join(' OR ')})` : 'false');
      }
      const appointments = await query
        .orderBy('appointment.plannedStartAt', 'ASC')
        .addOrderBy('appointment.id', 'ASC')
        .take(1001)
        .getMany();
      if (appointments.length > 1000)
        throw new PlanningConflict(
          'CALENDAR_RANGE_TOO_BUSY',
          'This range contains over 1000 visits. Narrow the date range or team selection.',
        );
      const details = [];
      for (const appointment of appointments)
        details.push(await readAppointment(manager, appointment.id));
      return {
        appointments: details,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        timeZone: BUSINESS_ZONE,
      };
    });
  }
}
