'use client';

import type { ReturnQueueResponse, ReturnRequestStatus } from '@furniture-delivery/contracts';
import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  CornerDownRight,
  Route,
  RotateCcw,
} from 'lucide-react';
import { formatWorkTime } from '../lib/execution-labels';
import { isReturnQueueResponse } from '../lib/return-visit-guards';
import { useOrderResource } from '../lib/use-order-resource';
import { useCurrentUser } from './session-provider';
import { ReturnRequestFilters, type ReturnRequestFilterValue } from './return-request-filters';
import {
  ReturnReadinessBadge,
  ReturnStatusBadge,
  ReturnStatusIcon,
} from './return-request-presentation';
import { Badge } from './ui/badge';
import { Button, buttonVariants } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import './return-request-queue.css';

const cell = 'tw:align-top tw:max-[1100px]:p-0';
const mobileLabel =
  'tw:mb-2 tw:hidden tw:text-[10px] tw:font-semibold tw:tracking-wide tw:text-[#71806a] tw:uppercase tw:max-[1100px]:block';
function RequestQueue({ initialStatus }: Readonly<{ initialStatus: ReturnRequestStatus | '' }>) {
  const [filters, setFilters] = useState<ReturnRequestFilterValue>({
    status: initialStatus,
    pageSize: '20',
  });
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), pageSize: filters.pageSize });
  if (filters.status) query.set('status', filters.status);
  const resource = useOrderResource<ReturnQueueResponse>(
    `/backoffice/return-requests?${query}`,
    isReturnQueueResponse,
    { retainDataOnRefresh: true },
  );
  const data = resource.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / Number(filters.pageSize))) : 1;
  const first = data?.requests.length ? (page - 1) * Number(filters.pageSize) + 1 : 0;
  const last = data?.requests.length ? first + data.requests.length - 1 : 0;
  const openOnPage = data?.requests.filter(({ request }) => request.status === 'OPEN').length ?? 0;
  const reviewOnPage =
    data?.requests.filter(
      ({ request, readyToResolve }) => request.status !== 'RESOLVED' && readyToResolve,
    ).length ?? 0;
  return (
    <div className="return-queue-theme tw:grid tw:min-w-0 tw:gap-6 tw:text-[#18372e]">
      <header className="tw:flex tw:flex-wrap tw:items-end tw:justify-between tw:gap-5">
        <div className="tw:min-w-0">
          <p className="tw:mt-0 tw:mb-3 tw:text-[10px] tw:font-bold tw:tracking-[1.8px] tw:text-[#226347] tw:uppercase">
            Delivery operations
          </p>
          <h1 className="tw:m-0 tw:text-[40px] tw:leading-[1.15] tw:font-medium tw:tracking-[-1.5px] tw:max-[600px]:text-[34px]">
            Return requests
          </h1>
          <p className="tw:mt-3 tw:mb-0 tw:max-w-[620px] tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
            Bring the remaining work back into focus. Plan the next visit and review its result.
          </p>
        </div>
        <Link className={buttonVariants({ variant: 'outline' })} href="/backoffice/planning">
          <CalendarDays aria-hidden="true" />
          Planning calendar
          <ArrowUpRight aria-hidden="true" />
        </Link>
      </header>
      <section
        aria-label="Return request overview"
        className="tw:grid tw:grid-cols-3 tw:gap-3 tw:max-[700px]:grid-cols-1"
      >
        {[
          {
            title: 'Matching requests',
            hint: 'Across all filtered pages',
            value: data?.total,
            icon: Route,
            tone: 'tw:bg-[#e9f1e3] tw:text-[#416744]',
          },
          {
            title: 'Awaiting planning on this page',
            hint: 'Open requests for remaining work',
            value: data ? openOnPage : undefined,
            icon: RotateCcw,
            tone: 'tw:bg-[#fff1df] tw:text-[#a46b2a]',
          },
          {
            title: 'Ready for review on this page',
            hint: 'Server-confirmed follow-up readiness',
            value: data ? reviewOnPage : undefined,
            icon: ClipboardCheck,
            tone: 'tw:bg-[#e5efed] tw:text-[#3c7268]',
          },
        ].map(({ title, hint, value, icon: Icon, tone }) => (
          <div
            key={title}
            className="tw:flex tw:min-w-0 tw:items-center tw:gap-4 tw:rounded-2xl tw:border tw:border-solid tw:border-[#e0e7d9] tw:bg-white tw:p-5"
          >
            <span
              className={`tw:flex tw:size-11 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-xl ${tone}`}
            >
              <Icon size={21} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <div className="tw:min-w-0">
              <p className="tw:m-0 tw:text-xs tw:leading-relaxed tw:font-medium tw:text-[#65716a]">
                {title}
              </p>
              <p className="tw:my-1 tw:text-[26px] tw:leading-tight tw:font-medium tw:tabular-nums">
                {value ?? '—'}
              </p>
              <p className="tw:m-0 tw:text-[11px] tw:leading-relaxed tw:text-[#7a8871]">{hint}</p>
            </div>
          </div>
        ))}
      </section>
      <ReturnRequestFilters
        value={filters}
        onApply={(next) => {
          setPage(1);
          setFilters(next);
        }}
        onRefresh={() => void resource.refresh()}
        refreshing={resource.pending}
      />
      {resource.pending && (
        <p role="status" className="tw:m-0 tw:text-xs tw:text-[#65716a]">
          {data ? 'Refreshing return requests…' : 'Loading return requests…'}
        </p>
      )}
      {!resource.pending && resource.error && (
        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#ead7cf] tw:bg-[#fcf3ee] tw:p-4">
          <p role="alert" className="tw:m-0 tw:text-sm tw:text-[#97372a]">
            {resource.error}
          </p>
          <Button variant="outline" onClick={() => void resource.refresh()}>
            Retry
          </Button>
        </div>
      )}
      {data && (
        <section
          aria-label="Return request directory"
          className="tw:min-w-0 tw:overflow-hidden tw:rounded-2xl tw:border tw:border-solid tw:border-[#dce4d5] tw:bg-white"
        >
          <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-x-0 tw:border-t-0 tw:border-b tw:border-solid tw:border-[#e3e9dd] tw:px-5 tw:py-4">
            <div className="tw:flex tw:items-center tw:gap-2.5">
              <h2 className="tw:m-0 tw:text-sm tw:font-semibold">Follow-up queue</h2>
              <Badge variant="outline">{data.total}</Badge>
            </div>
            <span className="tw:flex tw:items-center tw:gap-1.5 tw:text-[11px] tw:text-[#71806a]">
              <ArrowDownWideNarrow size={14} aria-hidden="true" />
              Oldest first
            </span>
          </div>
          {data.requests.length === 0 ? (
            <div className="tw:grid tw:justify-items-center tw:gap-3 tw:px-6 tw:py-14 tw:text-center">
              <span className="tw:flex tw:size-14 tw:items-center tw:justify-center tw:rounded-2xl tw:bg-[#f0f5e9] tw:text-[#6e8a5a]">
                <Route size={26} aria-hidden="true" />
              </span>
              <h3 className="tw:m-0 tw:text-lg tw:font-medium">No matching return requests</h3>
              <p className="tw:m-0 tw:max-w-[440px] tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
                Change the status filter. A finished partial or blocked team can request a follow-up
                from its order.
              </p>
              {filters.status && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setPage(1);
                    setFilters({ ...filters, status: '' });
                  }}
                >
                  Show all requests
                </Button>
              )}
            </div>
          ) : (
            <Table className="return-queue-table tw:table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="tw:w-[23%]">Order & customer</TableHead>
                  <TableHead className="tw:w-[31%]">Remaining work</TableHead>
                  <TableHead className="tw:w-[20%]">Request status</TableHead>
                  <TableHead className="tw:w-[15%]">Requested</TableHead>
                  <TableHead className="tw:w-[11%]">Next step</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.requests.map(
                  ({
                    request,
                    orderNumber,
                    customerName,
                    currentAppointmentId,
                    readyToResolve,
                  }) => (
                    <TableRow
                      key={request.id}
                      className="tw:max-[1100px]:border tw:max-[1100px]:border-solid tw:max-[1100px]:border-[#e1e8d9]"
                    >
                      <TableCell className={cell}>
                        <div className="tw:flex tw:min-w-0 tw:items-start tw:gap-3">
                          <span className="tw:mt-0.5 tw:flex tw:size-10 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-xl tw:bg-[#edf3e4] tw:text-[#648153]">
                            <ReturnStatusIcon status={request.status} className="tw:size-5" />
                          </span>
                          <div className="tw:min-w-0">
                            <Link
                              aria-label={`${orderNumber} · ${customerName}`}
                              href={`/backoffice/return-requests/${request.id}`}
                              className="tw:grid tw:gap-1.5 tw:no-underline tw:wrap-anywhere"
                            >
                              <span className="tw:text-[10px] tw:font-semibold tw:tracking-wide tw:text-[#6d8065]">
                                {orderNumber}
                              </span>
                              <span className="tw:text-[13px] tw:leading-relaxed tw:font-semibold tw:text-[#18372e] tw:hover:text-[#39714d]">
                                {customerName}
                              </span>
                            </Link>
                            <Link
                              href={`/backoffice/orders/${request.orderId}`}
                              className="tw:mt-2 tw:inline-flex tw:items-center tw:gap-1 tw:text-[11px] tw:font-medium tw:text-[#71806a] tw:no-underline"
                            >
                              Open order
                              <ArrowUpRight size={12} aria-hidden="true" />
                            </Link>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className={cell}>
                        <span className={mobileLabel}>Remaining work</span>
                        <p className="tw:mt-0 tw:mb-2 tw:line-clamp-2 tw:whitespace-pre-wrap tw:text-xs tw:leading-relaxed tw:font-medium tw:wrap-anywhere">
                          {request.remainingWork}
                        </p>
                        <p className="tw:m-0 tw:line-clamp-2 tw:whitespace-pre-wrap tw:text-[11px] tw:leading-relaxed tw:text-[#7a8871] tw:wrap-anywhere">
                          <span className="tw:font-semibold">Reason: </span>
                          {request.reason}
                        </p>
                      </TableCell>
                      <TableCell className={cell}>
                        <span className={mobileLabel}>Request status</span>
                        <div className="tw:flex tw:flex-wrap tw:gap-2">
                          <ReturnStatusBadge status={request.status} />
                          <ReturnReadinessBadge
                            status={request.status}
                            readyToResolve={readyToResolve}
                          />
                        </div>
                        {currentAppointmentId && (
                          <Link
                            href={`/backoffice/planning/orders/${request.orderId}/appointments/${currentAppointmentId}`}
                            className="tw:mt-3 tw:inline-flex tw:items-center tw:gap-1.5 tw:text-[11px] tw:font-medium tw:text-[#58704a] tw:no-underline"
                          >
                            <CalendarDays size={13} aria-hidden="true" />
                            {request.status === 'RESOLVED' ? 'Covering visit' : 'Current follow-up'}
                            <ArrowUpRight size={12} aria-hidden="true" />
                          </Link>
                        )}
                      </TableCell>
                      <TableCell className={cell}>
                        <span className={mobileLabel}>Requested</span>
                        <p className="tw:mt-0 tw:mb-2 tw:flex tw:items-start tw:gap-1.5 tw:text-[11px] tw:leading-relaxed tw:text-[#65716a]">
                          <Clock3 size={13} className="tw:mt-0.5 tw:shrink-0" aria-hidden="true" />
                          {formatWorkTime(request.createdAt)}
                        </p>
                        <p className="tw:m-0 tw:text-[10px] tw:text-[#7a8871]">
                          Revision {request.version}
                        </p>
                      </TableCell>
                      <TableCell className={cell}>
                        <Link
                          aria-label={`View request ${orderNumber}: ${customerName}`}
                          className={buttonVariants({
                            variant: 'outline',
                            size: 'sm',
                            className: 'tw:max-[1100px]:w-full',
                          })}
                          href={`/backoffice/return-requests/${request.id}`}
                        >
                          Details
                          <ArrowUpRight aria-hidden="true" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          )}
          <footer className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-4 tw:border-x-0 tw:border-b-0 tw:border-t tw:border-solid tw:border-[#e3e9dd] tw:px-5 tw:py-4">
            <p className="tw:m-0 tw:text-[11px] tw:leading-relaxed tw:text-[#71806a]">
              Showing {first}–{last} of {data.total} requests
            </p>
            <nav
              aria-label="Request pagination"
              className="tw:flex tw:flex-wrap tw:items-center tw:gap-2"
            >
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || resource.pending}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft aria-hidden="true" />
                Previous requests
              </Button>
              <span className="tw:px-2 tw:text-[11px] tw:text-[#65716a]">
                Page {page} of {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages || resource.pending}
                onClick={() => setPage((p) => p + 1)}
              >
                Next requests
                <ChevronRight aria-hidden="true" />
              </Button>
            </nav>
          </footer>
        </section>
      )}
      <div className="tw:flex tw:items-start tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#e2e7d9] tw:bg-[#f5f8ef] tw:p-4">
        <CornerDownRight
          size={18}
          className="tw:mt-0.5 tw:shrink-0 tw:text-[#6d865a]"
          aria-hidden="true"
        />
        <p className="tw:m-0 tw:text-[11px] tw:leading-relaxed tw:text-[#65716a]">
          Open and planned requests both represent an unresolved need. Planning a visit does not
          close the request; a dispatcher reviews the completed work explicitly.
        </p>
      </div>
    </div>
  );
}
export function ReturnRequestQueue({
  initialStatus = 'OPEN',
}: Readonly<{ initialStatus?: ReturnRequestStatus | '' }>) {
  const user = useCurrentUser();
  if (user.role !== 'ADMIN' && user.role !== 'DISPATCHER')
    return <p role="alert">Access denied. Return requests are available to backoffice users.</p>;
  return <RequestQueue initialStatus={initialStatus} />;
}
