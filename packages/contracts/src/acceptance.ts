import type { IssueStatus, IssueType, ProofType } from './evidence';
import type { CrewWorkItem, CrewWorkTask, ExecutionReceiptRecord } from './execution';
import type { ReturnRequestStatus, TerminalOutcome } from './execution-types';
import type { ServiceType } from './service-types';

export type AcceptanceSignerKind = 'CUSTOMER' | 'CREW';
export type SignatureAbsenceKind = 'REFUSED' | 'ABSENT' | 'UNABLE_TO_SIGN';
export type ExceptionDecision = 'APPROVED' | 'REJECTED';
export type AcceptanceSlotStatus =
  | 'MISSING'
  | 'SIGNED'
  | 'PENDING_REVIEW'
  | 'EXCEPTION_APPROVED'
  | 'EXCEPTION_REJECTED';

export interface AcceptanceItemDescription {
  id: string;
  description: string;
  quantity: number;
  configuration: string;
  ambient: string;
  requiresAssembly: boolean;
}

export interface AcceptanceTeamResult {
  assignmentId: string;
  crewId: string;
  crewName: string;
  finishReportId: string;
  reportCreatedAt: string;
  authorId: string;
  outcome: TerminalOutcome;
  summary: string;
  reason: string | null;
  remainingWork: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string;
  taskResults: CrewWorkTask[];
  /** Each report's accumulated order values; never add the teams' quantities. */
  quantities: CrewWorkItem[];
}

export interface AcceptanceIssueReference {
  id: string;
  type: IssueType;
  description: string;
  status: IssueStatus;
  itemIds: string[];
}

export interface AcceptanceReturnReference {
  id: string;
  status: ReturnRequestStatus;
  reason: string;
  remainingWork: string;
  appointmentId: string;
}

export interface AcceptanceEvidenceReference {
  id: string;
  appointmentId: string | null;
  assignmentId: string | null;
  itemId: string | null;
  kind: 'IMAGE' | 'PDF';
  contentType: 'image/webp' | 'application/pdf';
  proofType: ProofType | null;
  displayName: string;
  checksum: string | null;
}

/** Server-built historical document with the same safe content for every signer. */
export interface AcceptanceSnapshotPayload {
  schemaVersion: 1;
  createdAt: string;
  createdBy: string;
  order: {
    id: string;
    number: string;
    customerName: string;
    address: string;
    city: string;
    country: string;
    postalCode: string | null;
    serviceType: ServiceType;
    items: AcceptanceItemDescription[];
  };
  appointment: { id: string; plannedStartAt: string; plannedEndAt: string };
  teams: AcceptanceTeamResult[];
  issues: AcceptanceIssueReference[];
  returnRequests: AcceptanceReturnReference[];
  evidence: AcceptanceEvidenceReference[];
  confirmation: { version: string; text: string };
}

export interface AcceptanceSnapshotRecord {
  id: string;
  orderId: string;
  appointmentId: string;
  version: number;
  payload: AcceptanceSnapshotPayload;
  hash: string;
  createdBy: string;
  createdAt: string;
  invalidatedAt: string | null;
  invalidatedBy: string | null;
  invalidationReason: string | null;
}

/** Metadata only. PNG bytes are available solely through the authorized content handler. */
export interface SignatureConfirmationRecord {
  id: string;
  slotId: string;
  snapshotId: string;
  snapshotHash: string;
  method: 'SIGNED' | 'ABSENCE';
  signerName: string | null;
  signerRelation: string | null;
  capturedByUserId: string;
  recordedAt: string;
  imageDigest: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  absenceKind: SignatureAbsenceKind | null;
  absenceReason: string | null;
}

export interface ExceptionReviewRecord {
  id: string;
  slotId: string;
  confirmationId: string;
  decision: ExceptionDecision;
  reason: string;
  reviewedByUserId: string;
  reviewedAt: string;
}

export interface CrewAcceptanceSlotRecord {
  id: string;
  snapshotId: string;
  kind: AcceptanceSignerKind;
  assignmentId: string | null;
  status: AcceptanceSlotStatus;
  maySign: boolean;
  mayReportAbsence: boolean;
  canReadImage: boolean;
  /** Other teams' staff slots expose status only: both records must be null. */
  confirmation: SignatureConfirmationRecord | null;
  exception: ExceptionReviewRecord | null;
}

export interface AcceptanceSlotRecord extends CrewAcceptanceSlotRecord {
  mayReview: boolean;
}

export interface AcceptanceDocumentRecord {
  snapshot: AcceptanceSnapshotRecord;
  slots: AcceptanceSlotRecord[];
}

export interface CrewAcceptanceDocumentRecord {
  snapshot: AcceptanceSnapshotRecord;
  slots: CrewAcceptanceSlotRecord[];
}

export interface BackofficeVisitAcceptance {
  appointmentId: string;
  canPrepare: boolean;
  preparationBlockedReason: string | null;
  current: AcceptanceDocumentRecord | null;
  history: AcceptanceDocumentRecord[];
}

export interface CrewVisitAcceptance {
  appointmentId: string;
  ownAssignmentId: string;
  canPrepare: boolean;
  preparationBlockedReason: string | null;
  current: CrewAcceptanceDocumentRecord | null;
  history: CrewAcceptanceDocumentRecord[];
}

export interface BackofficeAcceptanceResponse {
  acceptance: BackofficeVisitAcceptance;
  receipt?: ExecutionReceiptRecord;
}

export interface CrewAcceptanceResponse {
  acceptance: CrewVisitAcceptance;
  receipt?: ExecutionReceiptRecord;
}

export interface PrepareAcceptanceCommand {
  operationKey: string;
}

/** PNG is a separate multipart file named signature; never put image data in JSON. */
export interface SignAcceptanceCommand {
  operationKey: string;
  expectedVersion: number;
  consent: true;
  customerName?: string;
  customerRelation?: string;
}

export interface ReportAbsenceCommand {
  operationKey: string;
  expectedVersion: number;
  kind: SignatureAbsenceKind;
  reason: string;
}

export interface ReviewExceptionCommand {
  operationKey: string;
  expectedVersion: number;
  decision: ExceptionDecision;
  reason: string;
}

export interface InvalidateAcceptanceCommand {
  operationKey: string;
  expectedVersion: number;
  reason: string;
}
