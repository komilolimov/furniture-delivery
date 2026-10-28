'use client';

import type { OrderListResponse, PlanningProgress } from '@furniture-delivery/contracts';
import Link from 'next/link';
import { useState, type MouseEvent } from 'react';
import { isOrderListResponse } from '../lib/order-guards';
import { paymentLabels, progressLabels, serviceLabels } from '../lib/order-labels';
import { formatCents } from '../lib/money';
import { useOrderResource } from '../lib/use-order-resource';
import { Badge } from './ui/badge';
import { Button, buttonVariants } from './ui/button';
import { SelectField } from './ui/select';
import { OrderIcon } from './ui/order-icon';
import { OrderTeams } from './order-teams';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { OrderQuickView } from './order-quick-view';
import { OrderFilters, type OrderFilterValues } from './order-filters';

export { paymentLabels, progressLabels, serviceLabels } from '../lib/order-labels';

const emptyFilters: OrderFilterValues = {
  search: '',
  serviceType: '',
  paymentStatus: '',
  progress: '',
  hasOpenIssues: '',
  pageSize: '10',
};
const mobileLabel =
  'tw:hidden tw:text-[10px] tw:font-semibold tw:tracking-wide tw:text-[#65716a] tw:uppercase tw:max-[1000px]:block';
const cell =
  'tw:px-4 tw:py-5 tw:align-top tw:max-[1000px]:border-0 tw:max-[1000px]:px-0 tw:max-[1000px]:py-0';

