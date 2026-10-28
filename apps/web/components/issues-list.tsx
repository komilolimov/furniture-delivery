'use client';

import type { IssueListResponse, IssueStatus } from '@furniture-delivery/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowUpRight,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Eye,
  MessageSquare,
  Package,
  Paperclip,
  UsersRound,
  UserRound,
} from 'lucide-react';
import { isIssueListResponse } from '../lib/evidence-guards';
import { formatWorkTime } from '../lib/execution-labels';
import { useOrderResource } from '../lib/use-order-resource';
import { IssueFilters, type IssueFilterValue } from './issue-filters';
import {
  IssueStatusBadge,
  IssueTypeIcon,
  issueTypeLabel,
  IssueVisibilityBadge,
} from './issue-presentation';
import { IssueDetail } from './issue-detail';
import { useCurrentUser } from './session-provider';
import { Badge } from './ui/badge';
import { Button, buttonVariants } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import './issues.css';

const cell = 'tw:align-top tw:max-[1000px]:p-0';
const mobileLabel =
  'tw:mb-2 tw:hidden tw:text-[10px] tw:font-semibold tw:tracking-wide tw:text-[#71806a] tw:uppercase tw:max-[1000px]:block';

function IssueDirectory({ initialStatus }: Readonly<{ initialStatus: IssueStatus | '' }>) {
  const [filters, setFilters] = useState<IssueFilterValue>({
    status: initialStatus,
    type: '',
    pageSize: '20',
  });
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<{
    id: string;
    orderId: string;
    trigger: HTMLElement | null;
  } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const query = new URLSearchParams({ page: String(page), pageSize: filters.pageSize });
  if (filters.status) query.set('status', filters.status);
  if (filters.type) query.set('type', filters.type);
  const resource = useOrderResource<IssueListResponse>(`/issues?${query}`, isIssueListResponse, {
    retainDataOnRefresh: true,
  });
  const data = resource.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / Number(filters.pageSize))) : 1;
  const first = data?.issues.length ? (page - 1) * Number(filters.pageSize) + 1 : 0;
  const last = data?.issues.length ? first + data.issues.length - 1 : 0;
  const openOnPage = data?.issues.filter((issue) => issue.status === 'OPEN').length ?? 0;
  useEffect(() => {
    if (!data && !resource.pending) setSelection(null);
  }, [data, resource.pending]);

  return (
    <div className="issues-theme tw:grid tw:min-w-0 tw:gap-6">
      <header className="tw:flex tw:flex-wrap tw:items-end tw:justify-between tw:gap-5">
        <div className="tw:min-w-0">
          <p className="tw:mt-0 tw:mb-3 tw:text-[10px] tw:font-bold tw:tracking-[1.8px] tw:text-[#226347] tw:uppercase">
            Delivery operations
          </p>
          <h1
            ref={heading}
            tabIndex={-1}
            className="tw:m-0 tw:text-[40px] tw:leading-[1.15] tw:font-medium tw:tracking-[-1.5px] tw:max-[600px]:text-[34px]"
          >
            Issues
          </h1>
          <p className="tw:mt-3 tw:mb-0 tw:max-w-[600px] tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
            Keep problems visible, review the evidence and record a clear resolution.
          </p>
        </div>
        <Link
          className={buttonVariants({ variant: 'outline' })}
          href="/backoffice/orders?hasOpenIssues=true"
        >
          <ClipboardList aria-hidden="true" />
          Orders with open issues
          <ArrowUpRight aria-hidden="true" />
        </Link>
      </header>
      <section
        aria-label="Issue overview"
        className="tw:grid tw:grid-cols-3 tw:gap-3 tw:max-[700px]:grid-cols-1"
      >
        {[
          {
            title: 'Matching issues',
            hint: 'Across all filtered pages',
            value: data?.total,
            icon: ClipboardList,
            tone: 'tw:bg-[#e9f1e3] tw:text-[#416744]',
          },
          {
            title: 'Open on this page',
            hint: 'Awaiting a resolution',
            value: data ? openOnPage : undefined,
            icon: CircleAlert,
            tone: 'tw:bg-[#fff1df] tw:text-[#a46b2a]',
          },
          {
            title: 'Resolved on this page',
            hint: 'Saved issue resolutions',
            value: data ? data.issues.length - openOnPage : undefined,
            icon: CheckCheck,
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
              <p className="tw:m-0 tw:text-xs tw:font-medium tw:text-[#65716a]">{title}</p>
              <p className="tw:my-1 tw:text-[26px] tw:leading-tight tw:font-medium tw:tabular-nums">
                {value ?? '—'}
              </p>
              <p className="tw:m-0 tw:text-[11px] tw:leading-relaxed tw:text-[#7a8871]">{hint}</p>
            </div>
          </div>
        ))}
      </section>
      <IssueFilters
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
          {data ? 'Refreshing issues…' : 'Loading issues…'}
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
          aria-label="Issue directory"
          className="tw:min-w-0 tw:overflow-hidden tw:rounded-2xl tw:border tw:border-solid tw:border-[#dce4d5] tw:bg-white"
        >
          <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-x-0 tw:border-t-0 tw:border-b tw:border-solid tw:border-[#e3e9dd] tw:px-5 tw:py-4">
            <div className="tw:flex tw:items-center tw:gap-2.5">
              <h2 className="tw:m-0 tw:text-sm tw:font-semibold">Problem register</h2>
              <Badge variant="outline">{data.total}</Badge>
            </div>
            <p className="tw:m-0 tw:flex tw:items-center tw:gap-1.5 tw:text-[11px] tw:text-[#71806a]">
              <ArrowDownWideNarrow size={14} aria-hidden="true" />
              Newest first
            </p>
          </div>
          {data.issues.length === 0 ? (
            <div className="tw:grid tw:justify-items-center tw:gap-3 tw:px-6 tw:py-14 tw:text-center">
              <span className="tw:flex tw:size-14 tw:items-center tw:justify-center tw:rounded-2xl tw:bg-[#f0f5e9] tw:text-[#6e8a5a]">
                <CheckCheck size={26} aria-hidden="true" />
              </span>
              <h3 className="tw:m-0 tw:text-lg tw:font-medium">No matching issues</h3>
              <p className="tw:m-0 tw:max-w-[380px] tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
                Change the status or type filter. New problems can be recorded from an order.
              </p>
              {(filters.status || filters.type) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setPage(1);
                    setFilters({ ...filters, status: '', type: '' });
                  }}
                >
                  Clear issue filters
                </Button>
              )}
            </div>
          ) : (
            <Table className="issues-directory-table tw:table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="tw:w-[36%]">Problem</TableHead>
                  <TableHead className="tw:w-[15%]">Status & access</TableHead>
                  <TableHead className="tw:w-[17%]">Reported</TableHead>
                  <TableHead className="tw:w-[16%]">Linked material</TableHead>
                  <TableHead className="tw:w-[16%]">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.issues.map((issue) => (
                  <TableRow
                    key={issue.id}
                    className="tw:max-[1000px]:border tw:max-[1000px]:border-solid tw:max-[1000px]:border-[#e1e8d9]"
                  >
                    <TableCell className={cell}>
                      <div className="tw:flex tw:min-w-0 tw:items-start tw:gap-3">
                        <span className="tw:mt-0.5 tw:flex tw:size-10 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-xl tw:bg-[#f6eee4] tw:text-[#9b7245]">
                          <IssueTypeIcon type={issue.type} className="tw:size-5" />
                        </span>
                        <div className="tw:min-w-0">
                          <p className="tw:mt-0 tw:mb-1.5 tw:text-[10px] tw:font-semibold tw:tracking-wide tw:text-[#8f7656] tw:uppercase">
                            {issueTypeLabel(issue.type)}
                          </p>
                          <button
                            type="button"
                            aria-label={`View issue: ${issue.description}`}
                            className="tw:block tw:w-full tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-[13px] tw:leading-relaxed tw:font-semibold tw:text-[#18372e] tw:hover:text-[#39714d] tw:wrap-anywhere"
                            onClick={(event) =>
                              setSelection({
                                id: issue.id,
                                orderId: issue.orderId,
                                trigger: event.currentTarget,
                              })
                            }
                          >
                            <span className="tw:line-clamp-2">{issue.description}</span>
                          </button>
                          <p className="tw:mt-2 tw:mb-0 tw:font-mono tw:text-[10px] tw:text-[#7a8871]">
                            Issue {issue.id.slice(0, 8)}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className={cell}>
                      <span className={mobileLabel}>Status & access</span>
                      <div className="tw:flex tw:flex-wrap tw:gap-2">
                        <IssueStatusBadge status={issue.status} />
                        <IssueVisibilityBadge visibility={issue.visibility} />
                      </div>
                    </TableCell>
                    <TableCell className={cell}>
                      <span className={mobileLabel}>Reported</span>
                      <p className="tw:mt-0 tw:mb-2 tw:flex tw:items-center tw:gap-1.5 tw:text-xs tw:font-medium">
                        {issue.reportedSource === 'CUSTOMER' ? (
                          <UserRound size={14} aria-hidden="true" />
                        ) : (
                          <UsersRound size={14} aria-hidden="true" />
                        )}
                        {issue.reportedSource === 'CUSTOMER' ? 'Customer' : 'Team'}
                      </p>
                      <p className="tw:m-0 tw:text-[11px] tw:leading-relaxed tw:text-[#71806a]">
                        {formatWorkTime(issue.createdAt)}
                      </p>
                    </TableCell>
                    <TableCell className={cell}>
                      <span className={mobileLabel}>Linked material</span>
                      <div className="tw:grid tw:gap-2 tw:text-[11px] tw:text-[#65716a]">
                        <span className="tw:flex tw:items-center tw:gap-1.5">
                          <Package size={14} aria-hidden="true" />
                          {issue.itemIds.length} {issue.itemIds.length === 1 ? 'item' : 'items'}
                        </span>
                        <span className="tw:flex tw:items-center tw:gap-1.5">
                          <Paperclip size={14} aria-hidden="true" />
                          {issue.attachmentIds.length}{' '}
                          {issue.attachmentIds.length === 1 ? 'file' : 'files'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className={cell}>
                      <div className="tw:grid tw:justify-items-start tw:gap-2 tw:max-[1000px]:flex tw:max-[1000px]:flex-wrap tw:max-[1000px]:items-center tw:max-[1000px]:justify-between">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Open details: ${issue.description}`}
                          onClick={(event) =>
                            setSelection({
                              id: issue.id,
                              orderId: issue.orderId,
                              trigger: event.currentTarget,
                            })
                          }
                        >
                          <Eye aria-hidden="true" />
                          Details
                        </Button>
                        <Link
                          className="tw:inline-flex tw:items-center tw:gap-1 tw:text-[11px] tw:font-medium tw:text-[#65716a] tw:no-underline tw:hover:text-[#294b39]"
                          href={`/backoffice/orders/${issue.orderId}#evidence-issue-${issue.id}`}
                        >
                          Open issue in order
                          <ArrowUpRight size={12} aria-hidden="true" />
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <footer className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-4 tw:border-x-0 tw:border-b-0 tw:border-t tw:border-solid tw:border-[#e3e9dd] tw:px-5 tw:py-4">
            <p className="tw:m-0 tw:text-[11px] tw:leading-relaxed tw:text-[#71806a]">
              Showing {first}–{last} of {data.total} issues
            </p>
            <nav
              aria-label="Issue pagination"
              className="tw:flex tw:flex-wrap tw:items-center tw:gap-2"
            >
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || resource.pending}
                onClick={() => setPage((value) => value - 1)}
              >
                <ChevronLeft aria-hidden="true" />
                Previous
              </Button>
              <span className="tw:px-2 tw:text-[11px] tw:text-[#65716a]">
                Page {page} of {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages || resource.pending}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
                <ChevronRight aria-hidden="true" />
              </Button>
            </nav>
          </footer>
        </section>
      )}
      <p className="tw:m-0 tw:flex tw:items-start tw:gap-2 tw:text-[11px] tw:leading-relaxed tw:text-[#71806a]">
        <MessageSquare size={14} className="tw:mt-0.5 tw:shrink-0" aria-hidden="true" />
        Resolving a problem records its outcome. It does not change delivered quantities or close a
        return visit request.
      </p>
      {data && selection && (
        <IssueDetail
          key={`${selection.orderId}/${selection.id}`}
          issueId={selection.id}
          orderId={selection.orderId}
          returnFocus={selection.trigger}
          fallbackFocus={heading.current}
          onClosed={() => setSelection(null)}
          onChanged={() => void resource.refresh()}
        />
      )}
    </div>
  );
}
export function IssuesList({ initialStatus = '' }: Readonly<{ initialStatus?: IssueStatus | '' }>) {
  const user = useCurrentUser();
  if (user.role !== 'ADMIN' && user.role !== 'DISPATCHER')
    return <p role="alert">Access denied. Issues are available to backoffice users.</p>;
  return <IssueDirectory initialStatus={initialStatus} />;
}
