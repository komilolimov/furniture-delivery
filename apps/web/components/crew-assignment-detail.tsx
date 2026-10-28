'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  CrewAssignmentDetail,
  CrewAssignmentResponse,
  CrewWorkItem,
  CrewWorkTask,
} from '@furniture-delivery/contracts';
import {
  ArrowLeft,
  CalendarDays,
  CheckCheck,
  CircleAlert,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  DoorOpen,
  FileCheck2,
  Flag,
  ListChecks,
  Mail,
  MapPin,
  Package,
  ParkingCircle,
  Pencil,
  Phone,
  RefreshCw,
  Route,
  ShieldCheck,
  Truck,
  UsersRound,
  Wrench,
} from 'lucide-react';
import { isCrewAssignmentResponse } from '../lib/execution-guards';
import { executionStatusLabel, formatWorkTime } from '../lib/execution-labels';
import { ordersChanged, useOrderResource } from '../lib/use-order-resource';
import { ResourceNotice } from './form-parts';
import { EvidencePanel } from './evidence-panel';
import { VisitAcceptancePanel } from './acceptance-panel';
import { AssignmentEstimate } from './assignment-estimate';
import { CrewReturnSummary } from './crew-return-context';
import {
  CrewExecutionBadge,
  CrewExecutionIcon,
  CrewConfirmationBadge,
} from './crew-work-presentation';
import {
  ExecutionActions,
  FinishWorkForm,
  FulfillmentForm,
  TaskResultForm,
} from './crew-execution-forms';
import { Badge } from './ui/badge';
import { Button, buttonVariants } from './ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import './crew-execution.css';
import './crew-visit.css';

type Editor =
  | { kind: 'task'; task: CrewWorkTask }
  | { kind: 'item'; item: CrewWorkItem }
  | { kind: 'finish'; assignment: CrewAssignmentDetail };

