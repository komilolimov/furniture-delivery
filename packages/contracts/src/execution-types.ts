export type ExecutionStatus =
  | 'NOT_STARTED'
  | 'ON_THE_WAY'
  | 'ARRIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'BLOCKED';
export type TaskResultStatus = 'PENDING' | 'DONE' | 'SKIPPED';
export type TerminalOutcome = 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'BLOCKED';
export type ExecutionAction = 'DEPART' | 'ARRIVE' | 'START' | 'FINISH';
export type OrderProgress =
  | 'INBOX'
  | 'PLANNED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'PARTIALLY_COMPLETED'
  | 'REQUIRES_ATTENTION'
  | 'AWAITING_REVIEW'
  | 'COMPLETED';
export type CrewWorkView = 'today' | 'upcoming' | 'open' | 'completed';
export type ReturnRequestStatus = 'OPEN' | 'PLANNED' | 'RESOLVED';

export interface AssignmentExecution {
  status: ExecutionStatus;
  version: number;
  departedAt: string | null;
  arrivedAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  estimatedFinishAt: string | null;
  estimateUpdatedAt: string | null;
  estimateUpdatedBy: string | null;
  estimateReason: string | null;
  estimateVersion: number;
  maybeDelayed: boolean;
}
export interface AppointmentExecutionSummary {
  orderProgress: OrderProgress;
  workReadyForReview: boolean;
  openIssueCount: number;
  returnVisitRequired: boolean;
  activeCount: number;
  completedCount: number;
  partiallyCompletedCount: number;
  blockedCount: number;
  notStartedCount: number;
  requiredDoneCount: number;
  requiredCount: number;
  maybeDelayed: boolean;
}
