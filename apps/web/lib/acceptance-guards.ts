import type {
  AcceptanceSnapshotRecord,
  BackofficeAcceptanceResponse,
  CrewAcceptanceResponse,
  SignatureConfirmationRecord,
} from '@furniture-delivery/contracts';
import { isCrewWorkItem, isCrewWorkTask } from './execution-guards';
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

const strings = (value: Record<string, unknown>, keys: string[]) =>
  keys.every((key) => string(value[key]));
const stringsArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(string);
const digest = (value: unknown) => string(value) && /^[a-f0-9]{64}$/.test(value);
const noPrivate = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.every(noPrivate);
  if (!record(value)) return true;
  const forbidden = [
    'png',
    'base64',
    'canonical',
    'storageKey',
    'sourceHash',
    'passwordHash',
    'token',
    'tokenHash',
    'fingerprint',
    'operationKey',
    'internalNotes',
    'orderTotalCents',
    'paidCents',
    'balanceCents',
    'paymentStatus',
    'payments',
  ];
  return Object.entries(value).every(
    ([key, nested]) => !forbidden.includes(key) && noPrivate(nested),
  );
};
function isSnapshot(value: unknown): value is AcceptanceSnapshotRecord {
  if (
    !record(value) ||
    !strings(value, ['id', 'orderId', 'appointmentId', 'createdBy']) ||
    !positiveVersion(value.version) ||
    !timestamp(value.createdAt) ||
    !digest(value.hash) ||
    !nullableTimestamp(value.invalidatedAt) ||
    !nullableString(value.invalidatedBy) ||
    !nullableString(value.invalidationReason) ||
    !record(value.payload)
  )
    return false;
  const p = value.payload;
  return (
    p.schemaVersion === 1 &&
    timestamp(p.createdAt) &&
    string(p.createdBy) &&
    record(p.order) &&
    strings(p.order, ['id', 'number', 'customerName', 'address', 'city', 'country']) &&
    nullableString(p.order.postalCode) &&
    oneOf(p.order.serviceType, ['DELIVERY_ONLY', 'DELIVERY_AND_ASSEMBLY']) &&
    Array.isArray(p.order.items) &&
    p.order.items.every(
      (item) =>
        record(item) &&
        strings(item, ['id', 'description', 'configuration', 'ambient']) &&
        count(item.quantity) &&
        typeof item.requiresAssembly === 'boolean',
    ) &&
    record(p.appointment) &&
    string(p.appointment.id) &&
    timestamp(p.appointment.plannedStartAt) &&
    timestamp(p.appointment.plannedEndAt) &&
    Array.isArray(p.teams) &&
    p.teams.every(
      (team) =>
        record(team) &&
        strings(team, [
          'assignmentId',
          'crewId',
          'crewName',
          'finishReportId',
          'authorId',
          'summary',
        ]) &&
        timestamp(team.reportCreatedAt) &&
        timestamp(team.actualEndAt) &&
        ['departedAt', 'arrivedAt', 'actualStartAt'].every((key) => nullableTimestamp(team[key])) &&
        oneOf(team.outcome, ['COMPLETED', 'PARTIALLY_COMPLETED', 'BLOCKED']) &&
        nullableString(team.reason) &&
        nullableString(team.remainingWork) &&
        Array.isArray(team.taskResults) &&
        team.taskResults.every(isCrewWorkTask) &&
        Array.isArray(team.quantities) &&
        team.quantities.every(isCrewWorkItem),
    ) &&
    Array.isArray(p.issues) &&
    p.issues.every(
      (issue) =>
        record(issue) &&
        strings(issue, ['id', 'type', 'description']) &&
        oneOf(issue.status, ['OPEN', 'RESOLVED']) &&
        stringsArray(issue.itemIds),
    ) &&
    Array.isArray(p.returnRequests) &&
    p.returnRequests.every(
      (request) =>
        record(request) &&
        strings(request, ['id', 'reason', 'remainingWork', 'appointmentId']) &&
        oneOf(request.status, ['OPEN', 'PLANNED', 'RESOLVED']),
    ) &&
    Array.isArray(p.evidence) &&
    p.evidence.every(
      (evidence) =>
        record(evidence) &&
        strings(evidence, ['id', 'displayName']) &&
        ['appointmentId', 'assignmentId', 'itemId', 'proofType', 'checksum'].every((key) =>
          nullableString(evidence[key]),
        ) &&
        oneOf(evidence.kind, ['IMAGE', 'PDF']) &&
        oneOf(evidence.contentType, ['image/webp', 'application/pdf']),
    ) &&
    record(p.confirmation) &&
    strings(p.confirmation, ['version', 'text']) &&
    noPrivate(value)
  );
}
function isConfirmation(value: unknown): value is SignatureConfirmationRecord {
  return (
    record(value) &&
    strings(value, ['id', 'slotId', 'snapshotId', 'capturedByUserId']) &&
    digest(value.snapshotHash) &&
    oneOf(value.method, ['SIGNED', 'ABSENCE']) &&
    ['signerName', 'signerRelation', 'absenceKind', 'absenceReason'].every((key) =>
      nullableString(value[key]),
    ) &&
    timestamp(value.recordedAt) &&
    (value.imageDigest === null || digest(value.imageDigest)) &&
    ['width', 'height', 'sizeBytes'].every((key) => value[key] === null || count(value[key])) &&
    noPrivate(value)
  );
}
function isSlot(value: unknown, crew: boolean, ownAssignmentId?: string): boolean {
  if (
    !record(value) ||
    !strings(value, ['id', 'snapshotId']) ||
    !oneOf(value.kind, ['CUSTOMER', 'CREW']) ||
    !nullableString(value.assignmentId) ||
    !oneOf(value.status, [
      'MISSING',
      'SIGNED',
      'PENDING_REVIEW',
      'EXCEPTION_APPROVED',
      'EXCEPTION_REJECTED',
    ]) ||
    !['maySign', 'mayReportAbsence', 'canReadImage'].every(
      (key) => typeof value[key] === 'boolean',
    ) ||
    (value.confirmation !== null && !isConfirmation(value.confirmation))
  )
    return false;
  if (
    value.exception !== null &&
    !(
      record(value.exception) &&
      strings(value.exception, ['id', 'slotId', 'confirmationId', 'reason', 'reviewedByUserId']) &&
      oneOf(value.exception.decision, ['APPROVED', 'REJECTED']) &&
      timestamp(value.exception.reviewedAt)
    )
  )
    return false;
  if (!crew) return typeof value.mayReview === 'boolean';
  if ('mayReview' in value) return false;
  return (
    value.kind !== 'CREW' ||
    value.assignmentId === ownAssignmentId ||
    (value.confirmation === null &&
      value.exception === null &&
      value.maySign === false &&
      value.mayReportAbsence === false &&
      value.canReadImage === false)
  );
}
function visit(value: unknown, crew: boolean): boolean {
  if (
    !record(value) ||
    !string(value.appointmentId) ||
    typeof value.canPrepare !== 'boolean' ||
    !nullableString(value.preparationBlockedReason) ||
    !Array.isArray(value.history) ||
    (crew && !string(value.ownAssignmentId))
  )
    return false;
  const document = (d: unknown) =>
    record(d) &&
    isSnapshot(d.snapshot) &&
    Array.isArray(d.slots) &&
    d.slots.every((slot) => isSlot(slot, crew, crew ? String(value.ownAssignmentId) : undefined));
  return (
    (value.current === null || document(value.current)) &&
    value.history.every(document) &&
    noPrivate(value)
  );
}
export function isBackofficeAcceptanceResponse(
  value: unknown,
): value is BackofficeAcceptanceResponse {
  return record(value) && visit(value.acceptance, false) && noPrivate(value);
}
export function isCrewAcceptanceResponse(value: unknown): value is CrewAcceptanceResponse {
  return record(value) && visit(value.acceptance, true) && noPrivate(value);
}
export function isAcceptanceResponse(
  value: unknown,
): value is BackofficeAcceptanceResponse | CrewAcceptanceResponse {
  return isBackofficeAcceptanceResponse(value) || isCrewAcceptanceResponse(value);
}
