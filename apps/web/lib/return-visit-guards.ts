import type {
  ReturnAttemptRecord,
  ReturnAttemptScope,
  ReturnQueueResponse,
  ReturnRequestDetail,
  ReturnRequestResponse,
  ReturnScopeCandidate,
} from '@furniture-delivery/contracts';
import { isCrewWorkItem, isFinishReport, isReturnRequest } from './execution-guards';
import {
  count,
  nullableString,
  nullableTimestamp,
  oneOf,
  positiveVersion,
  record,
  string,
  timestamp,
} from './execution-record-guards';
import { isAppointmentDetail } from './planning-guards';

const strings = (value: Record<string, unknown>, keys: string[]) =>
  keys.every((key) => string(value[key]));

export function isReturnAttemptScope(value: unknown): value is ReturnAttemptScope {
  return (
    record(value) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(
      (task) =>
        record(task) &&
        strings(task, ['key', 'name', 'description', 'crewId']) &&
        ['sourceTaskId', 'sourceAssignmentId', 'addedReason'].every((key) =>
          nullableString(task[key]),
        ) &&
        typeof task.required === 'boolean' &&
        oneOf(task.severity, ['LOW', 'MEDIUM', 'HIGH']) &&
        count(task.priority),
    ) &&
    Array.isArray(value.itemTargets) &&
    value.itemTargets.every(
      (target) =>
        record(target) &&
        string(target.itemId) &&
        count(target.deliveredQuantity) &&
        count(target.assembledQuantity) &&
        target.assembledQuantity <= target.deliveredQuantity,
    )
  );
}

export function isReturnAttempt(value: unknown): value is ReturnAttemptRecord {
  return (
    record(value) &&
    strings(value, ['id', 'requestId', 'appointmentId', 'createdBy']) &&
    typeof value.current === 'boolean' &&
    typeof value.returnRequested === 'boolean' &&
    (value.closedOutcome === null ||
      oneOf(value.closedOutcome, ['CANCELLED', 'FAILED', 'RESOLVED'])) &&
    timestamp(value.createdAt) &&
    nullableTimestamp(value.closedAt) &&
    nullableString(value.closedBy) &&
    nullableString(value.closeReason) &&
    isReturnAttemptScope(value.scope)
  );
}

function isScopeCandidate(value: unknown): value is ReturnScopeCandidate {
  return (
    record(value) &&
    strings(value, [
      'sourceTaskId',
      'sourceAssignmentId',
      'sourceAppointmentId',
      'name',
      'description',
    ]) &&
    typeof value.required === 'boolean' &&
    oneOf(value.severity, ['LOW', 'MEDIUM', 'HIGH']) &&
    oneOf(value.resultStatus, ['PENDING', 'DONE', 'SKIPPED']) &&
    count(value.priority)
  );
}

export function isReturnRequestDetail(value: unknown): value is ReturnRequestDetail {
  return (
    record(value) &&
    isReturnRequest(value.request) &&
    positiveVersion(value.request.version) &&
    timestamp(value.request.updatedAt) &&
    nullableString(value.request.updatedBy) &&
    nullableTimestamp(value.request.resolvedAt) &&
    nullableString(value.request.resolvedBy) &&
    nullableString(value.request.resolution) &&
    isFinishReport(value.sourceReport) &&
    Array.isArray(value.scopeCandidates) &&
    value.scopeCandidates.every(isScopeCandidate) &&
    Array.isArray(value.items) &&
    value.items.every(isCrewWorkItem) &&
    Array.isArray(value.attempts) &&
    value.attempts.every(isReturnAttempt) &&
    (value.currentAppointment === null || isAppointmentDetail(value.currentAppointment)) &&
    typeof value.readyToResolve === 'boolean' &&
    Array.isArray(value.resolveBlockedReasons) &&
    value.resolveBlockedReasons.every(string)
  );
}

export function isReturnRequestResponse(value: unknown): value is ReturnRequestResponse {
  return (
    record(value) &&
    isReturnRequestDetail(value.request) &&
    (value.receipt === undefined ||
      (record(value.receipt) &&
        strings(value.receipt, ['id', 'action']) &&
        nullableString(value.receipt.resultId) &&
        timestamp(value.receipt.createdAt)))
  );
}

export function isReturnQueueResponse(value: unknown): value is ReturnQueueResponse {
  return (
    record(value) &&
    count(value.total) &&
    positiveVersion(value.page) &&
    positiveVersion(value.pageSize) &&
    Array.isArray(value.requests) &&
    value.requests.every(
      (entry) =>
        record(entry) &&
        isReturnRequest(entry.request) &&
        positiveVersion(entry.request.version) &&
        strings(entry, ['orderNumber', 'customerName']) &&
        nullableString(entry.currentAppointmentId) &&
        typeof entry.readyToResolve === 'boolean',
    )
  );
}