export function CrewAssignmentDetailView({ assignmentId }: Readonly<{ assignmentId: string }>) {
  return <AssignmentWork key={assignmentId} assignmentId={assignmentId} />;
}
function AssignmentWork({ assignmentId }: Readonly<{ assignmentId: string }>) {
  const resource = useOrderResource<CrewAssignmentResponse>(
    `/crew/assignments/${assignmentId}`,
    isCrewAssignmentResponse,
    { retainDataOnRefresh: true },
  );
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [stepBusy, setStepBusy] = useState(false),
    [evidenceBusy, setEvidenceBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const backLink = useRef<HTMLAnchorElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const stepBusyChanged = useCallback((busy: boolean) => {
    setStepBusy(busy);
    if (busy) setNotice(null);
  }, []);
  const openEditor = (next: Editor, trigger: HTMLElement) => {
    setNotice(null);
    returnFocus.current = trigger;
    setEditor(next);
  };
  const a = resource.data?.assignment;
  const reload = () => {
    void resource.refresh();
  };
  const saved = (response: CrewAssignmentResponse) => {
    resource.setData(response);
    setEditor(null);
    setEditorBusy(false);
    setNotice('Saved. The result below was read from the server.');
    ordersChanged();
  };
  const close = () => {
    if (!editorBusy) setEditor(null);
  };
  useEffect(() => {
    if (!resource.data && !resource.pending) {
      setEditor(null);
      setEditorBusy(false);
      setNotice(null);
    }
  }, [resource.data, resource.pending]);
  const section = (name: string) => `crew-${assignmentId}-${name}`;
  const editorTitle =
    editor?.kind === 'finish'
      ? "Finish my team's visit"
      : editor?.kind === 'task'
        ? 'Update checklist task'
        : 'Update order quantities';
  return (
    <div className="crew-assignment crew-visit-theme">
      <Link ref={backLink} className="crew-visit-back" href="/crew">
        <ArrowLeft size={16} aria-hidden="true" />
        My team's work
      </Link>
      {!editor && (
        <ResourceNotice pending={resource.pending} error={resource.error} retry={reload} />
      )}
      {a && (
        <>
          <header className="crew-visit-heading">
            <div className="tw:min-w-0">
              <p className="crew-visit-eyebrow">
                {a.orderNumber} <span aria-hidden="true">·</span> {a.crewName}
              </p>
              <h1>{a.customerName}</h1>
              <p className="crew-visit-location">
                <MapPin size={15} aria-hidden="true" />
                {a.city} <span aria-hidden="true">·</span>{' '}
                {a.serviceType === 'DELIVERY_ONLY' ? 'Delivery' : 'Delivery and assembly'}
              </p>
            </div>
            <Button
              ref={refreshButton}
              variant="outline"
              disabled={resource.pending}
              onClick={reload}
            >
              <RefreshCw aria-hidden="true" />
              Refresh assignment
            </Button>
          </header>
          {notice && (
            <p className="form-success" role="status">
              <CheckCheck size={17} aria-hidden="true" />
              {notice}
            </p>
          )}
          <nav className="crew-visit-nav" aria-label="Visit sections">
            {[
              { key: 'execution', text: 'Visit', icon: Route },
              { key: 'contact', text: 'Contact', icon: Phone },
              { key: 'items', text: 'Furniture', icon: Package },
              { key: 'checklist', text: 'Checklist', icon: ListChecks },
              { key: 'result', text: 'Result', icon: FileCheck2 },
              { key: 'materials', text: 'Photos & notes', icon: ClipboardList },
            ].map(({ key, text, icon: Icon }) => (
              <a key={key} href={`#${section(key)}`}>
                <Icon size={16} aria-hidden="true" />
                {text}
              </a>
            ))}
          </nav>
          <section
            className="crew-visit-card"
            id={section('execution')}
            aria-label="Visit execution"
          >
            <div className="crew-visit-card-heading">
              <div className="crew-visit-title">
                <span className="crew-visit-symbol">
                  <CrewExecutionIcon status={a.execution.status} className="tw:size-6" />
                </span>
                <div>
                  <p className="crew-visit-eyebrow">Your team's visit</p>
                  <h2>{executionStatusLabel(a.execution.status)}</h2>
                </div>
              </div>
              <CrewExecutionBadge status={a.execution.status} />
            </div>
            <div className="crew-visit-badges">
              <CrewConfirmationBadge status={a.confirmationStatus} />
              <Badge variant={a.openIssueCount ? 'warning' : 'outline'}>
                <CircleAlert size={13} aria-hidden="true" />
                {a.openIssueCount} visible open issues
              </Badge>
              {a.returnVisitRequired && (
                <Badge variant="warning">
                  <Route size={13} aria-hidden="true" />
                  Another visit has been requested
                </Badge>
              )}
            </div>
            <div className="crew-visit-planned">
              <h3>
                <CalendarDays size={16} aria-hidden="true" />
                Planned window · Europe/Rome
              </h3>
              <dl className="work-facts">
                <div>
                  <dt>Planned start</dt>
                  <dd>{formatWorkTime(a.plannedStartAt)}</dd>
                </div>
                <div>
                  <dt>Planned end</dt>
                  <dd>{formatWorkTime(a.plannedEndAt)}</dd>
                </div>
              </dl>
            </div>
            <div className="crew-visit-actual">
              <h3>
                <Clock3 size={16} aria-hidden="true" />
                Actual progress
              </h3>
              <dl className="work-facts">
                {[
                  { label: 'Departed', value: a.execution.departedAt, icon: Truck },
                  { label: 'Arrived', value: a.execution.arrivedAt, icon: MapPin },
                  { label: 'Work started', value: a.execution.actualStartAt, icon: Wrench },
                  { label: 'Actual finish', value: a.execution.actualEndAt, icon: CheckCheck },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label}>
                    <dt>
                      <Icon size={14} aria-hidden="true" />
                      {label}
                    </dt>
                    <dd>{formatWorkTime(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <AssignmentEstimate
              assignmentId={a.id}
              execution={a.execution}
              mode="crew"
              onSaved={reload}
              disabled={!!editor || evidenceBusy || stepBusy}
            />
            {a.returnContext && <CrewReturnSummary context={a.returnContext} />}
            {a.execution.maybeDelayed && (
              <p className="conflict-notice">
                Possibly delayed: no finish recorded. Record the actual result; the planned window
                stays unchanged.
              </p>
            )}
            <div className="crew-visit-actions">
              <ExecutionActions
                assignment={a}
                onSaved={saved}
                disabled={!!editor || evidenceBusy}
                onBusyChange={stepBusyChanged}
                onReload={reload}
              />
              {a.allowedActions.includes('FINISH') && editor?.kind !== 'finish' && (
                <Button
                  disabled={!!editor || stepBusy || evidenceBusy}
                  onClick={(event) =>
                    openEditor(
                      { kind: 'finish', assignment: structuredClone(a) },
                      event.currentTarget,
                    )
                  }
                >
                  <ClipboardCheck aria-hidden="true" />
                  Finish my team's visit
                </Button>
              )}
            </div>
          </section>
          <section
            className="crew-visit-card"
            id={section('contact')}
            aria-label="Customer and access"
          >
            <h2 className="crew-visit-section-title">
              <DoorOpen size={20} aria-hidden="true" />
              Contact and access
            </h2>
            <div className="crew-visit-address">
              <MapPin size={20} aria-hidden="true" />
              <p className="work-text">
                {a.order.address}, {a.order.postalCode} {a.order.city}, {a.order.country}
              </p>
            </div>
            {a.order.contactName && (
              <p className="crew-visit-copy">Contact: {a.order.contactName}</p>
            )}
            <ul className="crew-visit-contact-links">
              {a.order.phoneNumbers.map((phone) => (
                <li key={phone}>
                  <a className={buttonVariants({ variant: 'outline' })} href={`tel:${phone}`}>
                    <Phone aria-hidden="true" />
                    {phone}
                  </a>
                </li>
              ))}
            </ul>
            {a.order.email && (
              <a className="crew-visit-email" href={`mailto:${a.order.email}`}>
                <Mail size={15} aria-hidden="true" />
                {a.order.email}
              </a>
            )}
            <dl className="work-facts crew-visit-access">
              <div>
                <dt>Floor</dt>
                <dd>{a.order.floor ?? 'Unknown'}</dd>
              </div>
              {(
                [
                  ['Elevator', a.order.hasElevator],
                  ['Easy access', a.order.easyAccess],
                  ['Parking', a.order.parkingAvailable],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>
                    {label === 'Parking' && <ParkingCircle size={13} aria-hidden="true" />}
                    {label}
                  </dt>
                  <dd>{value === null ? 'Unknown' : value ? 'Yes' : 'No'}</dd>
                </div>
              ))}
            </dl>
            {a.order.accessRestrictions && (
              <p className="work-text crew-visit-restrictions">
                Restrictions: {a.order.accessRestrictions}
              </p>
            )}
            {a.order.accessNotes && (
              <p className="work-text crew-visit-copy">{a.order.accessNotes}</p>
            )}
            <div className="crew-visit-instructions">
              <h3>
                <ClipboardList size={16} aria-hidden="true" />
                Work instructions
              </h3>
              <p className="work-text">{a.order.workDescription}</p>
              {a.order.crewNotes && <p className="work-text">{a.order.crewNotes}</p>}
            </div>
          </section>
          <section className="crew-visit-card" id={section('items')} aria-label="Order quantities">
            <h2 className="crew-visit-section-title">
              <Package size={20} aria-hidden="true" />
              Furniture and accumulated quantities
            </h2>
            <p className="crew-visit-copy">
              Totals for the whole order, including other teams and earlier visits. Delivery and
              assembly are recorded separately.
            </p>
            {a.items.length === 0 && <p className="crew-visit-empty">No items in this visit.</p>}
            <div className="crew-visit-item-list">
              {a.items.map((item) => (
                <article className="crew-visit-item" key={item.id}>
                  <div className="crew-visit-card-heading">
                    <h3>{item.description}</h3>
                    <Badge variant="outline">{item.quantity} ordered</Badge>
                  </div>
                  {item.configuration && (
                    <p className="work-text crew-visit-copy">{item.configuration}</p>
                  )}
                  {item.ambient && <p className="crew-visit-copy">Room: {item.ambient}</p>}
                  {item.notes && <p className="work-text crew-visit-copy">{item.notes}</p>}
                  <div className="crew-visit-quantities">
                    <p>
                      <Truck size={17} aria-hidden="true" />
                      <span>
                        <strong>
                          Delivered {item.deliveredQuantity}/{item.quantity}
                        </strong>
                        <small>Remaining delivery {item.remainingDeliveryQuantity}</small>
                      </span>
                    </p>
                    <p>
                      <Wrench size={17} aria-hidden="true" />
                      <span>
                        <strong>
                          {item.requiresAssembly
                            ? `Assembled ${item.assembledQuantity}/${item.quantity}`
                            : 'Assembly not required'}
                        </strong>
                        {item.requiresAssembly && (
                          <small>Remaining assembly {item.remainingAssemblyQuantity}</small>
                        )}
                      </span>
                    </p>
                  </div>
                  {a.canEditResults && (
                    <Button
                      variant="outline"
                      disabled={!!editor || stepBusy || evidenceBusy}
                      onClick={(event) =>
                        openEditor(
                          { kind: 'item', item: structuredClone(item) },
                          event.currentTarget,
                        )
                      }
                    >
                      <Pencil aria-hidden="true" />
                      Update quantities: {item.description}
                    </Button>
                  )}
                </article>
              ))}
            </div>
          </section>
          <section
            className="crew-visit-card"
            id={section('checklist')}
            aria-label="Team checklist"
          >
            <div className="crew-visit-card-heading">
              <h2 className="crew-visit-section-title">
                <ListChecks size={20} aria-hidden="true" />
                My team's checklist
              </h2>
              <Badge variant="outline">
                {a.tasks.filter((task) => task.resultStatus === 'DONE').length}/{a.tasks.length}{' '}
                done
              </Badge>
            </div>
            {a.tasks.length === 0 && <p className="crew-visit-empty">No active tasks.</p>}
            <div className="crew-visit-task-list">
              {a.tasks.map((task) => (
                <article className="crew-visit-task" key={task.id}>
                  <div className="crew-visit-card-heading">
                    <h3>{task.name}</h3>
                    <Badge
                      variant={
                        task.resultStatus === 'DONE'
                          ? 'success'
                          : task.resultStatus === 'SKIPPED'
                            ? 'secondary'
                            : 'outline'
                      }
                    >
                      {task.resultStatus === 'DONE' && <CheckCheck size={13} aria-hidden="true" />}
                      {task.resultStatus}
                    </Badge>
                  </div>
                  <div className="crew-visit-badges">
                    <Badge variant={task.required ? 'default' : 'secondary'}>
                      {task.required ? 'Required' : 'Optional'}
                    </Badge>
                    <Badge variant={task.severity === 'HIGH' ? 'warning' : 'outline'}>
                      <ShieldCheck size={13} aria-hidden="true" />
                      Severity {task.severity}
                    </Badge>
                    <Badge variant="outline">
                      <Flag size={13} aria-hidden="true" />
                      Priority {task.priority}
                    </Badge>
                  </div>
                  {task.description && (
                    <p className="work-text crew-visit-copy">{task.description}</p>
                  )}
                  {task.resultReason && (
                    <p className="work-text crew-visit-copy">Reason: {task.resultReason}</p>
                  )}
                  {task.doneAt && (
                    <p className="crew-visit-meta">
                      Recorded {formatWorkTime(task.doneAt)} · Author {task.doneBy}
                    </p>
                  )}
                  {a.canEditResults && (
                    <Button
                      variant="outline"
                      disabled={!!editor || stepBusy || evidenceBusy}
                      onClick={(event) =>
                        openEditor(
                          { kind: 'task', task: structuredClone(task) },
                          event.currentTarget,
                        )
                      }
                    >
                      <Pencil aria-hidden="true" />
                      Update task: {task.name}
                    </Button>
                  )}
                </article>
              ))}
            </div>
          </section>
          <div id={section('result')} className="crew-visit-result">
            {a.finishReport && (
              <section className="crew-visit-card" aria-label="Saved finish report">
                <h2 className="crew-visit-section-title">
                  <FileCheck2 size={20} aria-hidden="true" />
                  Saved finish report
                </h2>
                <p className="crew-visit-copy">
                  <strong>{executionStatusLabel(a.finishReport.outcome)}</strong> ·{' '}
                  {formatWorkTime(a.finishReport.actualEndAt)} · Author {a.finishReport.authorId}
                </p>
                <p className="work-text">{a.finishReport.summary}</p>
                {a.finishReport.reason && (
                  <p className="work-text">Reason: {a.finishReport.reason}</p>
                )}
                {a.finishReport.remainingWork && (
                  <p className="work-text">Remaining work: {a.finishReport.remainingWork}</p>
                )}
                <p className="crew-visit-copy">
                  This report is frozen. Later notes, photos and issues are additions. The live
                  totals above may have changed.
                </p>
                <h3>Accumulated order quantities at finish</h3>
                <p className="crew-visit-copy">
                  This is the order snapshot, not only this team's contribution.
                </p>
                <div className="crew-visit-snapshot-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Delivered</th>
                        <th>Assembled</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.finishReport.quantities.map((item) => (
                        <tr key={item.id}>
                          <td>{item.description}</td>
                          <td>
                            {item.deliveredQuantity}/{item.quantity}
                          </td>
                          <td>
                            {item.requiresAssembly
                              ? `${item.assembledQuantity}/${item.quantity}`
                              : 'Not required'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3>Checklist at finish</h3>
                <ul className="crew-visit-snapshot-checklist">
                  {a.finishReport.taskResults.map((task) => (
                    <li key={task.id}>
                      {task.name}: {task.resultStatus}
                      {task.resultReason ? ` · ${task.resultReason}` : ''}
                    </li>
                  ))}
                </ul>
                <p className="crew-visit-copy">
                  Known issues at finish: {a.finishReport.knownIssueIds.length}. Known photos/files
                  at finish: {a.finishReport.attachmentIds.length}.
                </p>
              </section>
            )}
            {a.returnRequests.length > 0 && (
              <section className="crew-visit-card" aria-label="Return visit requests">
                <h2 className="crew-visit-section-title">
                  <Route size={20} aria-hidden="true" />
                  Requests for another visit
                </h2>
                <p className="crew-visit-copy">
                  These are needs recorded for the order. Resolving an issue does not clear them.
                </p>
                <div className="crew-visit-item-list">
                  {a.returnRequests.map((request) => (
                    <article className="crew-visit-item" key={request.id}>
                      <Badge variant={request.status === 'RESOLVED' ? 'success' : 'warning'}>
                        {request.status}
                      </Badge>
                      <p className="work-text">{request.reason}</p>
                      <p className="work-text">Remaining work: {request.remainingWork}</p>
                      <small className="crew-visit-meta">
                        {formatWorkTime(request.createdAt)} · Assignment {request.assignmentId}
                      </small>
                    </article>
                  ))}
                </div>
              </section>
            )}
            <VisitAcceptancePanel scope={{ assignmentId: a.id }} onChanged={reload} />
          </div>
          <div id={section('materials')} className="crew-visit-materials">
            <EvidencePanel
              scope={{ assignmentId: a.id }}
              items={a.items}
              canAppend={a.canAppendEvidence}
              onBusyChange={setEvidenceBusy}
              onChanged={() => {
                reload();
                ordersChanged();
              }}
            />
          </div>
          <p className="crew-visit-footer-note">
            <UsersRound size={16} aria-hidden="true" />
            You record your team's visit. Other teams, issues, return visits and final order review
            remain separate.
          </p>
          <Sheet
            open={!!editor}
            onOpenChange={(open) => {
              if (!open && !editorBusy) close();
            }}
          >
            {editor && (
              <SheetContent
                className="crew-editor-sheet tw:max-w-[650px]"
                closeLabel="Close work editor"
                closeDisabled={editorBusy}
                onEscapeKeyDown={(event) => {
                  if (editorBusy) event.preventDefault();
                }}
                onInteractOutside={(event) => {
                  if (editorBusy) event.preventDefault();
                }}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  const target = returnFocus.current;
                  if (
                    target?.isConnected &&
                    !(target instanceof HTMLButtonElement && target.disabled)
                  )
                    target.focus();
                  else if (refreshButton.current && !refreshButton.current.disabled)
                    refreshButton.current.focus();
                  else backLink.current?.focus();
                }}
              >
                <SheetHeader>
                  <p className="crew-visit-eyebrow">
                    <Pencil size={14} aria-hidden="true" />
                    Record your team's work
                  </p>
                  <SheetTitle>{editorTitle}</SheetTitle>
                  <SheetDescription>
                    Save the actual result. Refreshing keeps this draft and its original revision.
                  </SheetDescription>
                </SheetHeader>
                <ResourceNotice pending={resource.pending} error={resource.error} retry={reload} />
                {editor.kind === 'task' && (
                  <TaskResultForm
                    key={editor.task.id}
                    assignmentId={a.id}
                    task={editor.task}
                    readOnly={!a.canEditResults}
                    onSaved={saved}
                    onCancel={close}
                    onReload={reload}
                    onBusyChange={setEditorBusy}
                  />
                )}
                {editor.kind === 'item' && (
                  <FulfillmentForm
                    key={editor.item.id}
                    assignmentId={a.id}
                    item={editor.item}
                    readOnly={!a.canEditResults}
                    onSaved={saved}
                    onCancel={close}
                    onReload={reload}
                    onBusyChange={setEditorBusy}
                  />
                )}
                {editor.kind === 'finish' && (
                  <FinishWorkForm
                    assignment={editor.assignment}
                    readOnly={!a.allowedActions.includes('FINISH')}
                    currentOpenIssueCount={a.openIssueCount}
                    onSaved={saved}
                    onCancel={close}
                    onReload={reload}
                    onBusyChange={setEditorBusy}
                  />
                )}
              </SheetContent>
            )}
          </Sheet>
        </>
      )}
    </div>
  );
}
