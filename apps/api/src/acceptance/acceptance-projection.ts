import type {
  AcceptanceDocumentRecord,
  AcceptanceSlotRecord,
  AcceptanceSnapshotRecord,
  BackofficeAcceptanceResponse,
  CrewAcceptanceDocumentRecord,
  CrewAcceptanceResponse,
  CrewAcceptanceSlotRecord,
  ExceptionReviewRecord,
  SignatureConfirmationRecord,
} from '@furniture-delivery/contracts';
import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';
import { FinishReport } from '../execution/finish-report.entity';
import { AcceptanceSnapshot } from './acceptance-snapshot.entity';
import { AcceptanceSlot } from './acceptance-slot.entity';
import { SignatureConfirmation } from './signature-confirmation.entity';
import { ExceptionReview } from './exception-review.entity';
import { slotAllowed, type AcceptanceContext } from './acceptance-access';

export const terminalAcceptance = new Set(['COMPLETED', 'PARTIALLY_COMPLETED', 'BLOCKED']);
export async function preparationBlocker(
  manager: EntityManager,
  context: AcceptanceContext,
): Promise<string | null> {
  if (
    context.appointment.status !== 'SCHEDULED' ||
    !context.assignments.some((assignment) => assignment.departedAt)
  )
    return 'At least one actual departure is required for a visit acknowledgement.';
  if (context.assignments.some((assignment) => !terminalAcceptance.has(assignment.executionStatus)))
    return 'All participating teams must finish before preparing the common visit result.';
  const participating = context.assignments.filter((assignment) => assignment.departedAt);
  const reports = await manager.getRepository(FinishReport).countBy({
    appointmentId: context.appointment.id,
    assignmentId: In(participating.map((assignment) => assignment.id)),
  });
  if (reports !== participating.length)
    return 'Every actual participation needs its immutable finish report.';
  return null;
}
function mapSnapshot(snapshot: AcceptanceSnapshot): AcceptanceSnapshotRecord {
  return {
    id: snapshot.id,
    orderId: snapshot.orderId,
    appointmentId: snapshot.appointmentId,
    version: snapshot.version,
    payload: snapshot.payload,
    hash: snapshot.hash,
    createdBy: snapshot.createdBy,
    createdAt: snapshot.createdAt.toISOString(),
    invalidatedAt: snapshot.invalidatedAt?.toISOString() ?? null,
    invalidatedBy: snapshot.invalidatedBy,
    invalidationReason: snapshot.invalidationReason,
  };
}
function mapConfirmation(row: SignatureConfirmation): SignatureConfirmationRecord {
  return {
    id: row.id,
    slotId: row.slotId,
    snapshotId: row.snapshotId,
    snapshotHash: row.snapshotHash,
    method: row.method,
    signerName: row.signerName,
    signerRelation: row.signerRelation,
    capturedByUserId: row.capturedByUserId,
    recordedAt: row.recordedAt.toISOString(),
    imageDigest: row.imageDigest,
    width: row.width,
    height: row.height,
    sizeBytes: row.sizeBytes,
    absenceKind: row.absenceKind,
    absenceReason: row.absenceReason,
  };
}
function mapReview(row: ExceptionReview): ExceptionReviewRecord {
  return {
    id: row.id,
    slotId: row.slotId,
    confirmationId: row.confirmationId,
    decision: row.decision,
    reason: row.reason,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt.toISOString(),
  };
}
export async function readAcceptance(
  manager: EntityManager,
  context: AcceptanceContext,
): Promise<BackofficeAcceptanceResponse | CrewAcceptanceResponse> {
  const snapshots = await manager
    .getRepository(AcceptanceSnapshot)
    .find({ where: { appointmentId: context.appointment.id }, order: { version: 'ASC' } });
  const history: (AcceptanceDocumentRecord | CrewAcceptanceDocumentRecord)[] = [];
  for (const snapshot of snapshots) {
    const rows = await manager.getRepository(AcceptanceSlot).find({
      where: { snapshotId: snapshot.id },
      order: { kind: 'ASC', assignmentId: 'ASC', id: 'ASC' },
    });
    const slots: (AcceptanceSlotRecord | CrewAcceptanceSlotRecord)[] = [];
    for (const slot of rows) {
      const confirmation = await manager
        .getRepository(SignatureConfirmation)
        .findOneBy({ slotId: slot.id });
      const exception = await manager.getRepository(ExceptionReview).findOneBy({ slotId: slot.id });
      const allowed = slotAllowed(context, slot.kind, slot.assignmentId);
      const visible = !context.crew || allowed;
      const valid = !snapshot.invalidatedAt;
      const status =
        confirmation?.method === 'SIGNED'
          ? 'SIGNED'
          : confirmation?.method === 'ABSENCE'
            ? exception
              ? exception.decision === 'APPROVED'
                ? 'EXCEPTION_APPROVED'
                : 'EXCEPTION_REJECTED'
              : 'PENDING_REVIEW'
            : 'MISSING';
      slots.push({
        id: slot.id,
        snapshotId: snapshot.id,
        kind: slot.kind,
        assignmentId: slot.assignmentId,
        status,
        maySign: valid && !confirmation && allowed,
        mayReportAbsence: valid && !confirmation && (allowed || !context.crew),
        canReadImage: confirmation?.method === 'SIGNED' && visible,
        confirmation: confirmation && visible ? mapConfirmation(confirmation) : null,
        exception: exception && visible ? mapReview(exception) : null,
        ...(!context.crew
          ? { mayReview: valid && confirmation?.method === 'ABSENCE' && !exception }
          : {}),
      });
    }
    history.push({ snapshot: mapSnapshot(snapshot), slots } as
      | AcceptanceDocumentRecord
      | CrewAcceptanceDocumentRecord);
  }
  const current = history.find((document) => !document.snapshot.invalidatedAt) ?? null;
  const blocked = await preparationBlocker(manager, context);
  const common = {
    appointmentId: context.appointment.id,
    canPrepare: !blocked && !current,
    preparationBlockedReason: blocked,
    current,
    history,
  };
  return context.crew
    ? ({
        acceptance: { ...common, ownAssignmentId: context.ownAssignmentId! },
      } as CrewAcceptanceResponse)
    : ({ acceptance: common } as BackofficeAcceptanceResponse);
}
