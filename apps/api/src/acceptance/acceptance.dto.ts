import { BadRequestException } from '@nestjs/common';
import type {
  PrepareAcceptanceCommand,
  SignAcceptanceCommand,
  ReportAbsenceCommand,
  ReviewExceptionCommand,
  InvalidateAcceptanceCommand,
} from '@furniture-delivery/contracts';
import { objectPayload } from '../auth/validation';
import { planningInteger } from '../planning/planning.dto';
function text(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > max ||
    value.includes('\0')
  )
    throw new BadRequestException('A nonempty text value within the allowed length is required.');
  return value.trim();
}
function key(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value))
    throw new BadRequestException('Invalid operation key.');
  return value;
}
function base(input: Record<string, unknown>) {
  return {
    operationKey: key(input.operationKey),
    expectedVersion: planningInteger(input.expectedVersion, 'expectedVersion', 1, 2147483646),
  };
}
export class AcceptanceDto {
  static prepare(value: unknown): PrepareAcceptanceCommand {
    const input = objectPayload(value, ['operationKey']);
    return { operationKey: key(input.operationKey) };
  }
  static signature(value: unknown): SignAcceptanceCommand {
    const body = objectPayload(value, ['payload']);
    if (typeof body.payload !== 'string' || Buffer.byteLength(body.payload) > 8192)
      throw new BadRequestException('Signature metadata is required.');
    let decoded: unknown;
    try {
      decoded = JSON.parse(body.payload);
    } catch {
      throw new BadRequestException('Signature metadata must be valid JSON.');
    }
    return this.sign(decoded);
  }
  static sign(value: unknown): SignAcceptanceCommand {
    const input = objectPayload(value, [
      'operationKey',
      'expectedVersion',
      'consent',
      'customerName',
      'customerRelation',
    ]);
    if (input.consent !== true)
      throw new BadRequestException(
        'Explicit acknowledgement of the displayed result is required.',
      );
    return {
      ...base(input),
      consent: true,
      ...(input.customerName === undefined ? {} : { customerName: text(input.customerName, 200) }),
      ...(input.customerRelation === undefined
        ? {}
        : { customerRelation: text(input.customerRelation, 200) }),
    };
  }
  static absence(value: unknown): ReportAbsenceCommand {
    const input = objectPayload(value, ['operationKey', 'expectedVersion', 'kind', 'reason']);
    if (input.kind !== 'REFUSED' && input.kind !== 'ABSENT' && input.kind !== 'UNABLE_TO_SIGN')
      throw new BadRequestException('Choose a signature absence type.');
    return { ...base(input), kind: input.kind, reason: text(input.reason, 4000) };
  }
  static review(value: unknown): ReviewExceptionCommand {
    const input = objectPayload(value, ['operationKey', 'expectedVersion', 'decision', 'reason']);
    if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED')
      throw new BadRequestException('Choose an exception decision.');
    return { ...base(input), decision: input.decision, reason: text(input.reason, 4000) };
  }
  static invalidate(value: unknown): InvalidateAcceptanceCommand {
    const input = objectPayload(value, ['operationKey', 'expectedVersion', 'reason']);
    return { ...base(input), reason: text(input.reason, 4000) };
  }
}
