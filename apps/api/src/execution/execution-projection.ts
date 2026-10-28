import { readCrewReturnContext } from '../return-visits/return-projection';
import { readOrderExecutionState } from './execution-state';
import { DateTime } from 'luxon';
import type {
  CrewAssignmentDetail,
  CrewAssignmentSummary,
  CrewOrderContact,
  ExecutionAction,
} from '@furniture-delivery/contracts';
import type { EntityManager } from 'typeorm';
import { OrderItem } from '../orders/order-item.entity';
import { Task } from '../planning/task.entity';
import { CrewAssignment } from '../planning/crew-assignment.entity';
import { FinishReport } from './finish-report.entity';
import { ReturnVisitRequest } from './return-visit-request.entity';
import type { CrewExecutionContext } from './execution-access';
import {
  mapAssignmentExecution,
  mapCrewItem,
  mapCrewTask,
  mapFinishReport,
  mapReturnRequest,
} from './execution-mappers';
import { readExecutionEvidence } from './execution-evidence-port';
export function businessDate(now = new Date()): string {
  return DateTime.fromJSDate(now, { zone: 'Europe/Rome' }).toISODate()!;
}
export function crewSummary(c: CrewExecutionContext): CrewAssignmentSummary {
  const { assignment: a, appointment: v, order: o, crew } = c;
  return {
    id: a.id,
    appointmentId: v.id,
    orderId: o.id,
    orderNumber: o.number,
    customerName: o.customerName,
    city: o.city,
    serviceType: o.serviceType,
    crewId: crew.id,
    crewName: crew.name,
    crewActive: crew.active,
    plannedStartAt: v.plannedStartAt.toISOString(),
    plannedEndAt: v.plannedEndAt.toISOString(),
    appointmentVersion: v.version,
    confirmationStatus: v.confirmationStatus,
    execution: mapAssignmentExecution(a, v.plannedEndAt),
  };
}
export async function readCrewAssignment(
  manager: EntityManager,
  c: CrewExecutionContext,
): Promise<CrewAssignmentDetail> {
  const { order: o, appointment: v, assignment: a, crew } = c;
  // Explicit allowlist: this object never spreads Order, Appointment or an unrestricted activity row.
  const order: CrewOrderContact = {
    id: o.id,
    number: o.number,
    customerName: o.customerName,
    contactName: o.contactName,
    phoneNumbers: o.phoneNumbers,
    email: o.email,
    address: o.address,
    city: o.city,
    country: o.country,
    postalCode: o.postalCode,
    serviceType: o.serviceType,
    workDescription: o.workDescription,
    estimatedDurationMinutes: o.estimatedDurationMinutes,
    floor: o.floor,
    hasElevator: o.hasElevator,
    easyAccess: o.easyAccess,
    parkingAvailable: o.parkingAvailable,
    accessRestrictions: o.accessRestrictions,
    accessNotes: o.accessNotes,
    crewNotes: o.crewNotes,
  };
  const [tasks, items, report, returns, evidence, otherActive] = await Promise.all([
    manager
      .getRepository(Task)
      .find({ where: { assignmentId: a.id, active: true }, order: { priority: 'ASC', id: 'ASC' } }),
    manager
      .getRepository(OrderItem)
      .find({ where: { orderId: o.id, active: true }, order: { sortOrder: 'ASC', id: 'ASC' } }),
    manager.getRepository(FinishReport).findOneBy({ assignmentId: a.id }),
    manager
      .getRepository(ReturnVisitRequest)
      .find({ where: { orderId: o.id }, order: { createdAt: 'ASC', id: 'ASC' } }),
    readExecutionEvidence(manager, o.id, { crewVisible: true, assignmentId: a.id }),
    manager
      .getRepository(CrewAssignment)
      .createQueryBuilder('other')
      .where(
        "other.crewId = :crewId AND other.id <> :id AND other.status = 'ASSIGNED' AND other.executionStatus IN ('ON_THE_WAY','ARRIVED','IN_PROGRESS')",
        { crewId: crew.id, id: a.id },
      )
      .getExists(),
  ]);
  const today = businessDate();
  const allowedActions: ExecutionAction[] = [];
  const departureBlockedReason =
    a.executionStatus !== 'NOT_STARTED'
      ? null
      : !crew.active
        ? 'The team is inactive. Contact the dispatcher before a new departure.'
        : v.confirmationStatus !== 'CONFIRMED'
          ? 'Ask the dispatcher to confirm the client appointment before departure.'
          : businessDate(v.plannedStartAt) !== today
            ? 'Departure is available only on the planned date in Europe/Rome.'
            : otherActive
              ? 'Finish the team’s active visit before departing for another assignment.'
              : null;
  if (a.executionStatus === 'NOT_STARTED' && !departureBlockedReason) allowedActions.push('DEPART');
  if (a.executionStatus === 'ON_THE_WAY') allowedActions.push('ARRIVE', 'FINISH');
  if (a.executionStatus === 'ARRIVED') allowedActions.push('START', 'FINISH');
  if (a.executionStatus === 'IN_PROGRESS') allowedActions.push('FINISH');
  return {
    ...crewSummary(c),
    orderProgress: (await readOrderExecutionState(manager, o.id)).progress,
    order,
    tasks: tasks.map(mapCrewTask),
    items: items.map(mapCrewItem),
    allowedActions,
    departureBlockedReason,
    canEditResults: a.executionStatus === 'IN_PROGRESS',
    canAppendEvidence: a.executionStatus !== 'NOT_STARTED',
    businessDate: today,
    timeZone: 'Europe/Rome',
    finishReport: report ? mapFinishReport(report) : null,
    returnRequests: returns.map(mapReturnRequest),
    returnContext: await readCrewReturnContext(manager, a),
    openIssueCount: evidence.openIssueCount,
    returnVisitRequired: returns.some((r) => r.status !== 'RESOLVED'),
  };
}
