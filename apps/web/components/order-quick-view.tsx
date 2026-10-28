'use client';

import type { OrderResponse, PaymentStatus, PlanningProgress } from '@furniture-delivery/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatCents } from '../lib/money';
import { isOrderResponse } from '../lib/order-guards';
import { paymentLabels, progressLabels, serviceLabels } from '../lib/order-labels';
import { useOrderResource } from '../lib/use-order-resource';
import { Badge } from './ui/badge';
import { OrderTeams } from './order-teams';
import { Button, buttonVariants } from './ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';

const progressTone: Record<PlanningProgress, 'secondary' | 'success' | 'warning' | 'destructive'> =
  {
    INBOX: 'secondary',
    PLANNED: 'secondary',
    ASSIGNED: 'secondary',
    IN_PROGRESS: 'success',
    PARTIALLY_COMPLETED: 'warning',
    REQUIRES_ATTENTION: 'destructive',
    AWAITING_REVIEW: 'warning',
    COMPLETED: 'success',
  };
const paymentTone: Record<PaymentStatus, 'secondary' | 'success' | 'warning'> = {
  NOT_REQUIRED: 'secondary',
  UNPAID: 'warning',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
};

function PreviewField({
  label,
  children,
  wide = false,
}: Readonly<{ label: string; children: ReactNode; wide?: boolean }>) {
  return (
    <div className={wide ? 'tw:col-span-full tw:min-w-0' : 'tw:min-w-0'}>
      <dt className="tw:mb-1.5 tw:text-[11px] tw:font-medium tw:text-[#65716a]">{label}</dt>
      <dd className="tw:m-0 tw:text-sm tw:leading-relaxed tw:text-[#18372e] tw:wrap-anywhere">
        {children}
      </dd>
    </div>
  );
}

