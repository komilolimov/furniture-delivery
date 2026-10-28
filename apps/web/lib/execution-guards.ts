import type {
  CrewAssignmentDetail,
  CrewAssignmentListResponse,
  CrewAssignmentResponse,
  CrewAssignmentSummary,
  CrewWorkItem,
  CrewWorkTask,
  FinishReportRecord,
  OrderExecutionResponse,
  OrderExecutionSummary,
  ReturnVisitRequestRecord,
} from '@furniture-delivery/contracts';
import { isAppointmentDetail } from './planning-guards';
import {
  count,
  isAssignmentExecution,
  nullableString,
  nullableTimestamp,
  oneOf,
  isOrderProgress,
  positiveVersion,
  record,
  string,
  timestamp,
} from './execution-record-guards';

const strings = (value: Record<string, unknown>, keys: string[]) =>
  keys.every((key) => string(value[key]));
const noPrivateFields = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.every(noPrivateFields);
  if (!record(value)) return true;
  const forbidden = [
    'orderTotalCents',
    'paidCents',
    'balanceCents',
    'paymentStatus',
    'payments',
    'internalNotes',
    'passwordHash',
    'token',
    'tokenHash',
    'storageKey',
    'sourceHash',
    'fingerprint',
    'operationKey',
  ];
  return Object.entries(value).every(
    ([key, child]) => !forbidden.includes(key) && noPrivateFields(child),
  );
};
export function isCrewWorkTask(value: unknown): value is CrewWorkTask {
  return (
    record(value) &&
    strings(value, ['id', 'name', 'description']) &&
    typeof value.required === 'boolean' &&
    oneOf(value.severity, ['LOW', 'MEDIUM', 'HIGH']) &&
    count(value.priority) &&
    oneOf(value.resultStatus, ['PENDING', 'DONE', 'SKIPPED']) &&
    positiveVersion(value.resultVersion) &&
    nullableString(value.doneBy) &&
    nullableTimestamp(value.doneAt) &&
    nullableString(value.resultReason)
  );
}
export function isCrewWorkItem(value: unknown): value is CrewWorkItem {
  return (
    record(value) &&
    strings(value, ['id', 'description', 'configuration', 'ambient', 'notes']) &&
    typeof value.requiresAssembly === 'boolean' &&
    [
      'quantity',
      'sortOrder',
      'deliveredQuantity',
      'assembledQuantity',
      'remainingDeliveryQuantity',
      'remainingAssemblyQuantity',
    ].every((key) => count(value[key])) &&
    positiveVersion(value.fulfillmentVersion) &&
    Number(value.assembledQuantity) <= Number(value.deliveredQuantity) &&
    Number(value.deliveredQuantity) <= Number(value.quantity)
  );
}
export function isFinishReport(value: unknown): value is FinishReportRecord {
  return (
    record(value) &&
    strings(value, ['id', 'orderId', 'appointmentId', 'assignmentId', 'summary', 'authorId']) &&
    oneOf(value.outcome, ['COMPLETED', 'PARTIALLY_COMPLETED', 'BLOCKED']) &&
    ['reason', 'remainingWork'].every((key) => nullableString(value[key])) &&
    value.quantityScope === 'ACCUMULATED_ORDER' &&
    timestamp(value.actualEndAt) &&
    timestamp(value.createdAt) &&
    Array.isArray(value.taskResults) &&
    value.taskResults.every(isCrewWorkTask) &&
    Array.isArray(value.quantities) &&
    value.quantities.every(isCrewWorkItem) &&
    ['knownIssueIds', 'attachmentIds'].every(
      (key) => Array.isArray(value[key]) && value[key].every(string),
    ) &&
    noPrivateFields(value)
  );
}
export function isReturnRequest(value: unknown): value is ReturnVisitRequestRecord {
  return (
    record(value) &&
    strings(value, [
      'id',
      'orderId',
      'appointmentId',
      'assignmentId',
      'finishReportId',
      'reason',
      'remainingWork',
      'authorId',
    ]) &&
    timestamp(value.createdAt) &&
    oneOf(value.status, ['OPEN', 'PLANNED', 'RESOLVED']) &&
    positiveVersion(value.version) &&
    timestamp(value.updatedAt) &&
    nullableString(value.updatedBy) &&
    nullableTimestamp(value.resolvedAt) &&
    nullableString(value.resolvedBy) &&
    nullableString(value.resolution)
  );
}
export function isCrewAssignmentSummary(value: unknown): value is CrewAssignmentSummary {
  return (
    record(value) &&
    strings(value, [
      'id',
      'appointmentId',
      'orderId',
      'orderNumber',
      'customerName',
      'city',
      'crewId',
      'crewName',
    ]) &&
    typeof value.crewActive === 'boolean' &&
    (value.orderProgress === undefined || isOrderProgress(value.orderProgress)) &&
    oneOf(value.serviceType, ['DELIVERY_ONLY', 'DELIVERY_AND_ASSEMBLY']) &&
    timestamp(value.plannedStartAt) &&
    timestamp(value.plannedEndAt) &&
    positiveVersion(value.appointmentVersion) &&
    oneOf(value.confirmationStatus, ['NEEDS_CONFIRMATION', 'CONFIRMED']) &&
    isAssignmentExecution(value.execution) &&
    noPrivateFields(value)
  );
}
function isCrewReturnContext(v: unknown): boolean {
  if (
    !record(v) ||
    !strings(v, ['requestId', 'sourceAppointmentId', 'reason', 'remainingWork']) ||
    !record(v.scope)
  )
    return false;
  return (
    Array.isArray(v.scope.tasks) &&
    v.scope.tasks.every(
      (t) =>
        record(t) &&
        strings(t, ['key', 'name', 'description', 'crewId']) &&
        nullableString(t.sourceTaskId) &&
        nullableString(t.sourceAssignmentId) &&
        nullableString(t.addedReason) &&
        typeof t.required === 'boolean' &&
        oneOf(t.severity, ['LOW', 'MEDIUM', 'HIGH']) &&
        count(t.priority),
    ) &&
    Array.isArray(v.scope.itemTargets) &&
    v.scope.itemTargets.every(
      (t) =>
        record(t) &&
        string(t.itemId) &&
        count(t.deliveredQuantity) &&
        count(t.assembledQuantity) &&
        t.assembledQuantity <= t.deliveredQuantity,
    ) &&
    Array.isArray(v.sourceTasks) &&
    v.sourceTasks.every(
      (t) =>
        record(t) &&
        strings(t, ['id', 'name']) &&
        oneOf(t.resultStatus, ['PENDING', 'DONE', 'SKIPPED']),
    ) &&
    noPrivateFields(v)
  );
}
export function isCrewAssignmentDetail(value: unknown): value is CrewAssignmentDetail {
  if (!isCrewAssignmentSummary(value)) return false;
  const v = value as unknown as Record<string, unknown>,
    order = v.order;
  return (
    record(order) &&
    strings(order, [
      'id',
      'number',
      'customerName',
      'address',
      'city',
      'country',
      'workDescription',
      'accessRestrictions',
      'accessNotes',
      'crewNotes',
    ]) &&
    ['contactName', 'email', 'postalCode', 'floor'].every((key) => nullableString(order[key])) &&
    ['hasElevator', 'easyAccess', 'parkingAvailable'].every(
      (key) => order[key] === null || typeof order[key] === 'boolean',
    ) &&
    count(order.estimatedDurationMinutes) &&
    oneOf(order.serviceType, ['DELIVERY_ONLY', 'DELIVERY_AND_ASSEMBLY']) &&
    Array.isArray(order.phoneNumbers) &&
    order.phoneNumbers.every(string) &&
    Array.isArray(v.items) &&
    v.items.every(isCrewWorkItem) &&
    Array.isArray(v.tasks) &&
    v.tasks.every(isCrewWorkTask) &&
    Array.isArray(v.allowedActions) &&
    v.allowedActions.every((action) => oneOf(action, ['DEPART', 'ARRIVE', 'START', 'FINISH'])) &&
    ['canEditResults', 'canAppendEvidence', 'returnVisitRequired'].every(
      (key) => typeof v[key] === 'boolean',
    ) &&
    nullableString(v.departureBlockedReason) &&
    string(v.businessDate) &&
    v.timeZone === 'Europe/Rome' &&
    (v.finishReport === null || isFinishReport(v.finishReport)) &&
    Array.isArray(v.returnRequests) &&
    v.returnRequests.every(isReturnRequest) &&
    count(v.openIssueCount) &&
    (v.returnContext === undefined ||
      v.returnContext === null ||
      isCrewReturnContext(v.returnContext)) &&
    noPrivateFields(v)
  );
}
export const isCrewAssignmentResponse = (value: unknown): value is CrewAssignmentResponse =>
  record(value) && isCrewAssignmentDetail(value.assignment) && noPrivateFields(value);
