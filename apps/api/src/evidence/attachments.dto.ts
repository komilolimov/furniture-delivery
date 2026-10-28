import { BadRequestException } from '@nestjs/common';
import type {
  UploadAttachmentMetadata,
  WithdrawAttachmentRequest,
} from '@furniture-delivery/contracts';
import { objectPayload } from '../auth/validation';
const uuid = (value: unknown, field: string): string | undefined => {
  if (value === undefined || value === '') return undefined;
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    throw new BadRequestException(`Invalid ${field}.`);
  return value.toLowerCase();
};
const key = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(v))
    throw new BadRequestException('Invalid operationKey.');
  return v;
};
export class AttachmentsDto {
  static upload(value: unknown, crew: boolean): UploadAttachmentMetadata {
    const r = objectPayload(
      value,
      crew
        ? ['operationKey', 'itemId', 'issueId', 'proofType']
        : [
            'operationKey',
            'itemId',
            'issueId',
            'proofType',
            'visibility',
            'appointmentId',
            'assignmentId',
          ],
    );
    if (
      r.proofType !== undefined &&
      (typeof r.proofType !== 'string' ||
        !['DELIVERY', 'ASSEMBLY', 'DAMAGE', 'MISSING_PARTS', 'OTHER'].includes(r.proofType))
    )
      throw new BadRequestException('Invalid proofType.');
    if (crew && !r.proofType) throw new BadRequestException('Choose a proof type.');
    if (
      !crew &&
      r.visibility !== undefined &&
      r.visibility !== 'CREW_VISIBLE' &&
      r.visibility !== 'BACKOFFICE_ONLY'
    )
      throw new BadRequestException('Invalid visibility.');
    return {
      operationKey: key(r.operationKey),
      itemId: uuid(r.itemId, 'itemId'),
      issueId: uuid(r.issueId, 'issueId'),
      appointmentId: uuid(r.appointmentId, 'appointmentId'),
      assignmentId: uuid(r.assignmentId, 'assignmentId'),
      proofType: r.proofType as UploadAttachmentMetadata['proofType'],
      visibility: crew
        ? 'CREW_VISIBLE'
        : ((r.visibility as UploadAttachmentMetadata['visibility']) ?? 'BACKOFFICE_ONLY'),
    };
  }
  static withdraw(value: unknown): WithdrawAttachmentRequest {
    const r = objectPayload(value, ['operationKey', 'reason']);
    if (
      typeof r.reason !== 'string' ||
      r.reason.includes(String.fromCharCode(0)) ||
      !r.reason.trim() ||
      r.reason.trim().length > 4000
    )
      throw new BadRequestException('A withdrawal reason is required, up to 4000 characters.');
    return { operationKey: key(r.operationKey), reason: r.reason.trim() };
  }
}
