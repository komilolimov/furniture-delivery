import type { EvidenceVisibility, IssueStatus, IssueType } from '@furniture-delivery/contracts';
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  DoorClosed,
  ListOrdered,
  PackageSearch,
  PackageX,
  Puzzle,
  Shield,
  UserRoundX,
  Users,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';

export const issueTypes: IssueType[] = [
  'DAMAGE',
  'MISSING_PARTS',
  'WRONG_PRODUCT',
  'QUANTITY_MISMATCH',
  'ACCESS_PROBLEM',
  'CUSTOMER_UNAVAILABLE',
  'OTHER',
];
const presentation = {
  DAMAGE: { label: 'Damage', icon: PackageX },
  MISSING_PARTS: { label: 'Missing parts', icon: Puzzle },
  WRONG_PRODUCT: { label: 'Wrong product', icon: PackageSearch },
  QUANTITY_MISMATCH: { label: 'Quantity mismatch', icon: ListOrdered },
  ACCESS_PROBLEM: { label: 'Access problem', icon: DoorClosed },
  CUSTOMER_UNAVAILABLE: { label: 'Customer unavailable', icon: UserRoundX },
  OTHER: { label: 'Other', icon: CircleHelp },
};
export const issueTypeLabel = (type: IssueType) => presentation[type].label;

export function IssueTypeIcon({
  type,
  className,
}: Readonly<{ type: IssueType; className?: string }>) {
  const Icon = presentation[type].icon;
  return (
    <Icon
      aria-hidden="true"
      size={18}
      strokeWidth={1.75}
      className={cn('tw:size-[18px] tw:shrink-0', className)}
    />
  );
}
export function IssueStatusBadge({ status }: Readonly<{ status: IssueStatus }>) {
  const Icon = status === 'OPEN' ? CircleAlert : CircleCheck;
  return (
    <Badge variant={status === 'OPEN' ? 'warning' : 'success'}>
      <Icon aria-hidden="true" size={13} strokeWidth={1.75} className="tw:size-[13px]" />
      {status === 'OPEN' ? 'Open' : 'Resolved'}
    </Badge>
  );
}
export function IssueVisibilityBadge({ visibility }: Readonly<{ visibility: EvidenceVisibility }>) {
  const Icon = visibility === 'BACKOFFICE_ONLY' ? Shield : Users;
  return (
    <Badge variant="outline">
      <Icon aria-hidden="true" size={13} strokeWidth={1.75} className="tw:size-[13px]" />
      {visibility === 'BACKOFFICE_ONLY' ? 'Backoffice only' : 'Crew visible'}
    </Badge>
  );
}
