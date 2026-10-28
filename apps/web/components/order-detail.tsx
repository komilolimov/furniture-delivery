'use client';

import type { OrderDetail, OrderResponse } from '@furniture-delivery/contracts';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  ClipboardCheck,
  Clock,
  FolderOpen,
  History,
  LayoutDashboard,
  MapPin,
  Package,
  Pencil,
  RefreshCw,
  Users,
  Wallet,
} from 'lucide-react';
import { isOrderResponse } from '../lib/order-guards';
import { formatCents } from '../lib/money';
import { paymentLabels, serviceLabels, progressLabels } from '../lib/order-labels';
import { useOrderResource } from '../lib/use-order-resource';
import { ResourceNotice } from './form-parts';
import { OrderForm } from './order-form';
import { PaymentJournal } from './payment-journal';
import { OrderAppointments } from './order-appointments';
import { BackofficeExecutionPanel } from './backoffice-execution-panel';
import { EvidencePanel } from './evidence-panel';
import { CompletionPanel } from './completion-panel';
import { Badge } from './ui/badge';
import { Button, buttonVariants } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import './orders-detail.css';

const card =
  'tw:min-w-0 tw:rounded-2xl tw:border tw:border-solid tw:border-[#e0e5da] tw:bg-[#fffefa] tw:p-6 tw:max-[600px]:p-4';
const sectionTitle = 'tw:m-0 tw:text-base tw:leading-snug tw:font-semibold tw:tracking-[-0.3px]';
const copy = 'tw:m-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]';
const tabDefinitions = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'visits', label: 'Visits', icon: CalendarDays },
  { value: 'execution', label: 'Execution', icon: ClipboardCheck },
  { value: 'files', label: 'Files', icon: FolderOpen },
  { value: 'payments', label: 'Payments', icon: Wallet },
  { value: 'history', label: 'History', icon: History },
] as const;
type OrderTab = (typeof tabDefinitions)[number]['value'];
const accessValue = (value: boolean | null) =>
  value === null ? 'Unknown / not confirmed' : value ? 'Yes' : 'No';
const timestamp = (value: string) =>
  new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/Rome' });
const readableKey = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
function changeValue(value: unknown): string {
  if (value === null) return 'Not specified';
  if (typeof value === 'string') return value || 'Empty';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}
function Fact({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="tw:min-w-0">
      <dt className="tw:mb-1.5 tw:text-[11px] tw:font-medium tw:text-[#65716a]">{label}</dt>
      <dd className="tw:m-0 tw:text-sm tw:leading-relaxed tw:whitespace-pre-wrap tw:wrap-anywhere">
        {children}
      </dd>
    </div>
  );
}

