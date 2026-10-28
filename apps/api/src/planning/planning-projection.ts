import { NotFoundException } from '@nestjs/common';
import type {
  AppointmentDetail,
  AssignmentRecord,
  PlanningAttention,
  PlannedTaskRecord,
} from '@furniture-delivery/contracts';
import type { EntityManager } from 'typeorm';
import { Crew } from '../crews/crew.entity';
import { ReturnVisitAttempt } from '../execution/return-visit-attempt.entity';
import { Order } from '../orders/order.entity';
import { Appointment } from './appointment.entity';
import { CrewAssignment } from './crew-assignment.entity';
import { Task } from './task.entity';
import { reserveEnd } from './planning-time';
import { readCrewReservationState, reservationIssues } from './crew-reservations';
import { mapAssignmentExecution } from '../execution/execution-mappers';
import { readOrderExecutionState } from '../execution/execution-state';

export async function reservationAttention(
  manager: EntityManager,
  crew: Crew,
  start: Date,
  end: Date,
  buffer: number,
  excludeAppointmentId?: string,
): Promise<PlanningAttention[]> {
  const state = await readCrewReservationState(
    manager,
    crew,
    start,
    reserveEnd(end, buffer),
    excludeAppointmentId,
  );
  return reservationIssues(state, start, end, buffer, new Date());
}

function mapTask(task: Task): PlannedTaskRecord {
  return {
    id: task.id,
    assignmentId: task.assignmentId,
    templateId: task.templateId,
    sourceTaskId: task.sourceTaskId ?? null,
    returnScopeKey: task.returnScopeKey ?? null,
    name: task.name,
    description: task.description,
    required: task.required,
    severity: task.severity,
    priority: task.priority,
    active: task.active,
    resultStatus: task.resultStatus,
    resultVersion: task.resultVersion,
    doneBy: task.doneBy,
    doneAt: task.doneAt?.toISOString() ?? null,
    resultReason: task.resultReason,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export async function readAppointment(
  manager: EntityManager,
  id: string,
): Promise<AppointmentDetail> {
  const appointment = await manager.getRepository(Appointment).findOneBy({ id });
  if (!appointment) throw new NotFoundException('Appointment not found.');
  const order = await manager.getRepository(Order).findOneByOrFail({ id: appointment.orderId });
  const assignments = await manager
    .getRepository(CrewAssignment)
    .find({ where: { appointmentId: id }, order: { createdAt: 'ASC', id: 'ASC' } });
  const mapped: AssignmentRecord[] = [];
  const attention: PlanningAttention[] = [];
  for (const assignment of assignments) {
    const crew = await manager.getRepository(Crew).findOneByOrFail({ id: assignment.crewId });
    const tasks = await manager
      .getRepository(Task)
      .find({ where: { assignmentId: assignment.id }, order: { priority: 'ASC', id: 'ASC' } });
    mapped.push({
      id: assignment.id,
      appointmentId: assignment.appointmentId,
      crewId: assignment.crewId,
      crewCode: crew.code,
      crewName: crew.name,
      crewActive: crew.active,
      status: assignment.status,
      execution: mapAssignmentExecution(assignment, appointment.plannedEndAt),
      travelBufferMinutes: assignment.travelBufferMinutes,
      cancelledAt: assignment.cancelledAt?.toISOString() ?? null,
      cancelledBy: assignment.cancelledBy,
      cancelReason: assignment.cancelReason,
      createdAt: assignment.createdAt.toISOString(),
      updatedAt: assignment.updatedAt.toISOString(),
      tasks: tasks.map(mapTask),
    });
    if (appointment.status === 'SCHEDULED' && assignment.status === 'ASSIGNED')
      attention.push(
        ...(await reservationAttention(
          manager,
          crew,
          appointment.plannedStartAt,
          appointment.plannedEndAt,
          assignment.travelBufferMinutes,
          appointment.id,
        )),
      );
  }
  const orderExecution = await readOrderExecutionState(manager, order.id);
  return {
    id: appointment.id,
    orderId: order.id,
    orderNumber: order.number,
    returnRequestId:
      (await manager.getRepository(ReturnVisitAttempt).findOneBy({ appointmentId: appointment.id }))
        ?.requestId ?? null,
    customerName: order.customerName,
    city: order.city,
    serviceType: order.serviceType,
    plannedStartAt: appointment.plannedStartAt.toISOString(),
    plannedEndAt: appointment.plannedEndAt.toISOString(),
    durationMinutes: appointment.durationMinutes,
    status: appointment.status,
    confirmationStatus: appointment.confirmationStatus,
    confirmedAt: appointment.confirmedAt?.toISOString() ?? null,
    confirmedBy: appointment.confirmedBy,
    cancelledAt: appointment.cancelledAt?.toISOString() ?? null,
    cancelledBy: appointment.cancelledBy,
    cancelReason: appointment.cancelReason,
    notes: appointment.notes,
    version: appointment.version,
    createdBy: appointment.createdBy,
    updatedBy: appointment.updatedBy,
    createdAt: appointment.createdAt.toISOString(),
    updatedAt: appointment.updatedAt.toISOString(),
    assignments: mapped,
    execution: {
      orderProgress: orderExecution.progress,
      workReadyForReview: orderExecution.workReadyForReview,
      openIssueCount: orderExecution.openIssueCount,
      returnVisitRequired: orderExecution.returnVisitRequired,
      activeCount: mapped.filter(
        (a) =>
          a.status === 'ASSIGNED' &&
          ['ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS'].includes(a.execution.status),
      ).length,
      completedCount: mapped.filter(
        (a) => a.status === 'ASSIGNED' && a.execution.status === 'COMPLETED',
      ).length,
      partiallyCompletedCount: mapped.filter(
        (a) => a.status === 'ASSIGNED' && a.execution.status === 'PARTIALLY_COMPLETED',
      ).length,
      blockedCount: mapped.filter(
        (a) => a.status === 'ASSIGNED' && a.execution.status === 'BLOCKED',
      ).length,
      notStartedCount: mapped.filter(
        (a) => a.status === 'ASSIGNED' && a.execution.status === 'NOT_STARTED',
      ).length,
      requiredDoneCount: mapped
        .filter((a) => a.status === 'ASSIGNED')
        .flatMap((a) => a.tasks)
        .filter((t) => t.active && t.required && t.resultStatus === 'DONE').length,
      requiredCount: mapped
        .filter((a) => a.status === 'ASSIGNED')
        .flatMap((a) => a.tasks)
        .filter((t) => t.active && t.required).length,
      maybeDelayed: mapped.some((a) => a.status === 'ASSIGNED' && a.execution.maybeDelayed),
    },
    needsAttention: attention.length > 0,
    attention,
  };
}
export async function readOrderAppointments(
  manager: EntityManager,
  orderId: string,
): Promise<AppointmentDetail[]> {
  const appointments = await manager
    .getRepository(Appointment)
    .find({ where: { orderId }, order: { plannedStartAt: 'ASC', id: 'ASC' } });
  const result: AppointmentDetail[] = [];
  for (const appointment of appointments)
    result.push(await readAppointment(manager, appointment.id));
  return result;
}
