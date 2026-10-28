import type { ReturnRequestStatus } from '@furniture-delivery/contracts';
import { CalendarClock, CircleCheck, ClipboardCheck, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';

const presentation = {
  OPEN: { label: 'Open', icon: RotateCcw },
  PLANNED: { label: 'Planned', icon: CalendarClock },
  RESOLVED: { label: 'Resolved', icon: CircleCheck },
};
export const returnStatusLabel = (status: ReturnRequestStatus) => presentation[status].label;
export function ReturnStatusIcon({
  status,
  className,
}: Readonly<{ status: ReturnRequestStatus; className?: string }>) {
  const Icon = presentation[status].icon;
  return (
    <Icon
      size={16}
      strokeWidth={1.75}
      aria-hidden="true"
      className={cn('tw:size-4 tw:shrink-0', className)}
    />
  );
}
export function ReturnStatusBadge({ status }: Readonly<{ status: ReturnRequestStatus }>) {
  return (
    <Badge
      variant={status === 'RESOLVED' ? 'success' : status === 'PLANNED' ? 'default' : 'warning'}
    >
      <ReturnStatusIcon status={status} className="tw:size-[13px]" />
      {returnStatusLabel(status)}
    </Badge>
  );
}
export function ReturnReadinessBadge({
  status,
  readyToResolve,
}: Readonly<{ status: ReturnRequestStatus; readyToResolve: boolean }>) {
  if (status === 'RESOLVED')
    return (
      <Badge variant="success">
        <CircleCheck size={13} className="tw:size-[13px]" aria-hidden="true" />
        Need resolved
      </Badge>
    );
  return (
    <Badge variant={readyToResolve ? 'success' : 'outline'}>
      <ClipboardCheck size={13} className="tw:size-[13px]" aria-hidden="true" />
      {readyToResolve ? 'Ready for review' : 'Need remains open'}
    </Badge>
  );
}
