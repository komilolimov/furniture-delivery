import type {
  AssignmentExecution,
  CrewWorkItem,
  CrewWorkTask,
  FinishReportRecord,
  ReturnVisitRequestRecord,
} from '@furniture-delivery/contracts';
import type { CrewAssignment } from '../planning/crew-assignment.entity';
import type { Task } from '../planning/task.entity';
import type { OrderItem } from '../orders/order-item.entity';
import type { FinishReport } from './finish-report.entity';
import type { ReturnVisitRequest } from './return-visit-request.entity';
export const ACTIVE_EXECUTION = ['ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS'] as const;
export function mapAssignmentExecution(
  a: CrewAssignment,
  plannedEndAt: Date,
  now = new Date(),
): AssignmentExecution {
  return {
    status: a.executionStatus,
    version: a.executionVersion,
    estimatedFinishAt: a.estimatedFinishAt?.toISOString() ?? null,
    estimateUpdatedAt: a.estimateUpdatedAt?.toISOString() ?? null,
    estimateUpdatedBy: a.estimateUpdatedBy ?? null,
    estimateReason: a.estimateReason ?? null,
    estimateVersion: a.estimateVersion ?? 1,
    departedAt: a.departedAt?.toISOString() ?? null,
    arrivedAt: a.arrivedAt?.toISOString() ?? null,
    actualStartAt: a.actualStartAt?.toISOString() ?? null,
    actualEndAt: a.actualEndAt?.toISOString() ?? null,
    maybeDelayed: ACTIVE_EXECUTION.some((s) => s === a.executionStatus) && now > plannedEndAt,
  };
}
export function mapCrewTask(t: Task): CrewWorkTask {
  return {
    id: t.id,
    sourceTaskId: t.sourceTaskId ?? null,
    returnScopeKey: t.returnScopeKey ?? null,
    name: t.name,
    description: t.description,
    required: t.required,
    severity: t.severity,
    priority: t.priority,
    resultStatus: t.resultStatus,
    resultVersion: t.resultVersion,
    doneBy: t.doneBy,
    doneAt: t.doneAt?.toISOString() ?? null,
    resultReason: t.resultReason,
  };
}
export function mapCrewItem(i: OrderItem): CrewWorkItem {
  return {
    id: i.id,
    description: i.description,
    quantity: i.quantity,
    configuration: i.configuration,
    ambient: i.ambient,
    notes: i.notes,
    requiresAssembly: i.requiresAssembly,
    sortOrder: i.sortOrder,
    deliveredQuantity: i.deliveredQuantity,
    assembledQuantity: i.assembledQuantity,
    fulfillmentVersion: i.fulfillmentVersion,
    remainingDeliveryQuantity: i.quantity - i.deliveredQuantity,
    remainingAssemblyQuantity: i.requiresAssembly ? i.quantity - i.assembledQuantity : 0,
  };
}
export function mapFinishReport(r: FinishReport): FinishReportRecord {
  return {
    id: r.id,
    orderId: r.orderId,
    appointmentId: r.appointmentId,
    assignmentId: r.assignmentId,
    outcome: r.outcome,
    summary: r.summary,
    reason: r.reason,
    remainingWork: r.remainingWork,
    quantityScope: r.quantityScope,
    taskResults: r.taskResults,
    quantities: r.quantities,
    knownIssueIds: r.knownIssueIds,
    attachmentIds: r.attachmentIds,
    authorId: r.authorId,
    actualEndAt: r.actualEndAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}
export function mapReturnRequest(r: ReturnVisitRequest): ReturnVisitRequestRecord {
  return {
    id: r.id,
    orderId: r.orderId,
    appointmentId: r.appointmentId,
    assignmentId: r.assignmentId,
    finishReportId: r.finishReportId,
    status: r.status,
    version: r.version ?? 1,
    reason: r.reason,
    remainingWork: r.remainingWork,
    authorId: r.authorId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: (r.updatedAt ?? r.createdAt).toISOString(),
    updatedBy: r.updatedBy ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    resolvedBy: r.resolvedBy ?? null,
    resolution: r.resolution ?? null,
  };
}