export function OrderQuickView({
  orderId,
  onClosed,
  returnFocus,
}: Readonly<{
  orderId: string;
  onClosed: () => void;
  returnFocus: HTMLElement | null;
}>) {
  const resource = useOrderResource<OrderResponse>(`/orders/${orderId}`, isOrderResponse, {
    retainDataOnRefresh: true,
  });
  const order = resource.data?.order;
  const items = order?.items.filter((item) => item.active) ?? [];

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClosed();
      }}
    >
      <SheetContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus?.isConnected) returnFocus.focus();
        }}
      >
        <SheetHeader>
          <p className="tw:m-0 tw:text-[10px] tw:font-bold tw:tracking-[1.5px] tw:text-[#65716a] tw:uppercase">
            A closer look
          </p>
          <SheetTitle>Order preview</SheetTitle>
          <SheetDescription>Review the essentials without leaving your list.</SheetDescription>
        </SheetHeader>

        <div className="tw:grid tw:min-w-0 tw:gap-6 tw:pb-1">
          {resource.pending && (
            <p role="status" className="tw:m-0 tw:text-sm tw:text-[#65716a]">
              Loading order…
            </p>
          )}
          {resource.error && (
            <div className="tw:grid tw:justify-items-start tw:gap-3">
              <p
                role="alert"
                className="tw:m-0 tw:w-full tw:rounded-xl tw:bg-[#fff0ed] tw:p-3 tw:text-sm tw:leading-relaxed tw:text-[#97372a] tw:wrap-anywhere"
              >
                {resource.error}
              </p>
              <Button variant="outline" onClick={() => void resource.refresh()}>
                Retry
              </Button>
            </div>
          )}

          {order && (
            <>
              <section aria-label="Customer and order" className="tw:min-w-0">
                <p className="tw:mt-0 tw:mb-2 tw:text-xs tw:font-bold tw:tracking-wide tw:text-[#65716a]">
                  {order.number}
                </p>
                <h3 className="tw:mt-0 tw:mb-2 tw:text-[25px] tw:leading-tight tw:font-medium tw:tracking-[-0.6px] tw:text-[#18372e] tw:wrap-anywhere">
                  {order.customerName}
                </h3>
                <p className="tw:mt-0 tw:mb-4 tw:text-sm tw:leading-relaxed tw:text-[#65716a] tw:wrap-anywhere">
                  {order.city || 'Not provided'} · {serviceLabels[order.serviceType]}
                </p>
                <div className="tw:flex tw:flex-wrap tw:gap-2">
                  <Badge variant={progressTone[order.progress]}>
                    {progressLabels[order.progress]}
                  </Badge>
                  <Badge variant={paymentTone[order.paymentStatus]}>
                    {paymentLabels[order.paymentStatus]}
                  </Badge>
                </div>
              </section>

              <section aria-label="Assigned teams">
                <h3 className="tw:mt-0 tw:mb-3 tw:text-sm tw:font-semibold">Teams across visits</h3>
                <OrderTeams crews={order.assignedCrews} />
              </section>
              <section
                aria-labelledby={`preview-payment-${orderId}`}
                className="tw:rounded-xl tw:border tw:border-solid tw:border-[#dfe5da] tw:bg-[#f7f9f3] tw:p-4"
              >
                <h3
                  id={`preview-payment-${orderId}`}
                  className="tw:mt-0 tw:mb-4 tw:text-xs tw:font-bold tw:text-[#18372e]"
                >
                  Payment overview
                </h3>
                <dl className="tw:m-0 tw:grid tw:grid-cols-3 tw:gap-3 tw:max-[380px]:grid-cols-1">
                  <PreviewField label="Order total">
                    <strong className="tw:font-semibold tw:tabular-nums">
                      {formatCents(order.orderTotalCents)}
                    </strong>
                  </PreviewField>
                  <PreviewField label="Recorded payments">
                    <span className="tw:tabular-nums">{formatCents(order.paidCents)}</span>
                  </PreviewField>
                  <PreviewField label="Outstanding balance">
                    <strong className="tw:font-semibold tw:tabular-nums">
                      {formatCents(order.balanceCents)}
                    </strong>
                  </PreviewField>
                </dl>
                <p className="tw:mt-3 tw:mb-0 tw:text-[11px] tw:leading-relaxed tw:text-[#65716a]">
                  Payment status and physical completion are independent.
                </p>
              </section>

              {(order.openIssueCount > 0 ||
                order.returnVisitRequired ||
                order.workReadyForReview) && (
                <section aria-label="Order attention" className="tw:flex tw:flex-wrap tw:gap-2">
                  {order.openIssueCount > 0 && (
                    <Badge variant="destructive">
                      {order.openIssueCount} open {order.openIssueCount === 1 ? 'issue' : 'issues'}
                    </Badge>
                  )}
                  {order.returnVisitRequired && (
                    <Badge variant="warning">Return visit required</Badge>
                  )}
                  {order.workReadyForReview && (
                    <Badge variant="secondary">Work ready for review</Badge>
                  )}
                </section>
              )}

              <section aria-labelledby={`preview-contact-${orderId}`}>
                <h3
                  id={`preview-contact-${orderId}`}
                  className="tw:mt-0 tw:mb-4 tw:text-sm tw:font-bold tw:text-[#18372e]"
                >
                  Delivery and contact
                </h3>
                <dl className="tw:m-0 tw:grid tw:grid-cols-2 tw:gap-4 tw:max-[380px]:grid-cols-1">
                  <PreviewField label="Address" wide>
                    {order.address || 'Not provided'}
                    <br />
                    {[order.postalCode, order.city, order.country].filter(Boolean).join(', ') ||
                      'Not provided'}
                  </PreviewField>
                  <PreviewField label="Contact person">
                    {order.contactName || 'Not provided'}
                  </PreviewField>
                  <PreviewField label="Phone">
                    {order.phoneNumbers.filter(Boolean).join(', ') || 'Not provided'}
                  </PreviewField>
                  <PreviewField label="Email" wide>
                    {order.email || 'Not provided'}
                  </PreviewField>
                </dl>
              </section>

              <section aria-labelledby={`preview-work-${orderId}`}>
                <h3
                  id={`preview-work-${orderId}`}
                  className="tw:mt-0 tw:mb-3 tw:text-sm tw:font-bold tw:text-[#18372e]"
                >
                  Work description
                </h3>
                <p className="tw:m-0 tw:whitespace-pre-wrap tw:text-sm tw:leading-relaxed tw:text-[#52634f] tw:wrap-anywhere">
                  {order.workDescription || 'Not provided'}
                </p>
              </section>

              <section aria-labelledby={`preview-items-${orderId}`}>
                <div className="tw:mb-3 tw:flex tw:items-baseline tw:justify-between tw:gap-3">
                  <h3
                    id={`preview-items-${orderId}`}
                    className="tw:m-0 tw:text-sm tw:font-bold tw:text-[#18372e]"
                  >
                    Items
                  </h3>
                  <span className="tw:text-xs tw:text-[#65716a]">
                    {items.length} active {items.length === 1 ? 'item' : 'items'}
                  </span>
                </div>
                {items.length === 0 ? (
                  <p className="tw:m-0 tw:text-sm tw:text-[#65716a]">No active items.</p>
                ) : (
                  <ul className="tw:m-0 tw:grid tw:list-none tw:gap-3 tw:p-0">
                    {items.map((item) => (
                      <li
                        key={item.id}
                        className="tw:min-w-0 tw:rounded-xl tw:border tw:border-solid tw:border-[#e1e5dc] tw:bg-white tw:p-4"
                      >
                        <p className="tw:mt-0 tw:mb-3 tw:text-sm tw:leading-relaxed tw:font-medium tw:text-[#18372e] tw:wrap-anywhere">
                          {item.description}
                        </p>
                        <dl className="tw:m-0 tw:flex tw:flex-wrap tw:gap-x-5 tw:gap-y-3">
                          <PreviewField label="Ordered">{item.quantity}</PreviewField>
                          <PreviewField label="Delivered">{item.deliveredQuantity}</PreviewField>
                          <PreviewField label="Assembled">
                            {item.requiresAssembly ? item.assembledQuantity : 'Not required'}
                          </PreviewField>
                        </dl>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="tw:grid tw:gap-3 tw:border-x-0 tw:border-b-0 tw:border-t tw:border-solid tw:border-[#e1e5dc] tw:pt-5">
                <Link
                  className={buttonVariants({ className: 'tw:w-full' })}
                  href={`/backoffice/orders/${orderId}`}
                >
                  Open full order
                </Link>
                <p className="tw:m-0 tw:text-center tw:text-[11px] tw:leading-relaxed tw:text-[#65716a]">
                  Open the full order to edit details, plan visits or record payments.
                </p>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
