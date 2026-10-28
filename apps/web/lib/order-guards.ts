import type {
  DashboardResponse,
  OrderDetail,
  OrderListResponse,
  OrderResponse,
  OrderSummary,
  PaymentRecord,
  PaymentResponse,
  AppointmentResponse,
} from '@furniture-delivery/contracts';
import { isAppointmentDetail } from './planning-guards';
import { isOrderProgress } from './execution-record-guards';
import { isOrderExecutionSummary } from './execution-guards';

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string';
const nullableText = (value: unknown) => value === null || text(value);
const integer = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableBoolean = (value: unknown) => value === null || typeof value === 'boolean';

export function isOrderSummary(value: unknown): value is OrderSummary {
  return (
    object(value) &&
    ['id', 'number', 'customerName', 'city', 'createdAt', 'updatedAt'].every((key) =>
      text(value[key]),
    ) &&
    Array.isArray(value.assignedCrews) &&
    value.assignedCrews.every(
      (crew: unknown) => object(crew) && ['id', 'code', 'name'].every((key) => text(crew[key])),
    ) &&
    ['DELIVERY_ONLY', 'DELIVERY_AND_ASSEMBLY'].includes(String(value.serviceType)) &&
    isOrderProgress(value.progress) &&
    (value.currentCompletionId === undefined || nullableText(value.currentCompletionId)) &&
    typeof value.workReadyForReview === 'boolean' &&
    typeof value.returnVisitRequired === 'boolean' &&
    integer(value.openIssueCount) &&
    value.currency === 'EUR' &&
    ['orderTotalCents', 'paidCents', 'balanceCents', 'version'].every((key) =>
      integer(value[key]),
    ) &&
    ['NOT_REQUIRED', 'UNPAID', 'PARTIALLY_PAID', 'PAID'].includes(String(value.paymentStatus))
  );
}
export function isPayment(value: unknown): value is PaymentRecord {
  return (
    object(value) &&
    ['id', 'orderId', 'paidOn', 'createdAt', 'createdBy'].every((key) => text(value[key])) &&
    integer(value.amountCents) &&
    ['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER'].includes(String(value.method)) &&
    ['RECORDED', 'VOIDED'].includes(String(value.status)) &&
    ['note', 'voidedBy', 'voidedAt', 'voidReason'].every((key) => nullableText(value[key]))
  );
}
export function isOrderDetail(value: unknown): value is OrderDetail {
  if (!isOrderSummary(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return (
    [
      'address',
      'country',
      'workDescription',
      'accessRestrictions',
      'accessNotes',
      'internalNotes',
      'crewNotes',
      'createdBy',
      'updatedBy',
    ].every((key) => text(record[key])) &&
    ['contactName', 'email', 'postalCode', 'floor'].every((key) => nullableText(record[key])) &&
    ['hasElevator', 'easyAccess', 'parkingAvailable'].every((key) =>
      nullableBoolean(record[key]),
    ) &&
    integer(record.estimatedDurationMinutes) &&
    Array.isArray(record.phoneNumbers) &&
    record.phoneNumbers.every(text) &&
    Array.isArray(record.items) &&
    record.items.every(
      (item: unknown) =>
        object(item) &&
        [
          'id',
          'orderId',
          'description',
          'configuration',
          'ambient',
          'notes',
          'createdAt',
          'updatedAt',
        ].every((key) => text(item[key])) &&
        integer(item.quantity) &&
        integer(item.sortOrder) &&
        ['deliveredQuantity', 'assembledQuantity', 'fulfillmentVersion'].every((key) =>
          integer(item[key]),
        ) &&
        typeof item.requiresAssembly === 'boolean' &&
        typeof item.active === 'boolean',
    ) &&
    Array.isArray(record.payments) &&
    record.payments.every(isPayment) &&
    Array.isArray(record.appointments) &&
    record.appointments.every(isAppointmentDetail) &&
    isOrderExecutionSummary(record.execution) &&
    Array.isArray(record.activity) &&
    record.activity.every(
      (entry: unknown) =>
        object(entry) &&
        ['id', 'orderId', 'actorId', 'targetId', 'createdAt'].every((key) => text(entry[key])) &&
        [
          'ORDER_CREATED',
          'ORDER_UPDATED',
          'ITEM_ADDED',
          'ITEM_UPDATED',
          'ITEM_REMOVED',
          'PAYMENT_RECORDED',
          'PAYMENT_VOIDED',
          'APPOINTMENT_CREATED',
          'APPOINTMENT_UPDATED',
          'APPOINTMENT_CONFIRMED',
          'APPOINTMENT_CANCELLED',
          'CONFIRMATION_RESET',
          'EXECUTION_DEPARTED',
          'EXECUTION_ARRIVED',
          'EXECUTION_STARTED',
          'EXECUTION_FINISHED',
          'TASK_RESULT_CHANGED',
          'ITEM_FULFILLMENT',
          'RETURN_VISIT_REQUESTED',
          'EXECUTION_NOTE_ADDED',
          'ISSUE_CREATED',
          'ISSUE_RESOLVED',
          'ISSUE_REOPENED',
          'ISSUE_NOTE_ADDED',
          'ATTACHMENT_UPLOADED',
          'ATTACHMENT_WITHDRAWN',
          'ESTIMATE_SET',
          'APPOINTMENT_RESCHEDULED',
          'RETURN_VISIT_PLANNED',
          'RETURN_VISIT_RESOLVED',
          'RETURN_VISIT_REOPENED',
          'ACCEPTANCE_PREPARED',
          'ACCEPTANCE_SIGNED',
          'ACCEPTANCE_ABSENT',
          'EXCEPTION_REVIEWED',
          'ACCEPTANCE_INVALIDATED',
          'ORDER_COMPLETED',
          'ORDER_REOPENED',
        ].includes(String(entry.action)) &&
        nullableText(entry.reason) &&
        object(entry.changes),
    )
  );
}
export const isOrderResponse = (value: unknown): value is OrderResponse =>
  object(value) && isOrderDetail(value.order);
export const isPaymentResponse = (value: unknown): value is PaymentResponse =>
  object(value) && isPayment(value.payment) && isOrderDetail(value.order);
export const isAppointmentResponse = (value: unknown): value is AppointmentResponse =>
  object(value) && isAppointmentDetail(value.appointment) && isOrderDetail(value.order);
export const isOrderListResponse = (value: unknown): value is OrderListResponse =>
  object(value) &&
  Array.isArray(value.orders) &&
  value.orders.every(isOrderSummary) &&
  integer(value.total) &&
  integer(value.page) &&
  integer(value.pageSize);
export const isDashboardResponse = (value: unknown): value is DashboardResponse =>
  object(value) &&
  value.currency === 'EUR' &&
  [
    'inboxCount',
    'plannedCount',
    'assignedCount',
    'inProgressCount',
    'partiallyCompletedCount',
    'requiresAttentionCount',
    'awaitingReviewCount',
    'completedCount',
    'openIssueCount',
    'returnVisitRequiredCount',
    'orderTotalCents',
    'paidCents',
    'balanceCents',
  ].every((key) => integer(value[key]));
