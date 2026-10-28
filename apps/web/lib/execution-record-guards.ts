import type {
  AssignmentExecution,
  AppointmentExecutionSummary,
  OrderProgress,
} from '@furniture-delivery/contracts';

export const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const string = (value: unknown): value is string => typeof value === 'string';
export const nullableString = (value: unknown) => value === null || string(value);
export const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const positiveVersion = (value: unknown) => count(value) && value > 0;
export const oneOf = (value: unknown, choices: readonly string[]) =>
  string(value) && choices.includes(value);
export const timestamp = (value: unknown) =>
  string(value) &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value));
export const nullableTimestamp = (value: unknown) => value === null || timestamp(value);
export const executionStatuses = [
  'NOT_STARTED',
  'ON_THE_WAY',
  'ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'BLOCKED',
] as const;
export const orderProgresses = [
  'INBOX',
  'PLANNED',
  'ASSIGNED',
  'IN_PROGRESS',
  'PARTIALLY_COMPLETED',
  'REQUIRES_ATTENTION',
  'AWAITING_REVIEW',
  'COMPLETED',
] as const;
export const isOrderProgress = (value: unknown): value is OrderProgress =>
  oneOf(value, orderProgresses);
export function isAssignmentExecution(value: unknown): value is AssignmentExecution {
  return (
    record(value) &&
    oneOf(value.status, executionStatuses) &&
    positiveVersion(value.version) &&
    positiveVersion(value.estimateVersion) &&
    nullableTimestamp(value.estimatedFinishAt) &&
    nullableTimestamp(value.estimateUpdatedAt) &&
    nullableString(value.estimateUpdatedBy) &&
    nullableString(value.estimateReason) &&
    ['departedAt', 'arrivedAt', 'actualStartAt', 'actualEndAt'].every((key) =>
      nullableTimestamp(value[key]),
    ) &&
    typeof value.maybeDelayed === 'boolean'
  );
}
export function isAppointmentExecution(value: unknown): value is AppointmentExecutionSummary {
  return (
    record(value) &&
    [
      'activeCount',
      'completedCount',
      'partiallyCompletedCount',
      'blockedCount',
      'notStartedCount',
      'requiredDoneCount',
      'requiredCount',
      'openIssueCount',
    ].every((key) => count(value[key])) &&
    ['maybeDelayed', 'workReadyForReview', 'returnVisitRequired'].every(
      (key) => typeof value[key] === 'boolean',
    ) &&
    isOrderProgress(value.orderProgress)
  );
}