export function OrderDetailScreen({ orderId }: Readonly<{ orderId: string }>) {
  const resource = useOrderResource<OrderResponse>(`/orders/${orderId}`, isOrderResponse, {
    retainDataOnRefresh: true,
  });
  // A draft keeps the revision it started from, even while another operation completes.
  const [editingOrder, setEditingOrder] = useState<OrderDetail | null>(null);
  const [activeTab, setActiveTab] = useState<OrderTab>('overview');
  const editing = editingOrder !== null;
  const order = resource.data?.order;
  const items = order?.items.filter((item) => item.active) ?? [];

  return (
    <div className="orders-detail-theme tw:grid tw:min-w-0 tw:gap-6 tw:text-[#18372e]">
      <nav aria-label="Order breadcrumb" className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Link
          className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'tw:-ml-3' })}
          href="/backoffice/orders"
        >
          <ArrowLeft aria-hidden="true" /> All orders
        </Link>
        {order && <span className="tw:text-xs tw:text-[#65716a]">/ {order.number}</span>}
      </nav>
      <ResourceNotice
        pending={resource.pending}
        error={resource.error}
        retry={() => void resource.refresh()}
      />
      {order && (
        <>
          <header className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-5">
            <div className="tw:min-w-0 tw:flex-1">
              <p className="tw:mt-0 tw:mb-3 tw:text-[10px] tw:font-bold tw:tracking-[1.7px] tw:text-[#226347] tw:uppercase">
                Order {order.number}
              </p>
              <h1 className="tw:m-0 tw:text-[36px] tw:leading-tight tw:font-medium tw:tracking-[-1.2px] tw:wrap-anywhere tw:max-[600px]:text-[29px]">
                {order.customerName}
              </h1>
              <p className="tw:mt-3 tw:mb-0 tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
                <MapPin className="tw:size-3.5 tw:shrink-0" aria-hidden="true" />
                {order.city} · {serviceLabels[order.serviceType]}
              </p>
              <div className="tw:mt-4 tw:flex tw:flex-wrap tw:gap-2">
                <Badge
                  variant={
                    order.progress === 'COMPLETED'
                      ? 'success'
                      : order.progress === 'REQUIRES_ATTENTION'
                        ? 'destructive'
                        : 'secondary'
                  }
                >
                  {progressLabels[order.progress]}
                </Badge>
                <Badge variant={order.paymentStatus === 'PAID' ? 'success' : 'outline'}>
                  {paymentLabels[order.paymentStatus]}
                </Badge>
                {order.openIssueCount > 0 && (
                  <Badge variant="destructive">
                    {order.openIssueCount} open {order.openIssueCount === 1 ? 'issue' : 'issues'}
                  </Badge>
                )}
                {order.returnVisitRequired && (
                  <Badge variant="warning">Return visit required</Badge>
                )}
              </div>
            </div>
            <div className="tw:flex tw:flex-wrap tw:gap-2">
              <Button
                variant="outline"
                disabled={resource.pending}
                onClick={() => void resource.refresh()}
              >
                <RefreshCw aria-hidden="true" />
                Refresh order
              </Button>
              <Button
                onClick={() => {
                  setActiveTab('overview');
                  setEditingOrder((value) => (value ? null : order));
                }}
              >
                <Pencil aria-hidden="true" />
                {editing ? 'Cancel editing' : 'Edit order'}
              </Button>
            </div>
          </header>

          <div className="tw:grid tw:min-w-0 tw:grid-cols-4 tw:gap-3 tw:max-[850px]:grid-cols-2">
            {[
              ['Order total', formatCents(order.orderTotalCents)],
              ['Recorded payments', formatCents(order.paidCents)],
              ['Balance', formatCents(order.balanceCents)],
              ['Payment status', paymentLabels[order.paymentStatus]],
            ].map(([label, value]) => (
              <div key={label} className={`${card} tw:p-4`}>
                <span className="tw:block tw:text-[11px] tw:text-[#65716a]">{label}</span>
                <strong className="tw:mt-2 tw:block tw:text-[21px] tw:leading-snug tw:font-medium tw:tracking-[-0.5px] tw:tabular-nums tw:wrap-anywhere">
                  {value}
                </strong>
              </div>
            ))}
          </div>

          {editing && (
            <p className="tw:m-0 tw:rounded-xl tw:border tw:border-solid tw:border-[#e8dfc7] tw:bg-[#fcf6e8] tw:p-4 tw:text-xs tw:leading-relaxed tw:text-[#856328]">
              Save or cancel order edits before recording or voiding payments.
            </p>
          )}

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as OrderTab)}
            className="tw:min-w-0"
          >
            <TabsList
              aria-label="Order sections"
              className="tw:mb-6 tw:flex tw:h-auto tw:w-full tw:flex-wrap tw:justify-start tw:gap-1"
            >
              {tabDefinitions.map(({ value, label, icon: Icon }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  disabled={editing && (value === 'visits' || value === 'payments')}
                  className="tw:min-h-11 tw:gap-2"
                >
                  <Icon className="tw:size-4 tw:shrink-0" aria-hidden="true" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent
              value="overview"
              forceMount
              hidden={activeTab !== 'overview'}
              className="tw:data-[state=inactive]:hidden"
            >
              {editingOrder ? (
                <section className={card} aria-label="Edit order details">
                  <div className="tw:mb-5">
                    <h2 className={sectionTitle}>Edit order details</h2>
                    <p className={`${copy} tw:mt-2`}>
                      Update customer details, items and the agreed price together.
                    </p>
                  </div>
                  <OrderForm
                    key={editingOrder.version}
                    order={editingOrder}
                    onSaved={(saved) => {
                      resource.setData({ order: saved });
                      setEditingOrder(null);
                    }}
                    onReload={() => {
                      setEditingOrder(null);
                      void resource.refresh();
                    }}
                  />
                </section>
              ) : (
                <div className="tw:grid tw:min-w-0 tw:gap-5">
                  <div className="tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] tw:gap-5 tw:max-[850px]:grid-cols-1">
                    <section className={card} aria-labelledby="order-details-title">
                      <h2 id="order-details-title" className={sectionTitle}>
                        Order details
                      </h2>
                      <dl className="tw:mt-5 tw:mb-0 tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-x-6 tw:gap-y-5 tw:max-[600px]:grid-cols-1">
                        <Fact label="Contact">
                          {order.contactName || 'Not specified'}
                          <br />
                          {order.phoneNumbers.join(' · ') || 'No phone number'}
                          <br />
                          {order.email || 'No email'}
                        </Fact>
                        <Fact label="Address">
                          {order.address}
                          <br />
                          {[order.postalCode, order.city].filter(Boolean).join(' ')}
                          <br />
                          {order.country}
                        </Fact>
                        <Fact label="Work">
                          {order.workDescription || 'Not specified'}
                          <span className="tw:mt-2 tw:flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-[#65716a]">
                            <Clock className="tw:size-3.5 tw:shrink-0" aria-hidden="true" />
                            Estimated duration: {order.estimatedDurationMinutes} minutes
                          </span>
                        </Fact>
                        <Fact label="Access">
                          Floor: {order.floor || 'Unknown'}
                          <br />
                          Elevator: {accessValue(order.hasElevator)}
                          <br />
                          Easy access: {accessValue(order.easyAccess)}
                          <br />
                          Parking: {accessValue(order.parkingAvailable)}
                        </Fact>
                        <Fact label="Access restrictions">
                          {order.accessRestrictions || 'Not specified'}
                        </Fact>
                        <Fact label="Access notes">{order.accessNotes || 'Not specified'}</Fact>
                      </dl>
                    </section>
                    <div className="tw:grid tw:min-w-0 tw:content-start tw:gap-5">
                      <section className={card} aria-labelledby="order-teams-title">
                        <div className="tw:mb-3 tw:flex tw:items-center tw:gap-2">
                          <Users
                            className="tw:size-4 tw:shrink-0 tw:text-[#55734e]"
                            aria-hidden="true"
                          />
                          <h2 id="order-teams-title" className={sectionTitle}>
                            Assigned teams
                          </h2>
                        </div>
                        {(order.assignedCrews ?? []).length === 0 ? (
                          <p className={copy}>Not assigned. Plan a visit and choose its teams.</p>
                        ) : (
                          <ul className="tw:m-0 tw:grid tw:list-none tw:gap-2 tw:p-0">
                            {order.assignedCrews.map((crew) => (
                              <li
                                key={crew.id}
                                className="tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-3 tw:rounded-lg tw:bg-[#f1f5ec] tw:px-3 tw:py-3"
                              >
                                <span className="tw:text-sm tw:font-medium tw:wrap-anywhere">
                                  {crew.name}
                                </span>
                                <span className="tw:shrink-0 tw:text-[10px] tw:font-semibold tw:text-[#65716a]">
                                  {crew.code}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className={`${copy} tw:mt-3`}>
                          Teams from this order’s non-cancelled visits. One order can have several
                          teams.
                        </p>
                        <Button
                          variant="outline"
                          className="tw:mt-4 tw:w-full"
                          disabled={editing}
                          onClick={() => setActiveTab('visits')}
                        >
                          <CalendarDays aria-hidden="true" />
                          View visits
                        </Button>
                      </section>
                      <section className={card} aria-labelledby="order-notes-title">
                        <h2 id="order-notes-title" className={sectionTitle}>
                          Notes
                        </h2>
                        <dl className="tw:mt-5 tw:mb-0 tw:grid tw:gap-5">
                          <Fact label="Internal dispatcher notes">
                            {order.internalNotes || 'None'}
                          </Fact>
                          <Fact label="Notes for the crew">{order.crewNotes || 'None'}</Fact>
                        </dl>
                      </section>
                    </div>
                  </div>
                  <section className={card} aria-labelledby="order-items-title">
                    <div className="tw:mb-4 tw:flex tw:items-center tw:justify-between tw:gap-3">
                      <div className="tw:flex tw:items-center tw:gap-2">
                        <Package
                          className="tw:size-4 tw:shrink-0 tw:text-[#55734e]"
                          aria-hidden="true"
                        />
                        <h2 id="order-items-title" className={sectionTitle}>
                          Items
                        </h2>
                      </div>
                      <span className="tw:text-xs tw:text-[#65716a]">
                        {items.length} active {items.length === 1 ? 'item' : 'items'}
                      </span>
                    </div>
                    {items.length === 0 ? (
                      <p className={copy}>No active items.</p>
                    ) : (
                      <Table aria-label="Order items">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item / room</TableHead>
                            <TableHead className="tw:text-right">Ordered</TableHead>
                            <TableHead className="tw:text-right">Delivered</TableHead>
                            <TableHead className="tw:text-right">Assembled</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {items.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>
                                <strong className="tw:block tw:font-semibold">
                                  {item.description}
                                </strong>
                                <span className="tw:mt-1 tw:block tw:text-xs tw:text-[#65716a]">
                                  {item.configuration || 'No configuration'} ·{' '}
                                  {item.ambient || 'Room not specified'}
                                </span>
                                {item.notes && (
                                  <p className={`${copy} tw:mt-2 tw:whitespace-pre-wrap`}>
                                    {item.notes}
                                  </p>
                                )}
                                <span className="tw:mt-2 tw:block">
                                  <Badge variant="outline">
                                    {item.requiresAssembly ? 'Assembly required' : 'Delivery'}
                                  </Badge>
                                </span>
                              </TableCell>
                              <TableCell className="tw:text-right tw:tabular-nums">
                                {item.quantity}
                              </TableCell>
                              <TableCell className="tw:text-right tw:tabular-nums">
                                {item.deliveredQuantity} / {item.quantity}
                              </TableCell>
                              <TableCell className="tw:text-right tw:tabular-nums">
                                {item.requiresAssembly
                                  ? `${item.assembledQuantity} / ${item.quantity}`
                                  : 'Not required'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </section>
                  <p className="tw:m-0 tw:text-[11px] tw:leading-relaxed tw:text-[#65716a]">
                    Revision {order.version} · Created {timestamp(order.createdAt)} · Updated{' '}
                    {timestamp(order.updatedAt)} · Europe/Rome
                  </p>
                </div>
              )}
            </TabsContent>

            {/* Keep every workflow mounted so tabs never discard drafts, operation keys or drawings. */}
            <TabsContent
              value="visits"
              forceMount
              hidden={activeTab !== 'visits'}
              className="tw:data-[state=inactive]:hidden"
            >
              <div hidden={editing}>
                <OrderAppointments
                  order={order}
                  onSaved={(saved) => resource.setData({ order: saved })}
                />
              </div>
            </TabsContent>
            <TabsContent
              value="execution"
              forceMount
              hidden={activeTab !== 'execution'}
              className="tw:data-[state=inactive]:hidden"
            >
              <BackofficeExecutionPanel order={order} onRefresh={resource.refresh} />
              <CompletionPanel orderId={order.id} onChanged={() => void resource.refresh()} />
            </TabsContent>
            <TabsContent
              value="files"
              forceMount
              hidden={activeTab !== 'files'}
              className="tw:data-[state=inactive]:hidden"
            >
              <EvidencePanel
                scope={{ orderId: order.id }}
                items={order.items}
                onChanged={() => void resource.refresh()}
              />
            </TabsContent>
            <TabsContent
              value="payments"
              forceMount
              hidden={activeTab !== 'payments'}
              className="tw:data-[state=inactive]:hidden"
            >
              <div hidden={editing}>
                <PaymentJournal
                  order={order}
                  onSaved={(saved) => resource.setData({ order: saved })}
                />
              </div>
            </TabsContent>
            <TabsContent
              value="history"
              forceMount
              hidden={activeTab !== 'history'}
              className="tw:data-[state=inactive]:hidden"
            >
              <section className={card} aria-labelledby="order-history-title">
                <h2 id="order-history-title" className={sectionTitle}>
                  History
                </h2>
                <p className={`${copy} tw:mt-2`}>
                  Successful changes only. Times shown in Europe/Rome.
                </p>
                {order.activity.length === 0 ? (
                  <p className={`${copy} tw:mt-5`}>No history yet.</p>
                ) : (
                  <ol className="tw:mt-5 tw:mb-0 tw:grid tw:list-none tw:gap-0 tw:p-0">
                    {order.activity.map((entry) => (
                      <li
                        key={entry.id}
                        className="tw:relative tw:min-w-0 tw:border-x-0 tw:border-t-0 tw:border-b tw:border-solid tw:border-[#e8ece3] tw:py-5 tw:first:pt-0 tw:last:border-b-0 tw:last:pb-0"
                      >
                        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
                          <strong className="tw:text-sm tw:font-semibold">
                            {readableKey(entry.action.toLowerCase())}
                          </strong>
                          <time className="tw:text-xs tw:text-[#65716a]" dateTime={entry.createdAt}>
                            {timestamp(entry.createdAt)}
                          </time>
                        </div>
                        <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-[#65716a]">
                          Author:{' '}
                          <span className="tw:font-mono tw:wrap-anywhere">{entry.actorId}</span>
                        </p>
                        {entry.reason && (
                          <p className="tw:mt-3 tw:mb-0 tw:whitespace-pre-wrap tw:text-sm tw:leading-relaxed tw:wrap-anywhere">
                            Reason: {entry.reason}
                          </p>
                        )}
                        {Object.keys(entry.changes).length > 0 && (
                          <details className="tw:mt-3">
                            <summary className="tw:cursor-pointer tw:text-xs tw:font-semibold tw:text-[#38634a]">
                              View changes
                            </summary>
                            <dl className="tw:mt-3 tw:mb-0 tw:grid tw:gap-3 tw:rounded-xl tw:bg-[#f5f7f0] tw:p-4">
                              {Object.entries(entry.changes).map(([key, value]) => (
                                <Fact key={key} label={readableKey(key)}>
                                  {changeValue(value)}
                                </Fact>
                              ))}
                            </dl>
                          </details>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
