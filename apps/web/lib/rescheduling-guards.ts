import type {
  ApplyRescheduleResponse,
  EstimateResponse,
  RiskBoardResponse,
  SlotSearchResponse,
} from '@furniture-delivery/contracts';
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
import { isAppointmentResponse } from './order-guards';
const receipt = (value: unknown) =>
  record(value) &&
  string(value.id) &&
  string(value.action) &&
  nullableString(value.resultId) &&
  timestamp(value.createdAt);
export function isEstimateResponse(value: unknown): value is EstimateResponse {
  return (
    record(value) &&
    string(value.assignmentId) &&
    nullableTimestamp(value.estimatedFinishAt) &&
    nullableTimestamp(value.estimateUpdatedAt) &&
    nullableString(value.estimateUpdatedBy) &&
    nullableString(value.estimateReason) &&
    positiveVersion(value.estimateVersion) &&
    (value.receipt === undefined || receipt(value.receipt))
  );
}
export function isApplyRescheduleResponse(value: unknown): value is ApplyRescheduleResponse {
  return isAppointmentResponse(value) && record(value) && receipt(value.receipt);
}
export function isRiskBoardResponse(value: unknown): value is RiskBoardResponse {
  return (
    record(value) &&
    value.timeZone === 'Europe/Rome' &&
    timestamp(value.dataAsOf) &&
    string(value.from) &&
    string(value.to) &&
    Array.isArray(value.risks) &&
    value.risks.every(
      (visit) =>
        record(visit) &&
        ['appointmentId', 'orderId', 'orderNumber'].every((key) => string(visit[key])) &&
        timestamp(visit.plannedStartAt) &&
        timestamp(visit.plannedEndAt) &&
        Array.isArray(visit.reasons) &&
        visit.reasons.every(
          (reason) =>
            record(reason) &&
            oneOf(reason.code, [
              'NOT_DEPARTED',
              'OVERRUN',
              'ESTIMATE_STALE',
              'NEXT_VISIT_AT_RISK',
              'UNKNOWN_RELEASE',
            ]) &&
            ['crewId', 'crewName', 'sourceAssignmentId', 'sourceAppointmentId', 'message'].every(
              (key) => string(reason[key]),
            ) &&
            timestamp(reason.sourcePlannedStartAt) &&
            timestamp(reason.sourcePlannedEndAt) &&
            nullableTimestamp(reason.sourceEstimatedFinishAt) &&
            nullableTimestamp(reason.sourceActualEndAt) &&
            nullableTimestamp(reason.expectedReleaseAt) &&
            count(reason.travelBufferMinutes) &&
            oneOf(reason.basis, ['PLAN', 'ESTIMATE', 'ACTUAL', 'UNKNOWN']),
        ),
    )
  );
}
export function isSlotSearchResponse(value: unknown): value is SlotSearchResponse {
  return (
    record(value) &&
    value.timeZone === 'Europe/Rome' &&
    timestamp(value.dataAsOf) &&
    timestamp(value.earliestAt) &&
    string(value.from) &&
    string(value.to) &&
    typeof value.limited === 'boolean' &&
    nullableString(value.message) &&
    Array.isArray(value.blockedCrews) &&
    value.blockedCrews.every(
      (row) => record(row) && ['crewId', 'crewName', 'message'].every((key) => string(row[key])),
    ) &&
    Array.isArray(value.candidates) &&
    value.candidates.length <= 20 &&
    value.candidates.every(
      (row) =>
        record(row) &&
        string(row.localStart) &&
        timestamp(row.plannedStartAt) &&
        timestamp(row.plannedEndAt) &&
        positiveVersion(row.durationMinutes) &&
        oneOf(row.basis, ['PLAN', 'ESTIMATE', 'ACTUAL']) &&
        Array.isArray(row.crewIds) &&
        row.crewIds.every(string) &&
        Array.isArray(row.notes) &&
        row.notes.every(string) &&
        Array.isArray(row.crews) &&
        row.crews.length === row.crewIds.length &&
        row.crews.every(
          (crew) =>
            record(crew) &&
            ['id', 'code', 'name', 'serviceArea'].every((key) => string(crew[key])) &&
            typeof crew.active === 'boolean' &&
            oneOf(crew.workEnvironment, ['INDOOR', 'OUTDOOR']) &&
            count(crew.travelBufferMinutes),
        ),
    )
  );
}
