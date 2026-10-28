import type { ExecutionReceiptRecord } from './execution';

/** Immutable basis of one explicit operational decision, not a live readiness cache. */
export interface CompletionDecisionSnapshot {
  schemaVersion: 1;
  orderVersion: number;
  snapshotIds: string[];
  signatureIds: string[];
  exceptionIds: string[];
  coverageRequestIds: string[];
  operationalDetails: Record<string, unknown>;
}

export interface CompletionRecordRecord {
  id: string;
  orderId: string;
  actorId: string;
  createdAt: string;
  reason: string;
  readiness: CompletionDecisionSnapshot;
}

export type OrderReopenSource = 'MANUAL' | 'ISSUE' | 'SNAPSHOT';

export interface OrderReopenEventRecord {
  id: string;
  orderId: string;
  completionId: string;
  actorId: string;
  createdAt: string;
  reason: string;
  source: OrderReopenSource;
  sourceId: string | null;
}

export type CompletionBlockerCode =
  | 'NO_VISITS'
  | 'NO_RECORDED_WORK'
  | 'ACTIVE_EXECUTION'
  | 'UNASSIGNED_VISIT'
  | 'UNSTARTED_VISIT'
  | 'UNCOVERED_EXECUTION'
  | 'INCOMPLETE_TASKS'
  | 'INCOMPLETE_ITEMS'
  | 'OPEN_ISSUES'
  | 'RETURN_REQUIRED'
  | 'MISSING_SNAPSHOT'
  | 'INVALIDATED_SNAPSHOT'
  | 'MISSING_CONFIRMATION'
  | 'PENDING_EXCEPTION'
  | 'REJECTED_EXCEPTION'
  | 'ALREADY_COMPLETED';

export interface CompletionBlocker {
  code: CompletionBlockerCode;
  message: string;
  appointmentId?: string;
  assignmentId?: string;
  taskId?: string;
  itemId?: string;
  issueId?: string;
  requestId?: string;
  snapshotId?: string;
  slotId?: string;
}

export interface CompletionReadinessRecord {
  orderId: string;
  orderVersion: number;
  canComplete: boolean;
  physicalReady: boolean;
  confirmationsReady: boolean;
  currentCompletion: CompletionRecordRecord | null;
  blockers: CompletionBlocker[];
  snapshotIds: string[];
  signatureIds: string[];
  exceptionIds: string[];
  coverageRequestIds: string[];
}

export interface CompletionReadinessResponse {
  readiness: CompletionReadinessRecord;
}

export interface CompletionOperationResponse extends CompletionReadinessResponse {
  receipt?: ExecutionReceiptRecord;
}

export interface CompletionHistoryResponse {
  completions: CompletionRecordRecord[];
  reopenEvents: OrderReopenEventRecord[];
  currentCompletionId: string | null;
}

export interface CompleteOrderCommand {
  operationKey: string;
  expectedVersion: number;
  reason: string;
}

export interface ReopenOrderCommand {
  operationKey: string;
  expectedVersion: number;
  expectedCompletionId: string;
  reason: string;
}
