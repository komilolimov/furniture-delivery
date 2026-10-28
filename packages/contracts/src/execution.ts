import type { ServiceType } from './service-types';
import type { AppointmentDetail, ConfirmationStatus, TaskSeverity } from './planning';

export type {
  ExecutionStatus,
  TaskResultStatus,
  TerminalOutcome,
  ExecutionAction,
  OrderProgress,
  CrewWorkView,
  ReturnRequestStatus,
  AssignmentExecution,
  AppointmentExecutionSummary,
} from './execution-types';
import type {
  TaskResultStatus,
  TerminalOutcome,
  ExecutionAction,
  CrewWorkView,
  AssignmentExecution,
  ReturnRequestStatus,
} from './execution-types';

export interface CrewWorkTask {
  id: string;
  /** Older immutable finish-report snapshots can omit M6 provenance. */
  sourceTaskId?: string | null;
  returnScopeKey?: string | null;
  name: string;
  description: string;
  required: boolean;
  severity: TaskSeverity;
  priority: number;
  resultStatus: TaskResultStatus;
  resultVersion: number;
  doneBy: string | null;
  doneAt: string | null;
  resultReason: string | null;
}
export interface CrewWorkItem {
  id: string;
  description: string;
  quantity: number;
  configuration: string;
  ambient: string;
  notes: string;
  requiresAssembly: boolean;
  sortOrder: number;
  deliveredQuantity: number;
  assembledQuantity: number;
  fulfillmentVersion: number;
  remainingDeliveryQuantity: number;
  remainingAssemblyQuantity: number;
}

export interface CrewAssignmentSummary {
  id: string;
  orderProgress?: import('./execution-types').OrderProgress;
  appointmentId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  city: string;
  serviceType: ServiceType;
  crewId: string;
  crewName: string;
  crewActive: boolean;
  plannedStartAt: string;
  plannedEndAt: string;
  appointmentVersion: number;
  confirmationStatus: ConfirmationStatus;
  execution: AssignmentExecution;
}
export interface CrewOrderContact {
  id: string;
  number: string;
  customerName: string;
  contactName: string | null;
  phoneNumbers: string[];
  email: string | null;
  address: string;
  city: string;
  country: string;
  postalCode: string | null;
  serviceType: ServiceType;
  workDescription: string;
  estimatedDurationMinutes: number;
  floor: string | null;
  hasElevator: boolean | null;
  easyAccess: boolean | null;
  parkingAvailable: boolean | null;
  accessRestrictions: string;
  accessNotes: string;
  crewNotes: string;
}
export interface FinishReportRecord {
  id: string;
  orderId: string;
  appointmentId: string;
  assignmentId: string;
  outcome: TerminalOutcome;
  summary: string;
  reason: string | null;
  remainingWork: string | null;
  quantityScope: 'ACCUMULATED_ORDER';
  taskResults: CrewWorkTask[];
  quantities: CrewWorkItem[];
  knownIssueIds: string[];
  attachmentIds: string[];
  authorId: string;
  actualEndAt: string;
  createdAt: string;
}
export interface ReturnVisitRequestRecord {
  id: string;
  orderId: string;
  appointmentId: string;
  assignmentId: string;
  finishReportId: string;
  status: ReturnRequestStatus;
  version: number;
  reason: string;
  remainingWork: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
}
export interface CrewAssignmentDetail extends CrewAssignmentSummary {
  returnContext?: import('./return-visits').CrewReturnContext | null;
  order: CrewOrderContact;
  items: CrewWorkItem[];
  tasks: CrewWorkTask[];
  allowedActions: ExecutionAction[];
  departureBlockedReason: string | null;
  canEditResults: boolean;
  canAppendEvidence: boolean;
  businessDate: string;
  timeZone: 'Europe/Rome';
  finishReport: FinishReportRecord | null;
  returnRequests: ReturnVisitRequestRecord[];
  openIssueCount: number;
  returnVisitRequired: boolean;
}
export interface ExecutionReceiptRecord {
  id: string;
  action: string;
  resultId: string | null;
  createdAt: string;
}
export interface CrewAssignmentResponse {
  assignment: CrewAssignmentDetail;
  receipt?: ExecutionReceiptRecord;
}
export interface CrewAssignmentListResponse {
  assignments: CrewAssignmentSummary[];
  total: number;
  page: number;
  pageSize: number;
  businessDate: string;
  timeZone: 'Europe/Rome';
}
export interface CrewAssignmentQuery {
  view: CrewWorkView;
  page: number;
  pageSize: number;
}
export interface ExecutionCommand {
  operationKey: string;
  expectedExecutionVersion: number;
}
export interface DepartCommand extends ExecutionCommand {
  expectedAppointmentVersion: number;
}
export interface TaskResultCommand {
  operationKey: string;
  expectedTaskVersion: number;
  resultStatus: TaskResultStatus;
  reason?: string;
}
export interface FulfillmentCommand {
  operationKey: string;
  expectedFulfillmentVersion: number;
  deliveredQuantity: number;
  assembledQuantity: number;
  reason?: string;
}
export interface FinishCommand extends ExecutionCommand {
  outcome: TerminalOutcome;
  summary: string;
  reason?: string;
  remainingWork?: string;
  returnVisitRequired: boolean;
  returnReason?: string;
}

export interface OrderExecutionSummary {
  workReadyForReview: boolean;
  openIssueCount: number;
  returnVisitRequired: boolean;
  activeAssignmentCount: number;
  completedAssignmentCount: number;
  partiallyCompletedAssignmentCount: number;
  blockedAssignmentCount: number;
  finishReports: FinishReportRecord[];
  returnRequests: ReturnVisitRequestRecord[];
}

export interface OrderExecutionResponse {
  execution: OrderExecutionSummary;
  appointments: AppointmentDetail[];
}
