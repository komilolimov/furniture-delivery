import type { PlanningProgress } from '@furniture-delivery/contracts';
import { OrderList } from '../../../components/order-list';

export default async function OrdersPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ progress?: string; hasOpenIssues?: string }> }>) {
  const { progress, hasOpenIssues } = await searchParams;
  const selected =
    progress &&
    [
      'INBOX',
      'PLANNED',
      'ASSIGNED',
      'IN_PROGRESS',
      'PARTIALLY_COMPLETED',
      'REQUIRES_ATTENTION',
      'AWAITING_REVIEW',
      'COMPLETED',
    ].includes(progress)
      ? (progress as PlanningProgress)
      : '';
  const issues = hasOpenIssues === 'true' || hasOpenIssues === 'false' ? hasOpenIssues : '';
  return (
    <OrderList key={`${selected}:${issues}`} initialProgress={selected} initialIssues={issues} />
  );
}
