import type { OrderExecutionSummary } from './execution';
import type { AppointmentDetail, PlanningProgress } from './planning';

import type { ServiceType } from './service-types';
export type { ServiceType } from './service-types';
export type OrderProgress = PlanningProgress;
export type PaymentStatus = 'NOT_REQUIRED' | 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'OTHER';
export type PaymentRecordStatus = 'RECORDED' | 'VOIDED';
export type ActivityAction =
  | 'ORDER_CREATED'
  | 'ORDER_UPDATED'
  | 'ITEM_ADDED'
  | 'ITEM_UPDATED'
  | 'ITEM_REMOVED'
  | 'PAYMENT_RECORDED'
  | 'PAYMENT_VOIDED'
  | 'APPOINTMENT_CREATED'
  | 'APPOINTMENT_UPDATED'
  | 'APPOINTMENT_CONFIRMED'
  | 'APPOINTMENT_CANCELLED'
  | 'CONFIRMATION_RESET'
  | 'EXECUTION_DEPARTED'
  | 'EXECUTION_ARRIVED'
  | 'EXECUTION_STARTED'
  | 'EXECUTION_FINISHED'
  | 'ESTIMATE_SET'
  | 'APPOINTMENT_RESCHEDULED'
  | 'RETURN_VISIT_PLANNED'
  | 'RETURN_VISIT_RESOLVED'
  | 'RETURN_VISIT_REOPENED'
  | 'ACCEPTANCE_PREPARED'
  | 'ACCEPTANCE_SIGNED'
  | 'ACCEPTANCE_ABSENT'
  | 'EXCEPTION_REVIEWED'
  | 'ACCEPTANCE_INVALIDATED'
  | 'ORDER_COMPLETED'
  | 'ORDER_REOPENED'
  | 'TASK_RESULT_CHANGED'
  | 'ITEM_FULFILLMENT'
  | 'RETURN_VISIT_REQUESTED'
  | 'EXECUTION_NOTE_ADDED'
  | 'ISSUE_CREATED'
  | 'ISSUE_RESOLVED'
  | 'ISSUE_REOPENED'
  | 'ISSUE_NOTE_ADDED'
  | 'ATTACHMENT_UPLOADED'
  | 'ATTACHMENT_WITHDRAWN';

export interface OrderFields {
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
  internalNotes: string;
  crewNotes: string;
  orderTotalCents: number;
}

export interface OrderItemInput {
  id?: string;
  description: string;
  quantity: number;
  configuration: string;
  ambient: string;
  notes: string;
  requiresAssembly: boolean;
  sortOrder: number;
}

export interface OrderItemRecord extends Omit<OrderItemInput, 'id'> {
  deliveredQuantity: number;
  assembledQuantity: number;
  fulfillmentVersion: number;
  id: string;
  orderId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Crews of non-cancelled visits/assignments, including completed participation. */
export interface AssignedOrderCrew {
  id: string;
  code: string;
  name: string;
}

export interface OrderSummary {
  assignedCrews: AssignedOrderCrew[];
  id: string;
  currentCompletionId?: string | null;
  number: string;
  customerName: string;
  city: string;
  serviceType: ServiceType;
  progress: PlanningProgress;
  workReadyForReview: boolean;
  openIssueCount: number;
  returnVisitRequired: boolean;
  orderTotalCents: number;
  paidCents: number;
  balanceCents: number;
  paymentStatus: PaymentStatus;
  currency: 'EUR';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  amountCents: number;
  paidOn: string;
  method: PaymentMethod;
  note: string | null;
  status: PaymentRecordStatus;
  createdBy: string;
  createdAt: string;
  voidedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface ActivityRecord {
  id: string;
  orderId: string;
  actorId: string;
  action: ActivityAction;
  targetId: string;
  createdAt: string;
  reason: string | null;
  changes: Record<string, unknown>;
}

export interface OrderDetail extends OrderSummary, OrderFields {
  createdBy: string;
  updatedBy: string;
  items: OrderItemRecord[];
  payments: PaymentRecord[];
  activity: ActivityRecord[];
  appointments: AppointmentDetail[];
  execution: OrderExecutionSummary;
}

export interface CreateOrderRequest extends OrderFields {
  items: OrderItemInput[];
}
export interface UpdateOrderRequest extends Partial<OrderFields> {
  expectedVersion: number;
  items?: OrderItemInput[];
}
export interface CreatePaymentRequest {
  amountCents: number;
  paidOn: string;
  method: PaymentMethod;
  note?: string | null;
  idempotencyKey: string;
}
export interface VoidPaymentRequest {
  reason: string;
}
export interface OrderResponse {
  order: OrderDetail;
}
export interface PaymentResponse {
  payment: PaymentRecord;
  order: OrderDetail;
}
export interface OrderListResponse {
  orders: OrderSummary[];
  total: number;
  page: number;
  pageSize: number;
}
export interface OrderListQuery {
  search?: string;
  serviceType?: ServiceType;
  paymentStatus?: PaymentStatus;
  progress?: PlanningProgress;
  hasOpenIssues?: boolean;
  page?: number;
  pageSize?: number;
}
export interface DashboardResponse {
  completedCount: number;
  inboxCount: number;
  plannedCount: number;
  assignedCount: number;
  inProgressCount: number;
  partiallyCompletedCount: number;
  requiresAttentionCount: number;
  awaitingReviewCount: number;
  openIssueCount: number;
  returnVisitRequiredCount: number;
  orderTotalCents: number;
  paidCents: number;
  balanceCents: number;
  currency: 'EUR';
}

export interface AppointmentResponse {
  appointment: AppointmentDetail;
  order: OrderDetail;
}
