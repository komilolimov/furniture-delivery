import type {
  CrewWorkItem,
  ExecutionReceiptRecord,
  FinishReportRecord,
  ReturnVisitRequestRecord,
  TaskResultStatus,
} from './execution';
import type { AppointmentDetail, TaskSeverity } from './planning';

export type { ReturnRequestStatus } from './execution-types';

export interface ReturnScopeTask {
  key: string;
  sourceTaskId: string | null;
  sourceAssignmentId: string | null;
  name: string;
  description: string;
  required: boolean;
  severity: TaskSeverity;
  priority: number;
  crewId: string;
  addedReason: string | null;
}

/** Absolute accumulated OrderItem targets, never quantities to add per visit. */
export interface ReturnItemTarget {
  itemId: string;
  deliveredQuantity: number;
  assembledQuantity: number;
}

export interface ReturnAttemptScope {
  tasks: ReturnScopeTask[];
  itemTargets: ReturnItemTarget[];
}

export interface ReturnAttemptRecord {
  id: string;
  requestId: string;
  appointmentId: string;
  current: boolean;
  closedOutcome: 'CANCELLED' | 'FAILED' | 'RESOLVED' | null;
  scope: ReturnAttemptScope;
  returnRequested: boolean;
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
  closedBy: string | null;
  closeReason: string | null;
}

export interface ReturnScopeCandidate {
  sourceTaskId: string;
  sourceAssignmentId: string;
  sourceAppointmentId: string;
  name: string;
  description: string;
  required: boolean;
  severity: TaskSeverity;
  priority: number;
  resultStatus: TaskResultStatus;
}

export interface ReturnQueueEntry {
  request: ReturnVisitRequestRecord;
  orderNumber: string;
  customerName: string;
  currentAppointmentId: string | null;
  readyToResolve: boolean;
}

export interface ReturnQueueQuery {
  status?: 'OPEN' | 'PLANNED' | 'RESOLVED';
  orderId?: string;
  page: number;
  pageSize: number;
}

export interface ReturnQueueResponse {
  requests: ReturnQueueEntry[];
  total: number;
  page: number;
  pageSize: number;
}

/** Backoffice-only: use CrewReturnContext for employees. */
export interface ReturnRequestDetail {
  request: ReturnVisitRequestRecord;
  sourceReport: FinishReportRecord;
  scopeCandidates: ReturnScopeCandidate[];
  items: CrewWorkItem[];
  attempts: ReturnAttemptRecord[];
  currentAppointment: AppointmentDetail | null;
  readyToResolve: boolean;
  resolveBlockedReasons: string[];
}

export interface ReturnRequestResponse {
  request: ReturnRequestDetail;
  receipt?: ExecutionReceiptRecord;
}

export interface CreateReturnRequestCommand {
  operationKey: string;
  expectedExecutionVersion: number;
  reason: string;
  remainingWork: string;
}

export interface CarriedReturnTaskInput {
  sourceTaskId: string;
  crewId: string;
}

export interface NewReturnTaskInput {
  crewId: string;
  name: string;
  description: string;
  required: boolean;
  severity: TaskSeverity;
  priority: number;
  reason: string;
}

export interface PlanReturnVisitCommand {
  operationKey: string;
  expectedVersion: number;
  localStart: string;
  durationMinutes: number;
  crewIds: string[];
  carriedTasks: CarriedReturnTaskInput[];
  newTasks: NewReturnTaskInput[];
  itemTargets: ReturnItemTarget[];
  reason: string;
  notes?: string;
}

export interface ResolveReturnRequestCommand {
  operationKey: string;
  expectedVersion: number;
  reason: string;
}

/** Scope is restricted to the current employee's permitted assignment. */
export interface CrewReturnContext {
  requestId: string;
  sourceAppointmentId: string;
  reason: string;
  remainingWork: string;
  scope: ReturnAttemptScope;
  sourceTasks: { id: string; name: string; resultStatus: TaskResultStatus }[];
}