export const isCrewAssignmentListResponse = (value: unknown): value is CrewAssignmentListResponse =>
  record(value) &&
  Array.isArray(value.assignments) &&
  value.assignments.every(isCrewAssignmentSummary) &&
  ['total', 'page', 'pageSize'].every((key) => count(value[key])) &&
  string(value.businessDate) &&
  value.timeZone === 'Europe/Rome' &&
  noPrivateFields(value);
export function isOrderExecutionSummary(v: unknown): v is OrderExecutionSummary {
  if (!record(v)) return false;
  return (
    ['workReadyForReview', 'returnVisitRequired'].every((key) => typeof v[key] === 'boolean') &&
    [
      'openIssueCount',
      'activeAssignmentCount',
      'completedAssignmentCount',
      'partiallyCompletedAssignmentCount',
      'blockedAssignmentCount',
    ].every((key) => count(v[key])) &&
    Array.isArray(v.finishReports) &&
    v.finishReports.every(isFinishReport) &&
    Array.isArray(v.returnRequests) &&
    v.returnRequests.every(isReturnRequest)
  );
}
export function isOrderExecutionResponse(value: unknown): value is OrderExecutionResponse {
  return (
    record(value) &&
    isOrderExecutionSummary(value.execution) &&
    Array.isArray(value.appointments) &&
    value.appointments.every(isAppointmentDetail)
  );
}
