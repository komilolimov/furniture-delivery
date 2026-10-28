import type {
  CompletionHistoryResponse,
  CompletionOperationResponse,
  CompletionReadinessRecord,
  CompletionReadinessResponse,
  CompletionRecordRecord,
} from '@furniture-delivery/contracts';
import {
  nullableString,
  oneOf,
  positiveVersion,
  record,
  string,
  timestamp,
} from './execution-record-guards';
const ids = (value: unknown) => Array.isArray(value) && value.every(string);
const decision = (value: unknown) =>
  record(value) &&
  value.schemaVersion === 1 &&
  positiveVersion(value.orderVersion) &&
  ['snapshotIds', 'signatureIds', 'exceptionIds', 'coverageRequestIds'].every((key) =>
    ids(value[key]),
  ) &&
  record(value.operationalDetails);
export function isCompletionRecord(value: unknown): value is CompletionRecordRecord {
  return (
    record(value) &&
    ['id', 'orderId', 'actorId', 'reason'].every((key) => string(value[key])) &&
    timestamp(value.createdAt) &&
    decision(value.readiness)
  );
}
const blockerCodes = [
  'NO_VISITS',
  'NO_RECORDED_WORK',
  'ACTIVE_EXECUTION',
  'UNASSIGNED_VISIT',
  'UNSTARTED_VISIT',
  'UNCOVERED_EXECUTION',
  'INCOMPLETE_TASKS',
  'INCOMPLETE_ITEMS',
  'OPEN_ISSUES',
  'RETURN_REQUIRED',
  'MISSING_SNAPSHOT',
  'INVALIDATED_SNAPSHOT',
  'MISSING_CONFIRMATION',
  'PENDING_EXCEPTION',
  'REJECTED_EXCEPTION',
  'ALREADY_COMPLETED',
];
export function isCompletionReadiness(value: unknown): value is CompletionReadinessRecord {
  return (
    record(value) &&
    string(value.orderId) &&
    positiveVersion(value.orderVersion) &&
    ['canComplete', 'physicalReady', 'confirmationsReady'].every(
      (key) => typeof value[key] === 'boolean',
    ) &&
    (value.currentCompletion === null || isCompletionRecord(value.currentCompletion)) &&
    ['snapshotIds', 'signatureIds', 'exceptionIds', 'coverageRequestIds'].every((key) =>
      ids(value[key]),
    ) &&
    Array.isArray(value.blockers) &&
    value.blockers.every(
      (blocker) =>
        record(blocker) &&
        oneOf(blocker.code, blockerCodes) &&
        string(blocker.message) &&
        [
          'appointmentId',
          'assignmentId',
          'taskId',
          'itemId',
          'issueId',
          'requestId',
          'snapshotId',
          'slotId',
        ].every((key) => blocker[key] === undefined || string(blocker[key])),
    )
  );
}
export function isCompletionReadinessResponse(
  value: unknown,
): value is CompletionReadinessResponse {
  return record(value) && isCompletionReadiness(value.readiness);
}
export function isCompletionOperationResponse(
  value: unknown,
): value is CompletionOperationResponse {
  return (
    isCompletionReadinessResponse(value) &&
    record(value) &&
    (value.receipt === undefined ||
      (record(value.receipt) &&
        string(value.receipt.id) &&
        string(value.receipt.action) &&
        nullableString(value.receipt.resultId) &&
        timestamp(value.receipt.createdAt)))
  );
}
export function isCompletionHistoryResponse(value: unknown): value is CompletionHistoryResponse {
  return (
    record(value) &&
    nullableString(value.currentCompletionId) &&
    Array.isArray(value.completions) &&
    value.completions.every(isCompletionRecord) &&
    Array.isArray(value.reopenEvents) &&
    value.reopenEvents.every(
      (event) =>
        record(event) &&
        ['id', 'orderId', 'completionId', 'actorId', 'reason'].every((key) => string(event[key])) &&
        timestamp(event.createdAt) &&
        oneOf(event.source, ['MANUAL', 'ISSUE', 'SNAPSHOT']) &&
        nullableString(event.sourceId),
    )
  );
}
