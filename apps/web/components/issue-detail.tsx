'use client';

import type { EvidenceResponse, OrderResponse } from '@furniture-delivery/contracts';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { ArrowUpRight, CalendarDays, ClipboardList, MapPin, ShieldCheck } from 'lucide-react';
import { isEvidenceResponse, isIssueResponse } from '../lib/evidence-guards';
import { isOrderResponse } from '../lib/order-guards';
import { ordersChanged, useOrderResource } from '../lib/use-order-resource';
import { IssueCard } from './evidence-panel';
import { Button, buttonVariants } from './ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';

export function IssueDetail({
  issueId,
  orderId,
  returnFocus,
  fallbackFocus,
  onClosed,
  onChanged,
}: Readonly<{
  issueId: string;
  orderId: string;
  returnFocus: HTMLElement | null;
  fallbackFocus?: HTMLElement | null;
  onClosed: () => void;
  onChanged: () => void;
}>) {
  const base = `/orders/${orderId}`;
  const evidence = useOrderResource<EvidenceResponse>(base + '/evidence', isEvidenceResponse, {
    retainDataOnRefresh: true,
  });
  const order = useOrderResource<OrderResponse>(base, isOrderResponse, {
    retainDataOnRefresh: true,
  });
  const [locks, setLocks] = useState<ReadonlySet<string>>(new Set());
  const busy = locks.size > 0;
  const onLock = useCallback(
    (id: string, locked: boolean) =>
      setLocks((current) => {
        if (current.has(id) === locked) return current;
        const next = new Set(current);
        if (locked) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  const issue = evidence.data?.issues.find((entry) => entry.id === issueId);
  const detail = order.data?.order;
  function changed(result?: unknown) {
    if (isIssueResponse(result))
      evidence.setData((current) =>
        current
          ? {
              ...current,
              issues: current.issues.map((entry) =>
                entry.id === result.issue.id ? result.issue : entry,
              ),
            }
          : current,
      );
    ordersChanged();
    void evidence.refresh();
    onChanged();
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClosed();
      }}
    >
      <SheetContent
        className="issues-theme tw:max-w-[740px]"
        closeLabel="Close issue details"
        closeDisabled={busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus?.isConnected) returnFocus.focus();
          else fallbackFocus?.focus();
        }}
      >
        <SheetHeader>
          <p className="tw:mt-0 tw:mb-1 tw:flex tw:items-center tw:gap-2 tw:text-[10px] tw:font-bold tw:tracking-[1.5px] tw:text-[#7a8871] tw:uppercase">
            <ClipboardList size={14} aria-hidden="true" />
            Problem workspace
          </p>
          <SheetTitle>Issue details</SheetTitle>
          <SheetDescription>
            Review the saved problem, its materials and the resolution history.
          </SheetDescription>
        </SheetHeader>
        {(evidence.pending || order.pending) && (
          <p role="status" className="tw:m-0 tw:text-xs tw:text-[#65716a]">
            {evidence.data && order.data ? 'Refreshing issue details…' : 'Loading issue details…'}
          </p>
        )}
        {(evidence.error || order.error) && (
          <div className="tw:grid tw:justify-items-start tw:gap-3 tw:rounded-xl tw:bg-[#fcf2eb] tw:p-4">
            <p role="alert" className="tw:m-0 tw:text-sm tw:leading-relaxed tw:text-[#97372a]">
              {evidence.error ?? order.error}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void evidence.refresh();
                void order.refresh();
              }}
            >
              Retry issue details
            </Button>
          </div>
        )}
        {evidence.data &&
          detail &&
          (issue ? (
            <>
              <section
                aria-label="Related order"
                className="tw:grid tw:min-w-0 tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#dfe7d6] tw:bg-[#f5f8ef] tw:p-4"
              >
                <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
                  <span className="tw:text-[11px] tw:font-bold tw:tracking-wide tw:text-[#58704a]">
                    {detail.number}
                  </span>
                  {!busy && (
                    <Link
                      className="tw:inline-flex tw:items-center tw:gap-1 tw:text-[11px] tw:font-semibold tw:text-[#466745] tw:no-underline"
                      href={`/backoffice/orders/${orderId}#evidence-issue-${issueId}`}
                    >
                      Open full order
                      <ArrowUpRight size={13} aria-hidden="true" />
                    </Link>
                  )}
                </div>
                <h3 className="tw:m-0 tw:text-lg tw:leading-snug tw:font-medium tw:wrap-anywhere">
                  {detail.customerName}
                </h3>
                <p className="tw:m-0 tw:flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-[#65716a]">
                  <MapPin size={14} className="tw:shrink-0" aria-hidden="true" />
                  {detail.city || 'City not provided'}
                </p>
                {!busy && issue.appointmentId && (
                  <Link
                    className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:font-medium tw:text-[#466745] tw:no-underline"
                    href={`/backoffice/planning/orders/${orderId}/appointments/${issue.appointmentId}`}
                  >
                    <CalendarDays size={14} aria-hidden="true" />
                    Open related visit
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </Link>
                )}
              </section>
              <IssueCard
                key={issue.id}
                issue={issue}
                items={detail.items}
                files={evidence.data.attachments}
                base={base}
                crew={false}
                canAppend
                refresh={changed}
                onLock={onLock}
                attachmentLinkMode="content"
              />
              <p className="tw:m-0 tw:flex tw:items-start tw:gap-2 tw:text-[11px] tw:leading-relaxed tw:text-[#71806a]">
                <ShieldCheck size={15} className="tw:mt-0.5 tw:shrink-0" aria-hidden="true" />
                Files remain protected on every read. Resolving this issue does not change
                quantities, past reports or the need for a return visit.
              </p>
            </>
          ) : (
            <div className="tw:grid tw:justify-items-start tw:gap-3">
              <p role="alert">This issue is no longer available in the order.</p>
              <Button variant="outline" onClick={() => void evidence.refresh()}>
                Retry issue details
              </Button>
            </div>
          ))}
        <div className="tw:mt-auto tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-x-0 tw:border-b-0 tw:border-t tw:border-solid tw:border-[#e1e7da] tw:pt-5">
          <Button variant="outline" disabled={busy} onClick={onClosed}>
            Close details
          </Button>
          {!busy && evidence.data && detail && (
            <Link
              className={buttonVariants({ variant: 'ghost' })}
              href={`/backoffice/orders/${orderId}#evidence-issue-${issueId}`}
            >
              Continue in order
              <ArrowUpRight aria-hidden="true" />
            </Link>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
