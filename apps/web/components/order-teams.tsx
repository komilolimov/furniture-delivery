import type { AssignedOrderCrew } from '@furniture-delivery/contracts';
import { Badge } from './ui/badge';
import { OrderIcon } from './ui/order-icon';
export function OrderTeams({
  crews,
  compact = false,
}: Readonly<{ crews: AssignedOrderCrew[]; compact?: boolean }>) {
  if (crews.length === 0) return <span className="tw:text-xs tw:text-[#7a8871]">Not assigned</span>;
  const shown = compact ? crews.slice(0, 2) : crews;
  return (
    <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:gap-1.5">
      {shown.map((crew) => (
        <Badge
          key={crew.id}
          variant="outline"
          title={`${crew.code} · ${crew.name}`}
          className="tw:gap-1.5"
        >
          <OrderIcon name="teams" className="tw:size-3.5" />
          <span className="tw:min-w-0 tw:wrap-anywhere">{crew.name}</span>
        </Badge>
      ))}
      {shown.length < crews.length && (
        <Badge
          variant="secondary"
          title={crews
            .slice(shown.length)
            .map((crew) => crew.name)
            .join(', ')}
        >
          +{crews.length - shown.length}
          <span className="tw:sr-only">
            {' '}
            teams:{' '}
            {crews
              .slice(shown.length)
              .map((crew) => crew.name)
              .join(', ')}
          </span>
        </Badge>
      )}
    </div>
  );
}
