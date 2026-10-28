import type { ExecutionStatus, OrderProgress } from '@furniture-delivery/contracts';

const statuses: Record<ExecutionStatus, string> = {
  NOT_STARTED: 'Not started',
  ON_THE_WAY: 'On the way',
  ARRIVED: 'Arrived',
  IN_PROGRESS: 'Work in progress',
  COMPLETED: "Team's visit completed",
  PARTIALLY_COMPLETED: 'Partial outcome',
  BLOCKED: 'Blocked attempt',
};
const progress: Record<OrderProgress, string> = {
  INBOX: 'Inbox',
  PLANNED: 'Planned',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  PARTIALLY_COMPLETED: 'Partially completed',
  REQUIRES_ATTENTION: 'Requires attention',
  AWAITING_REVIEW: 'Awaiting review',
  COMPLETED: 'Completed',
};
export const executionStatusLabel = (value: ExecutionStatus) => statuses[value];
export const orderProgressLabel = (value: OrderProgress) => progress[value];
export function formatWorkTime(value: string | null): string {
  return value === null
    ? 'Not recorded'
    : new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Rome',
      }).format(new Date(value));
}
