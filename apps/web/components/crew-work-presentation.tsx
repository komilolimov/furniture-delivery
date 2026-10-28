import type { ConfirmationStatus, ExecutionStatus } from '@furniture-delivery/contracts';
import {
  CalendarClock,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  Clock3,
  MapPin,
  Navigation,
  Wrench,
} from 'lucide-react';
import { executionStatusLabel } from '../lib/execution-labels';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
const icons = {
  NOT_STARTED: CalendarClock,
  ON_THE_WAY: Navigation,
  ARRIVED: MapPin,
  IN_PROGRESS: Wrench,
  COMPLETED: CircleCheck,
  PARTIALLY_COMPLETED: Clock3,
  BLOCKED: CircleAlert,
};
export function CrewExecutionIcon({
  status,
  className,
}: Readonly<{ status: ExecutionStatus; className?: string }>) {
  const Icon = icons[status];
  return (
    <Icon
      size={16}
      strokeWidth={1.75}
      aria-hidden="true"
      className={cn('tw:size-4 tw:shrink-0', className)}
    />
  );
}
export function CrewExecutionBadge({ status }: Readonly<{ status: ExecutionStatus }>) {
  const tone =
    status === 'COMPLETED'
      ? 'success'
      : status === 'BLOCKED'
        ? 'destructive'
        : status === 'PARTIALLY_COMPLETED'
          ? 'warning'
          : status === 'NOT_STARTED'
            ? 'secondary'
            : 'default';
  return (
    <Badge variant={tone} className="tw:px-3 tw:py-1.5 tw:text-[11px]">
      <CrewExecutionIcon status={status} className="tw:size-[14px]" />
      {executionStatusLabel(status)}
    </Badge>
  );
}
export function CrewConfirmationBadge({ status }: Readonly<{ status: ConfirmationStatus }>) {
  const confirmed = status === 'CONFIRMED';
  return (
    <Badge variant={confirmed ? 'success' : 'warning'} className="tw:px-3 tw:py-1.5 tw:text-[11px]">
      {confirmed ? (
        <CheckCheck size={14} className="tw:size-[14px]" aria-hidden="true" />
      ) : (
        <CalendarClock size={14} className="tw:size-[14px]" aria-hidden="true" />
      )}
      {confirmed ? 'Client confirmed' : 'Needs client confirmation'}
    </Badge>
  );
}
