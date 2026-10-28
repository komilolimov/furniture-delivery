import { BadRequestException } from '@nestjs/common';
import type {
  CreateExecutionNoteRequest,
  CreateIssueNoteRequest,
  CreateIssueRequest,
  EvidenceProvenance,
  EvidenceVisibility,
  IssueCommandRequest,
  IssueListQuery,
  IssueType,
} from '@furniture-delivery/contracts';
import { objectPayload, uuidValue } from '../auth/validation';
import { integer } from '../orders/orders.dto';
const types: IssueType[] = [
  'DAMAGE',
  'MISSING_PARTS',
  'WRONG_PRODUCT',
  'QUANTITY_MISMATCH',
  'ACCESS_PROBLEM',
  'CUSTOMER_UNAVAILABLE',
  'OTHER',
];
export function evidenceText(value: unknown, name: string, required = true): string {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    value.trim().length > 4000 ||
    (required && !value.trim())
  )
    throw new BadRequestException(`${name} must contain ${required ? '1' : '0'}–4000 characters.`);
  return value.trim();
}
export function evidenceOperationKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value))
    throw new BadRequestException(
      'operationKey must contain 8–100 letters, digits, underscores or hyphens.',
    );
  return value;
}
function identifier(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`Invalid ${name}.`);
  return uuidValue(value);
}
function ids(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100)
    throw new BadRequestException(`${name} must contain at most 100 identifiers.`);
  const result = value.map((v) => {
    const id = identifier(v, name);
    if (!id) throw new BadRequestException(`Invalid ${name}.`);
    return id;
  });
  if (new Set(result).size !== result.length)
    throw new BadRequestException(`${name} must be unique.`);
  return result.sort();
}
function provenance(record: Record<string, unknown>, crew: boolean): EvidenceProvenance {
  const value = record.visibility === undefined ? 'BACKOFFICE_ONLY' : record.visibility;
  if (!crew && value !== 'BACKOFFICE_ONLY' && value !== 'CREW_VISIBLE')
    throw new BadRequestException('Invalid visibility.');
  return {
    ...(crew
      ? {}
      : {
          appointmentId: identifier(record.appointmentId, 'appointmentId'),
          assignmentId: identifier(record.assignmentId, 'assignmentId'),
        }),
    itemId: identifier(record.itemId, 'itemId'),
    visibility: crew ? 'CREW_VISIBLE' : (value as EvidenceVisibility),
  };
}
const provenanceKeys = (crew: boolean) =>
  crew ? [] : ['appointmentId', 'assignmentId', 'visibility'];
export class EvidenceDto {
  static note(value: unknown, crew = false): CreateExecutionNoteRequest {
    const r = objectPayload(value, ['operationKey', 'text', 'itemId', ...provenanceKeys(crew)]);
    return {
      ...provenance(r, crew),
      operationKey: evidenceOperationKey(r.operationKey),
      text: evidenceText(r.text, 'text'),
    };
  }
  static issue(value: unknown, crew = false): CreateIssueRequest {
    const r = objectPayload(value, [
      'operationKey',
      'type',
      'description',
      'reportedSource',
      'itemIds',
      'attachmentIds',
      'notes',
      ...provenanceKeys(crew),
    ]);
    if (typeof r.type !== 'string' || !types.includes(r.type as IssueType))
      throw new BadRequestException('Invalid issue type.');
    if (r.reportedSource !== 'CREW' && r.reportedSource !== 'CUSTOMER')
      throw new BadRequestException('Invalid reportedSource.');
    return {
      ...provenance(r, crew),
      operationKey: evidenceOperationKey(r.operationKey),
      type: r.type as IssueType,
      description: evidenceText(r.description, 'description'),
      reportedSource: r.reportedSource,
      itemIds: ids(r.itemIds, 'itemIds'),
      attachmentIds: ids(r.attachmentIds, 'attachmentIds'),
      notes: r.notes === undefined ? undefined : evidenceText(r.notes, 'notes', false),
    };
  }
  static command(value: unknown): IssueCommandRequest {
    const r = objectPayload(value, ['operationKey', 'expectedVersion', 'reason']);
    return {
      operationKey: evidenceOperationKey(r.operationKey),
      expectedVersion: integer(r.expectedVersion, 'expectedVersion', 1, 2147483646),
      reason: evidenceText(r.reason, 'reason'),
    };
  }
  static issueNote(value: unknown): CreateIssueNoteRequest {
    const r = objectPayload(value, ['operationKey', 'text']);
    return {
      operationKey: evidenceOperationKey(r.operationKey),
      text: evidenceText(r.text, 'text'),
    };
  }
  static query(value: unknown): IssueListQuery {
    const r = objectPayload(value, ['status', 'type', 'page', 'pageSize']);
    if (r.status !== undefined && r.status !== 'OPEN' && r.status !== 'RESOLVED')
      throw new BadRequestException('Invalid issue status.');
    if (
      r.type !== undefined &&
      (typeof r.type !== 'string' || !types.includes(r.type as IssueType))
    )
      throw new BadRequestException('Invalid issue type.');
    const number = (name: string, fallback: number, max: number) =>
      r[name] === undefined
        ? fallback
        : typeof r[name] === 'string' && /^[1-9]\d*$/.test(r[name])
          ? integer(Number(r[name]), name, 1, max)
          : (() => {
              throw new BadRequestException(`Invalid ${name}.`);
            })();
    return {
      status: r.status as IssueListQuery['status'],
      type: r.type as IssueType | undefined,
      page: number('page', 1, 1000000),
      pageSize: number('pageSize', 20, 100),
    };
  }
}
