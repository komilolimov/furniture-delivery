export type EvidenceVisibility = 'BACKOFFICE_ONLY' | 'CREW_VISIBLE';
export type ProofType = 'DELIVERY' | 'ASSEMBLY' | 'DAMAGE' | 'MISSING_PARTS' | 'OTHER';
export type IssueType =
  | 'DAMAGE'
  | 'MISSING_PARTS'
  | 'WRONG_PRODUCT'
  | 'QUANTITY_MISMATCH'
  | 'ACCESS_PROBLEM'
  | 'CUSTOMER_UNAVAILABLE'
  | 'OTHER';
export type IssueStatus = 'OPEN' | 'RESOLVED';
export type ReportedSource = 'CREW' | 'CUSTOMER';
export interface EvidenceReceiptRecord {
  id: string;
  action: string;
  resultId: string | null;
  createdAt: string;
}
export interface ExecutionNoteRecord {
  id: string;
  orderId: string;
  appointmentId: string | null;
  assignmentId: string | null;
  itemId: string | null;
  visibility: EvidenceVisibility;
  text: string;
  authorId: string;
  createdAt: string;
}
export interface IssueEventRecord {
  id: string;
  issueId: string;
  kind: 'CREATED' | 'NOTE' | 'RESOLVED' | 'REOPENED';
  text: string;
  actorId: string;
  createdAt: string;
}
export interface AttachmentRecord {
  id: string;
  orderId: string;
  appointmentId: string | null;
  assignmentId: string | null;
  itemId: string | null;
  visibility: EvidenceVisibility;
  proofType: ProofType | null;
  kind: 'IMAGE' | 'PDF';
  displayName: string;
  contentType: 'image/webp' | 'application/pdf';
  sizeBytes: number;
  width: number | null;
  height: number | null;
  authorId: string;
  createdAt: string;
  withdrawnAt: string | null;
  withdrawReason: string | null;
  contentUrl: string;
  thumbnailUrl: string | null;
}
export interface IssueRecord {
  id: string;
  orderCompleted?: boolean;
  orderId: string;
  appointmentId: string | null;
  assignmentId: string | null;
  visibility: EvidenceVisibility;
  type: IssueType;
  description: string;
  reportedSource: ReportedSource;
  status: IssueStatus;
  version: number;
  itemIds: string[];
  attachmentIds: string[];
  authorId: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  events: IssueEventRecord[];
}
export interface EvidenceLimits {
  imageMaxBytes: number;
  pdfMaxBytes: number;
  maxPixels: number;
  orderMaxFiles: number;
  orderMaxBytes: number;
}
export interface EvidenceResponse {
  notes: ExecutionNoteRecord[];
  issues: IssueRecord[];
  attachments: AttachmentRecord[];
  limits: EvidenceLimits;
}
export interface EvidenceProvenance {
  appointmentId?: string;
  assignmentId?: string;
  itemId?: string;
  visibility?: EvidenceVisibility;
}
export interface CreateExecutionNoteRequest extends EvidenceProvenance {
  operationKey: string;
  text: string;
}
export interface CreateIssueRequest extends Omit<EvidenceProvenance, 'itemId'> {
  operationKey: string;
  type: IssueType;
  description: string;
  reportedSource: ReportedSource;
  itemIds?: string[];
  attachmentIds?: string[];
  notes?: string;
}
export interface IssueCommandRequest {
  operationKey: string;
  expectedVersion: number;
  reason: string;
}
export interface CreateIssueNoteRequest {
  operationKey: string;
  text: string;
}
export interface UploadAttachmentMetadata extends EvidenceProvenance {
  operationKey: string;
  issueId?: string;
  proofType?: ProofType;
}
export interface WithdrawAttachmentRequest {
  operationKey: string;
  reason: string;
}
export interface ExecutionNoteResponse {
  note: ExecutionNoteRecord;
  receipt?: EvidenceReceiptRecord;
}
export interface IssueResponse {
  issue: IssueRecord;
  receipt?: EvidenceReceiptRecord;
}
export interface AttachmentResponse {
  attachment: AttachmentRecord;
  receipt?: EvidenceReceiptRecord;
}
export interface IssueListQuery {
  status?: IssueStatus;
  type?: IssueType;
  page: number;
  pageSize: number;
}
export interface IssueListResponse {
  issues: IssueRecord[];
  total: number;
  page: number;
  pageSize: number;
}
