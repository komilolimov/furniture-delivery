import type { WorkEnvironment } from './crews';
import type { ExecutionReceiptRecord } from './execution';
import type { AppointmentResponse } from './orders';

export type ReleaseBasis = 'PLAN' | 'ESTIMATE' | 'ACTUAL' | 'UNKNOWN';

export interface EstimateCommand {
  operationKey: string;
  expectedEstimateVersion: number;
  /** Europe/Rome local wall time; null explicitly clears the estimate. */
  localFinish: string | null;
  reason: string;
}

export interface EstimateResponse {
  assignmentId: string;
  estimatedFinishAt: string | null;
  estimateUpdatedAt: string | null;
  estimateUpdatedBy: string | null;
  estimateReason: string | null;
  estimateVersion: number;
  receipt?: ExecutionReceiptRecord;
}

export interface RiskQuery {
  from: string;
  to: string;
  allTeams: boolean;
  crewIds: string[];
}

export type RiskReasonCode =
  | 'NOT_DEPARTED'
  | 'OVERRUN'
  | 'ESTIMATE_STALE'
  | 'NEXT_VISIT_AT_RISK'
  | 'UNKNOWN_RELEASE';

export interface RiskReason {
  code: RiskReasonCode;
  crewId: string;
  crewName: string;
  sourceAssignmentId: string;
  sourceAppointmentId: string;
  sourcePlannedStartAt: string;
  sourcePlannedEndAt: string;
  sourceEstimatedFinishAt: string | null;
  sourceActualEndAt: string | null;
  travelBufferMinutes: number;
  expectedReleaseAt: string | null;
  basis: ReleaseBasis;
  message: string;
}

export interface RiskVisit {
  appointmentId: string;
  orderId: string;
  orderNumber: string;
  plannedStartAt: string;
  plannedEndAt: string;
  reasons: RiskReason[];
}

export interface RiskBoardResponse {
  dataAsOf: string;
  timeZone: string;
  from: string;
  to: string;
  risks: RiskVisit[];
}

export interface SlotSearchQuery {
  context: 'APPOINTMENT' | 'RETURN_REQUEST';
  orderId: string;
  appointmentId?: string;
  requestId?: string;
  earliestLocal: string;
  /** Inclusive Europe/Rome date; defaults to earliestLocal's date. */
  from?: string;
  /** Exclusive Europe/Rome date; defaults to a 14-day range. */
  to?: string;
  durationMinutes: number;
  crewIds: string[];
  alternativeCrews: boolean;
}

export interface SlotCrew {
  id: string;
  code: string;
  name: string;
  active: boolean;
  serviceArea: string;
  workEnvironment: WorkEnvironment;
  travelBufferMinutes: number;
}

export interface SlotCandidate {
  localStart: string;
  plannedStartAt: string;
  plannedEndAt: string;
  durationMinutes: number;
  crewIds: string[];
  crews: SlotCrew[];
  basis: Exclude<ReleaseBasis, 'UNKNOWN'>;
  notes: string[];
}

export interface SlotSearchResponse {
  dataAsOf: string;
  timeZone: string;
  from: string;
  to: string;
  earliestAt: string;
  candidates: SlotCandidate[];
  limited: boolean;
  blockedCrews: { crewId: string; crewName: string; message: string }[];
  message: string | null;
}

export interface ApplyRescheduleCommand {
  operationKey: string;
  expectedVersion: number;
  localStart: string;
  durationMinutes: number;
  crewIds: string[];
  reason: string;
}

export interface ApplyRescheduleResponse extends AppointmentResponse {
  receipt: ExecutionReceiptRecord;
}
