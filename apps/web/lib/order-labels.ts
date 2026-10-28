import type { PaymentStatus, PlanningProgress, ServiceType } from '@furniture-delivery/contracts';

export const paymentLabels: Record<PaymentStatus, string> = {
  NOT_REQUIRED: 'Not required',
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
};
export const serviceLabels: Record<ServiceType, string> = {
  DELIVERY_ONLY: 'Delivery only',
  DELIVERY_AND_ASSEMBLY: 'Delivery and assembly',
};
export const progressLabels: Record<PlanningProgress, string> = {
  INBOX: 'Inbox / To plan',
  PLANNED: 'Planned · awaiting teams',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  PARTIALLY_COMPLETED: 'Partially completed',
  REQUIRES_ATTENTION: 'Requires attention',
  AWAITING_REVIEW: 'Awaiting review',
  COMPLETED: 'Completed',
};