export function OrderList({
  initialProgress = '',
  initialIssues = '',
}: Readonly<{
  initialProgress?: PlanningProgress | '';
  initialIssues?: '' | 'true' | 'false';
}>) {
  const initial: OrderFilterValues = {
    ...emptyFilters,
    progress: initialProgress,
    hasOpenIssues: initialIssues,
  };
  const [filters, setFilters] = useState<OrderFilterValues>(initial);
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<{ id: string; trigger: HTMLElement | null } | null>(null);
  const query = new URLSearchParams({ page: String(page), pageSize: filters.pageSize });
  for (const key of [
    'search',
    'serviceType',
    'paymentStatus',
    'progress',
    'hasOpenIssues',
  ] as const)
    if (filters[key]) query.set(key, filters[key]);
  const resource = useOrderResource<OrderListResponse>(
    `/orders?${query.toString()}`,
    isOrderListResponse,
    { retainDataOnRefresh: true },
  );
  const data = resource.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / Number(filters.pageSize))) : 1;
  const first = data?.orders.length ? (page - 1) * Number(filters.pageSize) + 1 : 0;
  const last = data?.orders.length ? first + data.orders.length - 1 : 0;

  function openRow(event: MouseEvent<HTMLTableRowElement>, id: string) {
    if (event.target instanceof Element && event.target.closest('a,button,input,select')) return;
    const trigger = event.currentTarget.querySelector<HTMLButtonElement>('[data-order-preview]');
    setPreview({ id, trigger });
  }

  return (
    <div className="tw:grid tw:min-w-0 tw:gap-6 tw:text-[#18372e]">
      <header className="tw:flex tw:flex-wrap tw:items-end tw:justify-between tw:gap-5">
        <div className="tw:min-w-0">
          <p className="tw:mt-0 tw:mb-3 tw:text-[10px] tw:font-bold tw:tracking-[1.8px] tw:text-[#226347] tw:uppercase">
            Delivery operations
          </p>
          <h1 className="tw:m-0 tw:text-[40px] tw:leading-[1.15] tw:font-medium tw:tracking-[-1.5px] tw:max-[600px]:text-[34px]">
            Orders
          </h1>
          <p className="tw:mt-3 tw:mb-0 tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
            Find an order, check its progress and keep the next delivery moving.
          </p>
        </div>
        <Link className={buttonVariants({ className: 'tw:gap-2' })} href="/backoffice/orders/new">
          <OrderIcon name="plus" />
          Create order
        </Link>
      </header>

      <OrderFilters
        value={filters}
        onApply={(next) => {
          setPage(1);
          setFilters(next);
        }}
      />

      {resource.pending && (
        <p className="tw:m-0 tw:text-sm tw:text-[#65716a]" role="status">
          {data ? 'Loading updated orders…' : 'Loading orders…'}
        </p>
      )}
      {!resource.pending && resource.error && (
        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#ebdbd3] tw:bg-[#fcf6f1] tw:p-4">
          <p className="tw:m-0 tw:text-sm tw:text-[#97372a]" role="alert">
            {resource.error}
          </p>
          <Button variant="outline" onClick={() => void resource.refresh()}>
            Retry
          </Button>
        </div>
      )}

      {data && (
        <section
          className="tw:min-w-0 tw:overflow-hidden tw:rounded-2xl tw:border tw:border-solid tw:border-[#e0e5da] tw:bg-[#fffefa]"
          aria-label="Order results"
          aria-busy={resource.pending}
        >
          <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:px-5 tw:py-5 tw:max-[600px]:px-4">
            <div>
              <h2 className="tw:m-0 tw:text-lg tw:font-medium tw:tracking-[-0.4px]">
                Order overview
              </h2>
              <p className="tw:mt-1.5 tw:mb-0 tw:text-xs tw:text-[#65716a]">
                {data.total} matching orders · preview here or open the full order.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={resource.pending}
              onClick={() => void resource.refresh()}
            >
              <OrderIcon name="refresh" />
              Refresh orders
            </Button>
          </div>
          {data.orders.length === 0 ? (
            <div className="tw:grid tw:justify-items-center tw:gap-3 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#edf0e8] tw:px-5 tw:py-14 tw:text-center">
              <span className="tw:grid tw:size-12 tw:place-items-center tw:rounded-xl tw:bg-[#edf3e7] tw:text-[#54764e]">
                <OrderIcon name="orders" />
              </span>
              <h2 className="tw:m-0 tw:text-xl tw:font-medium">
                {data.total > 0 ? 'No orders on this page' : 'No matching orders'}
              </h2>
              <p className="tw:m-0 tw:max-w-[360px] tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
                {data.total > 0
                  ? 'The list changed. Return to the first page to see the current results.'
                  : 'Try another search, clear the filters or create a new order.'}
              </p>
              {data.total > 0 ? (
                <Button variant="outline" onClick={() => setPage(1)}>
                  Return to first page
                </Button>
              ) : null}
            </div>
          ) : (
            <Table
              aria-label="Orders"
              role="table"
              className="tw:table-fixed tw:max-[1000px]:block"
            >
              <TableHeader role="rowgroup" className="tw:max-[1000px]:sr-only">
                <TableRow className="tw:bg-[#f5f7f0]">
                  <TableHead className="tw:w-[20%]">Order / customer</TableHead>
                  <TableHead className="tw:w-[10%]">Service</TableHead>
                  <TableHead className="tw:w-[14%]">Teams</TableHead>
                  <TableHead className="tw:w-[13%]">Work progress</TableHead>
                  <TableHead className="tw:w-[10%]">Payment</TableHead>
                  <TableHead className="tw:w-[13%] tw:text-right">Value / balance</TableHead>
                  <TableHead className="tw:w-[10%]">Attention</TableHead>
                  <TableHead className="tw:w-[80px]">
                    <span className="tw:sr-only">Open order</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody
                role="rowgroup"
                className="tw:max-[1000px]:grid tw:max-[1000px]:gap-3 tw:max-[1000px]:p-4"
              >
                {data.orders.map((order) => (
                  <TableRow
                    key={order.id}
                    role="row"
                    className="tw:cursor-pointer tw:hover:bg-[#f8faf4] tw:max-[1000px]:grid tw:max-[1000px]:grid-cols-2 tw:max-[1000px]:gap-4 tw:max-[1000px]:rounded-xl tw:max-[1000px]:border tw:max-[1000px]:border-solid tw:max-[1000px]:border-[#e1e7da] tw:max-[1000px]:p-4"
                    onClick={(event) => openRow(event, order.id)}
                  >
                    <TableCell className={`${cell} tw:max-[1000px]:col-span-2`}>
                      <button
                        type="button"
                        data-order-preview
                        aria-label={`Preview order ${order.number}`}
                        className="tw:mb-1.5 tw:cursor-pointer tw:max-[1000px]:min-h-11 tw:border-0 tw:bg-transparent tw:p-0 tw:text-xs tw:font-bold tw:text-[#226347] tw:underline-offset-4 tw:hover:underline tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-[#739b74] tw:focus-visible:outline-offset-4"
                        onClick={(event) =>
                          setPreview({ id: order.id, trigger: event.currentTarget })
                        }
                      >
                        {order.number}
                      </button>
                      <strong className="tw:block tw:text-sm tw:leading-relaxed tw:font-semibold tw:[overflow-wrap:anywhere]">
                        {order.customerName}
                      </strong>
                      <span className="tw:mt-1 tw:block tw:text-xs tw:text-[#65716a] tw:[overflow-wrap:anywhere]">
                        {order.city}
                      </span>
                    </TableCell>
                    <TableCell className={`${cell} tw:max-[1000px]:col-span-2`}>
                      <span className={mobileLabel}>Service</span>
                      <span className="tw:text-xs tw:leading-relaxed">
                        {serviceLabels[order.serviceType]}
                      </span>
                    </TableCell>
                    <TableCell className={`${cell} tw:max-[1000px]:col-span-2`}>
                      <span className={mobileLabel}>Teams</span>
                      <OrderTeams crews={order.assignedCrews} compact />
                    </TableCell>
                    <TableCell className={cell}>
                      <span className={mobileLabel}>Work progress</span>
                      <Badge
                        variant={
                          order.progress === 'COMPLETED'
                            ? 'success'
                            : [
                                  'PARTIALLY_COMPLETED',
                                  'REQUIRES_ATTENTION',
                                  'AWAITING_REVIEW',
                                ].includes(order.progress)
                              ? 'warning'
                              : order.progress === 'IN_PROGRESS'
                                ? 'default'
                                : 'secondary'
                        }
                      >
                        {progressLabels[order.progress]}
                      </Badge>
                    </TableCell>
                    <TableCell className={cell}>
                      <span className={mobileLabel}>Payment</span>
                      <Badge
                        variant={
                          order.paymentStatus === 'PAID'
                            ? 'success'
                            : order.paymentStatus === 'PARTIALLY_PAID'
                              ? 'warning'
                              : order.paymentStatus === 'UNPAID'
                                ? 'outline'
                                : 'secondary'
                        }
                      >
                        {paymentLabels[order.paymentStatus]}
                      </Badge>
                    </TableCell>
                    <TableCell className={`${cell} tw:text-right tw:max-[1000px]:text-left`}>
                      <span className={mobileLabel}>Value / balance</span>
                      <strong className="tw:block tw:text-sm tw:font-semibold tw:tabular-nums tw:[overflow-wrap:anywhere]">
                        {formatCents(order.orderTotalCents)}
                      </strong>
                      <span className="tw:mt-1.5 tw:block tw:text-[11px] tw:leading-relaxed tw:text-[#65716a] tw:tabular-nums tw:[overflow-wrap:anywhere]">
                        Balance {formatCents(order.balanceCents)}
                      </span>
                    </TableCell>
                    <TableCell className={cell}>
                      <span className={mobileLabel}>Attention</span>
                      <div className="tw:flex tw:flex-wrap tw:gap-1.5">
                        {order.openIssueCount > 0 && (
                          <Badge variant="destructive">
                            {order.openIssueCount} open{' '}
                            {order.openIssueCount === 1 ? 'issue' : 'issues'}
                          </Badge>
                        )}
                        {order.returnVisitRequired && (
                          <Badge variant="warning">Return visit required</Badge>
                        )}
                        {order.workReadyForReview && (
                          <Badge variant="secondary">Ready for review</Badge>
                        )}
                        {order.openIssueCount === 0 &&
                          !order.returnVisitRequired &&
                          !order.workReadyForReview && (
                            <span className="tw:text-xs tw:text-[#65716a]">No flags</span>
                          )}
                      </div>
                    </TableCell>
                    <TableCell
                      className={`${cell} tw:px-2 tw:text-right tw:max-[1000px]:col-span-2 tw:max-[1000px]:text-left`}
                    >
                      <Link
                        href={`/backoffice/orders/${order.id}`}
                        aria-label={`Open order ${order.number}`}
                        className={buttonVariants({
                          variant: 'ghost',
                          size: 'sm',
                          className: 'tw:gap-1.5 tw:px-2',
                        })}
                      >
                        Open
                        <OrderIcon name="arrow" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <nav
            aria-label="Orders pagination"
            className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e8ece3] tw:px-5 tw:py-4 tw:max-[600px]:px-4"
          >
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-5 tw:gap-y-2">
              <span className="tw:text-xs tw:tabular-nums tw:text-[#65716a]">
                Showing {first}–{last} of {data.total}
              </span>
              <label className="tw:flex tw:items-center tw:gap-2 tw:text-[11px] tw:font-normal tw:text-[#65716a]">
                Per page
                <SelectField
                  label="Per page"
                  className="tw:w-[84px]"
                  value={filters.pageSize}
                  disabled={resource.pending}
                  onValueChange={(pageSize) => {
                    setPage(1);
                    setFilters((previous) => ({ ...previous, pageSize }));
                  }}
                  options={['10', '25', '50'].map((value) => ({ value, label: value }))}
                />
              </label>
            </div>
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={resource.pending || page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </Button>
              <span className="tw:px-1 tw:text-xs tw:tabular-nums tw:text-[#65716a]">
                Page {page} of {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={resource.pending || page * Number(filters.pageSize) >= data.total}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </nav>
        </section>
      )}
      <p className="tw:m-0 tw:text-[11px] tw:leading-relaxed tw:text-[#65716a]">
        Work progress, issues and payment status are independent. Dashboard totals cover all orders,
        independently of these filters.
      </p>
      {preview && (
        <OrderQuickView
          key={preview.id}
          orderId={preview.id}
          onClosed={() => setPreview(null)}
          returnFocus={preview.trigger}
        />
      )}
    </div>
  );
}
