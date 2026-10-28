import type {
  OrderProgress,
  AssignmentExecution,
  AppointmentExecutionSummary,
} from './execution-types';
import type { ServiceType } from './service-types';

export type PlanningProgress = OrderProgress;
export type AppointmentStatus = 'SCHEDULED' | 'CANCELLED';
export type ConfirmationStatus = 'NEEDS_CONFIRMATION' | 'CONFIRMED';
export type AssignmentStatus = 'ASSIGNED' | 'CANCELLED';
export type TaskSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type TemplateApplicability = 'ALL' | ServiceType;

export interface WeeklyWorkingWindow {
  /** ISO weekday: Monday=1, Sunday=7. Local Europe/Rome wall time. */
  weekday: number;
  startTime: string;
  endTime: string;
}
export interface CrewPlanningConfigRecord {
  crewId: string;
  weeklyWindows: WeeklyWorkingWindow[];
  travelBufferMinutes: number;
  version: number;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CrewUnavailabilityRecord {
  id: string;
  crewId: string;
  startAt: string;
  endAt: string;
  reason: string;
  active: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface TaskTemplateRecord {
  id: string;
  code: string;
  name: string;
  description: string;
  active: boolean;
  required: boolean;
  severity: TaskSeverity;
  defaultPriority: number;
  applicability: TemplateApplicability;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface PlannedTaskRecord {
  id: string;
  sourceTaskId?: string | null;
  returnScopeKey?: string | null;
  assignmentId: string;
  templateId: string | null;
  name: string;
  description: string;
  required: boolean;
  severity: TaskSeverity;
  priority: number;
  active: boolean;
  resultStatus: 'PENDING' | 'DONE' | 'SKIPPED';
  resultVersion: number;
  doneBy: string | null;
  doneAt: string | null;
  resultReason: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AssignmentRecord {
  id: string;
  appointmentId: string;
  crewId: string;
  crewCode: string;
  crewName: string;
  crewActive: boolean;
  status: AssignmentStatus;
  travelBufferMinutes: number;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  tasks: PlannedTaskRecord[];
  execution: AssignmentExecution;
}
export interface PlanningAttention {
  crewId: string;
  code:
    | 'CREW_INACTIVE'
    | 'OUTSIDE_WORKING_WINDOW'
    | 'UNAVAILABLE'
    | 'BOOKING_CONFLICT'
    | 'UNKNOWN_RELEASE'
    | 'PREDICTED_CONFLICT';
  message: string;
  appointmentId?: string;
  from?: string;
  to?: string;
}
export interface AppointmentDetail {
  id: string;
  returnRequestId?: string | null;
  orderId: string;
  orderNumber: string;
  customerName: string;
  city: string;
  serviceType: ServiceType;
  plannedStartAt: string;
  plannedEndAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  confirmationStatus: ConfirmationStatus;
  confirmedAt: string | null;
  confirmedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  notes: string;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  assignments: AssignmentRecord[];
  execution: AppointmentExecutionSummary;
  needsAttention: boolean;
  attention: PlanningAttention[];
}
export interface CreateAppointmentRequest {
  localStart: string;
  durationMinutes: number;
  crewIds: string[];
  templateIds?: string[];
  notes?: string;
  idempotencyKey: string;
}
export interface PlannedTaskInput {
  id?: string;
  templateId?: string;
  severity: TaskSeverity;
  priority: number;
}
export interface AssignmentTaskEdit {
  assignmentId: string;
  tasks: PlannedTaskInput[];
}
export interface UpdateAppointmentRequest {
  expectedVersion: number;
  localStart?: string;
  durationMinutes?: number;
  crewIds?: string[];
  notes?: string;
  reason?: string;
  tasks?: AssignmentTaskEdit[];
}
export interface ConfirmAppointmentRequest {
  expectedVersion: number;
}
export interface CancelAppointmentRequest {
  expectedVersion: number;
  reason: string;
}
export interface AppointmentListResponse {
  appointments: AppointmentDetail[];
}
export interface CalendarQuery {
  from: string;
  to: string;
  allTeams: boolean;
  crewIds: string[];
  includeUnassigned: boolean;
}
export interface CalendarResponse extends AppointmentListResponse {
  from: string;
  to: string;
  timeZone: 'Europe/Rome';
}
export interface UpdateCrewPlanningRequest {
  expectedVersion: number;
  weeklyWindows: WeeklyWorkingWindow[];
  travelBufferMinutes: number;
}
export interface CreateCrewUnavailabilityRequest {
  localStart: string;
  localEnd: string;
  reason: string;
}
export interface UpdateCrewUnavailabilityRequest {
  localStart?: string;
  localEnd?: string;
  reason?: string;
  active?: boolean;
}
export interface CrewAvailabilityResponse {
  config: CrewPlanningConfigRecord;
  unavailability: CrewUnavailabilityRecord[];
  affectedAppointments: AppointmentDetail[];
}
export interface TaskTemplateInput {
  code: string;
  name: string;
  description: string;
  active: boolean;
  required: boolean;
  severity: TaskSeverity;
  defaultPriority: number;
  applicability: TemplateApplicability;
}
export type CreateTaskTemplateRequest = TaskTemplateInput;
export type UpdateTaskTemplateRequest = Partial<Omit<TaskTemplateInput, 'code'>>;
export interface TaskTemplateResponse {
  template: TaskTemplateRecord;
}
export interface TaskTemplateListResponse {
  templates: TaskTemplateRecord[];
}
