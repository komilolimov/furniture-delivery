import {
  ArrowRight,
  ClipboardList,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
const icons = {
  plus: Plus,
  search: Search,
  arrow: ArrowRight,
  orders: ClipboardList,
  refresh: RefreshCw,
  filters: SlidersHorizontal,
  close: X,
  teams: Users,
};
export function OrderIcon({
  name,
  className,
}: Readonly<{ name: keyof typeof icons; className?: string }>) {
  const Icon = icons[name];
  return (
    <Icon
      aria-hidden="true"
      size={16}
      strokeWidth={1.75}
      className={cn('tw:size-4 tw:shrink-0', className)}
    />
  );
}
