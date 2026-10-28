import type {
  AttachmentRecord,
  AttachmentResponse,
  EvidenceResponse,
  ExecutionNoteRecord,
  ExecutionNoteResponse,
  IssueListResponse,
  IssueRecord,
  IssueResponse,
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

const strings = (value: Record<string, unknown>, keys: string[]) =>
  keys.every((key) => string(value[key]));
const visibility = (value: unknown) => oneOf(value, ['BACKOFFICE_ONLY', 'CREW_VISIBLE']);
const provenance = (value: Record<string, unknown>) =>
  ['appointmentId', 'assignmentId'].every((key) => nullableString(value[key]));
const protectedUrl = (value: unknown, kind: 'content' | 'thumbnail') =>
  string(value) &&
  new RegExp(
    `^/api/(?:orders/[A-Za-z0-9_-]+|crew/assignments/[A-Za-z0-9_-]+)/attachments/[A-Za-z0-9_-]+/${kind}$`,
  ).test(value);
export function isExecutionNote(value: unknown): value is ExecutionNoteRecord {
  return (
    record(value) &&
    strings(value, ['id', 'orderId', 'text', 'authorId']) &&
    provenance(value) &&
    nullableString(value.itemId) &&
    visibility(value.visibility) &&
    timestamp(value.createdAt)
  );
}
export function isAttachment(value: unknown): value is AttachmentRecord {
  return (
    record(value) &&
    strings(value, ['id', 'orderId', 'displayName', 'authorId']) &&
    provenance(value) &&
    nullableString(value.itemId) &&
    visibility(value.visibility) &&
    (value.proofType === null ||
      oneOf(value.proofType, ['DELIVERY', 'ASSEMBLY', 'DAMAGE', 'MISSING_PARTS', 'OTHER'])) &&
    oneOf(value.kind, ['IMAGE', 'PDF']) &&
    oneOf(value.contentType, ['image/webp', 'application/pdf']) &&
    count(value.sizeBytes) &&
    (value.width === null || count(value.width)) &&
    (value.height === null || count(value.height)) &&
    timestamp(value.createdAt) &&
    nullableTimestamp(value.withdrawnAt) &&
    nullableString(value.withdrawReason) &&
    protectedUrl(value.contentUrl, 'content') &&
    (value.thumbnailUrl === null || protectedUrl(value.thumbnailUrl, 'thumbnail')) &&
    !['storageKey', 'sourceHash', 'fingerprint'].some((key) => key in value)
  );
}
export function isIssue(value: unknown): value is IssueRecord {
  return (
    record(value) &&
    strings(value, ['id', 'orderId', 'description', 'authorId']) &&
    provenance(value) &&
    visibility(value.visibility) &&
    oneOf(value.type, [
      'DAMAGE',
      'MISSING_PARTS',
      'WRONG_PRODUCT',
      'QUANTITY_MISMATCH',
      'ACCESS_PROBLEM',
      'CUSTOMER_UNAVAILABLE',
      'OTHER',
    ]) &&
    oneOf(value.reportedSource, ['CREW', 'CUSTOMER']) &&
    oneOf(value.status, ['OPEN', 'RESOLVED']) &&
    positiveVersion(value.version) &&
    ['itemIds', 'attachmentIds'].every(
      (key) => Array.isArray(value[key]) && value[key].every(string),
    ) &&
    timestamp(value.createdAt) &&
    timestamp(value.updatedAt) &&
    nullableTimestamp(value.resolvedAt) &&
    ['resolvedBy', 'resolution'].every((key) => nullableString(value[key])) &&
    Array.isArray(value.events) &&
    value.events.every(
      (event) =>
        record(event) &&
        strings(event, ['id', 'issueId', 'text', 'actorId']) &&
        oneOf(event.kind, ['CREATED', 'NOTE', 'RESOLVED', 'REOPENED']) &&
        timestamp(event.createdAt),
    )
  );
}
export function isEvidenceResponse(value: unknown): value is EvidenceResponse {
  if (!record(value) || !record(value.limits)) return false;
  const limits = value.limits;
  return (
    Array.isArray(value.notes) &&
    value.notes.every(isExecutionNote) &&
    Array.isArray(value.issues) &&
    value.issues.every(isIssue) &&
    Array.isArray(value.attachments) &&
    value.attachments.every(isAttachment) &&
    ['imageMaxBytes', 'pdfMaxBytes', 'maxPixels', 'orderMaxFiles', 'orderMaxBytes'].every((key) =>
      positiveVersion(limits[key]),
    )
  );
}
export const isExecutionNoteResponse = (value: unknown): value is ExecutionNoteResponse =>
  record(value) && isExecutionNote(value.note);
export const isIssueResponse = (value: unknown): value is IssueResponse =>
  record(value) && isIssue(value.issue);
export const isAttachmentResponse = (value: unknown): value is AttachmentResponse =>
  record(value) && isAttachment(value.attachment);
export const isIssueListResponse = (value: unknown): value is IssueListResponse =>
  record(value) &&
  Array.isArray(value.issues) &&
  value.issues.every(isIssue) &&
  count(value.total) &&
  positiveVersion(value.page) &&
  positiveVersion(value.pageSize);
