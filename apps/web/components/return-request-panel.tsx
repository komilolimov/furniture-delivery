'use client';

import type {
  CreateReturnRequestCommand,
  CrewListResponse,
  CrewSummary,
  ResolveReturnRequestCommand,
  ReturnRequestDetail,
  ReturnRequestResponse,
} from '@furniture-delivery/contracts';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarCheck2,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  Clock3,
  History,
  Layers,
  ListChecks,
  LockKeyhole,
  Package,
  RefreshCw,
  Route,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api-client';
import { isCrewListResponse } from '../lib/contracts-guards';
import { executionStatusLabel, formatWorkTime } from '../lib/execution-labels';
import { isReturnRequestResponse } from '../lib/return-visit-guards';
import { useApiResource } from '../lib/use-api-resource';
import { useCommandAttempt } from '../lib/use-command-attempt';
import { ordersChanged, useOrderResource } from '../lib/use-order-resource';
import { planningChanged } from './appointment-form';
import { Feedback, ResourceNotice } from './form-parts';
import { ReturnVisitPlanForm } from './return-visit-plan-form';
import { useCurrentUser } from './session-provider';
import {
  ReturnReadinessBadge,
  ReturnStatusBadge,
  ReturnStatusIcon,
} from './return-request-presentation';
import { Badge } from './ui/badge';
import { Button, buttonVariants } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import './return-request-detail.css';
import './return-visits.css';

export function CreateReturnRequestControl({
  assignmentId,
  executionVersion,
  onRefresh,
  existingRequestId,
}: Readonly<{
  assignmentId: string;
  executionVersion: number;
  onRefresh: () => Promise<void>;
  existingRequestId?: string;
}>) {
  const [open, setOpen] = useState(false),
    [version, setVersion] = useState(executionVersion);
  const [reason, setReason] = useState(''),
    [remainingWork, setRemainingWork] = useState('');
  const [created, setCreated] = useState<string | null>(null),
    [conflict, setConflict] = useState(false);
  const command = useCommandAttempt<CreateReturnRequestCommand, ReturnRequestResponse>({
    send: async (body) => {
      try {
        return await apiRequest(`/backoffice/assignments/${assignmentId}/return-request`, {
          method: 'POST',
          body,
          validate: isReturnRequestResponse,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) setConflict(true);
        throw error;
      }
    },
    onSaved: (response) => {
      setCreated(response.request.request.id);
      setOpen(false);
      ordersChanged();
      void onRefresh();
    },
    onAccessLost: () => void onRefresh(),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (conflict || existingRequestId) return;
    void command.submit({
      operationKey: crypto.randomUUID(),
      expectedExecutionVersion: version,
      reason: reason.trim(),
      remainingWork: remainingWork.trim(),
    });
  }
  if (created)
    return (
      <p className="form-success" role="status">
        Return request recorded.{' '}
        <Link href={`/backoffice/return-requests/${created}`}>
          Review and plan the remaining work
        </Link>
        .
      </p>
    );
  if (existingRequestId && !open)
    return (
      <Link href={`/backoffice/return-requests/${existingRequestId}`}>
        Review this request and remaining work
      </Link>
    );
  return (
    <div>
      {!open ? (
        <button
          className="secondary-button"
          onClick={() => {
            setVersion(executionVersion);
            setOpen(true);
          }}
        >
          Request a return visit for this team
        </button>
      ) : (
        <form className="return-plan" onSubmit={submit}>
          <h4>Request remaining work</h4>
          <p>
            The finish report is preserved. Recording a need does not book another visit or resolve
            issues.
          </p>
          <fieldset disabled={command.locked || !!existingRequestId}>
            <legend>Return request</legend>
            <label>
              Reason for another visit
              <textarea
                required
                maxLength={4000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <label>
              Remaining work
              <textarea
                required
                maxLength={4000}
                value={remainingWork}
                onChange={(e) => setRemainingWork(e.target.value)}
              />
            </label>
          </fieldset>
          <Feedback error={command.error} />
          {existingRequestId && (
            <p className="conflict-notice">
              A request is already recorded. Your original draft is retained; an unknown result can
              retry its original key.
            </p>
          )}
          {conflict && (
            <div className="conflict-notice">
              <p>The team result changed. Your text is retained.</p>
              <button type="button" className="secondary-button" onClick={() => void onRefresh()}>
                Refresh team result
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setVersion(executionVersion);
                  setConflict(false);
                }}
              >
                Use current execution revision
              </button>
            </div>
          )}
          {command.unknown && (
            <button
              type="button"
              className="secondary-button"
              disabled={command.pending}
              onClick={() => void command.retry()}
            >
              Retry same return request
            </button>
          )}
          <div className="button-row">
            <button
              className="primary-button"
              disabled={command.locked || conflict || !!existingRequestId}
            >
              {command.pending ? 'Saving…' : 'Save return request'}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={command.locked}
              onClick={() => setOpen(false)}
            >
              Keep finished result
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ResolveReturnForm({
  detail,
  onSaved,
  onRefresh,
}: Readonly<{
  detail: ReturnRequestDetail;
  onSaved: (response: ReturnRequestResponse) => void;
  onRefresh: () => Promise<void>;
}>) {
  const [version, setVersion] = useState(detail.request.version),
    [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false),
    [conflict, setConflict] = useState(false);
  const command = useCommandAttempt<ResolveReturnRequestCommand, ReturnRequestResponse>({
    send: async (body) => {
      try {
        return await apiRequest(`/backoffice/return-requests/${detail.request.id}/resolve`, {
          method: 'POST',
          body,
          validate: isReturnRequestResponse,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) setConflict(true);
        throw error;
      }
    },
    onSaved,
    onAccessLost: () => void onRefresh(),
  });
  const stale = version !== detail.request.version;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !confirmed ||
      stale ||
      conflict ||
      !detail.readyToResolve ||
      detail.request.status !== 'PLANNED'
    )
      return;
    void command.submit({
      operationKey: crypto.randomUUID(),
      expectedVersion: version,
      reason: reason.trim(),
    });
  }
  return (
    <form
      className="return-plan return-review-form"
      onSubmit={submit}
      aria-label="Resolve return request"
    >
      <h3>Review completed follow-up</h3>
      <p>
        Resolving this need does not resolve issues or change the original team report, task results
        or quantities.
      </p>
      {!detail.readyToResolve && (
        <div className="conflict-notice">
          <strong>This request cannot be resolved yet.</strong>
          <ul>
            {detail.resolveBlockedReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      <fieldset disabled={command.locked}>
        <legend>Dispatcher review · revision {version}</legend>
        <label>
          Resolution explanation
          <textarea
            required
            maxLength={4000}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setConfirmed(false);
            }}
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={!detail.readyToResolve}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I reviewed the completed follow-up and remaining scope
        </label>
      </fieldset>
      <Feedback error={command.error} />
      {(conflict || stale) && (
        <div className="conflict-notice">
          <p>The request changed. The review text and revision {version} are retained.</p>
          <button
            type="button"
            className="secondary-button"
            disabled={command.locked}
            onClick={() => void onRefresh()}
          >
            Refresh before review
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={command.locked}
            onClick={() => {
              setVersion(detail.request.version);
              setConflict(false);
              setConfirmed(false);
            }}
          >
            Review latest request revision
          </button>
        </div>
      )}
      {command.unknown && (
        <button
          type="button"
          className="secondary-button"
          disabled={command.pending}
          onClick={() => void command.retry()}
        >
          Retry same resolution
        </button>
      )}
      <button
        className="primary-button"
        disabled={command.locked || !detail.readyToResolve || !confirmed || stale || conflict}
      >
        {command.pending ? 'Resolving…' : 'Resolve return need'}
      </button>
    </form>
  );
}

const detailCard =
  'tw:min-w-0 tw:rounded-2xl tw:border tw:border-solid tw:border-[#dfe6d8] tw:bg-[#fffefa] tw:p-6 tw:max-[600px]:p-4';
const detailCopy = 'tw:m-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]';
const detailHeading =
  'tw:m-0 tw:flex tw:items-center tw:gap-2.5 tw:text-base tw:font-semibold tw:tracking-[-0.3px]';
const detailLinks =
  'tw:inline-flex tw:min-h-11 tw:items-center tw:gap-1.5 tw:text-xs tw:font-semibold tw:text-[#466745] tw:no-underline tw:wrap-anywhere';
const quantityLabel =
  'tw:mb-1 tw:hidden tw:text-[10px] tw:font-semibold tw:text-[#71806a] tw:max-[650px]:block';

export function ReturnRequestPanel({
  detail,
  crews,
  onSaved,
  onRefresh,
}: Readonly<{
  detail: ReturnRequestDetail;
  crews: CrewSummary[];
  onSaved: (response: ReturnRequestResponse) => void;
  onRefresh: () => Promise<void>;
}>) {
  const [planning, setPlanning] = useState(false);
  const [reviewing, setReviewing] = useState(detail.request.status === 'PLANNED');
  useEffect(() => {
    if (detail.request.status === 'PLANNED') setReviewing(true);
  }, [detail.request.status]);
  const request = detail.request,
    report = detail.sourceReport;
  const id = `return-${request.id}`;
  return (
    <section
      className="return-detail tw:grid tw:min-w-0 tw:gap-5"
      aria-label="Return request detail"
    >
      <section className={detailCard} id={`${id}-overview`} aria-label="Request overview">
        <div className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-4">
          <div className="tw:flex tw:min-w-0 tw:items-start tw:gap-3.5">
            <span className="tw:flex tw:size-12 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-2xl tw:border tw:border-solid tw:border-[#e5deca] tw:bg-[#f9f2e2] tw:text-[#95713d]">
              <ReturnStatusIcon status={request.status} className="tw:size-6" />
            </span>
            <div className="tw:min-w-0">
              <p className="tw:mt-0 tw:mb-1 tw:text-[10px] tw:font-bold tw:tracking-[1.4px] tw:text-[#7a886e] tw:uppercase">
                Remaining work, connected
              </p>
              <h2 className="tw:m-0 tw:text-[22px] tw:leading-snug tw:font-medium tw:tracking-[-0.6px]">
                Return visit request
              </h2>
              <p className="tw:mt-2 tw:mb-0 tw:font-mono tw:text-[10px] tw:text-[#7a886e] tw:wrap-anywhere">
                Request {request.id} · revision {request.version}
              </p>
            </div>
          </div>
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <ReturnStatusBadge status={request.status} />
            <ReturnReadinessBadge status={request.status} readyToResolve={detail.readyToResolve} />
          </div>
        </div>
        <div className="tw:mt-6 tw:grid tw:grid-cols-2 tw:gap-4 tw:max-[650px]:grid-cols-1">
          <div className="tw:min-w-0 tw:rounded-xl tw:bg-[#f8f3e8] tw:p-4">
            <p className="tw:mt-0 tw:mb-2 tw:flex tw:items-center tw:gap-2 tw:text-[10px] tw:font-bold tw:tracking-wide tw:text-[#92713f] tw:uppercase">
              <Route size={15} aria-hidden="true" />
              Reason for another visit
            </p>
            <p className="return-text tw:m-0 tw:text-sm tw:leading-7 tw:text-[#493e2d]">
              {request.reason}
            </p>
          </div>
          <div className="tw:min-w-0 tw:rounded-xl tw:bg-[#f0f5e9] tw:p-4">
            <p className="tw:mt-0 tw:mb-2 tw:flex tw:items-center tw:gap-2 tw:text-[10px] tw:font-bold tw:tracking-wide tw:text-[#62774e] tw:uppercase">
              <ListChecks size={15} aria-hidden="true" />
              Remaining work
            </p>
            <p className="return-text tw:m-0 tw:text-sm tw:leading-7 tw:text-[#314b35]">
              {request.remainingWork}
            </p>
          </div>
        </div>
        <dl className="tw:mt-5 tw:mb-0 tw:grid tw:grid-cols-3 tw:gap-4 tw:border-x-0 tw:border-b-0 tw:border-t tw:border-solid tw:border-[#e4e9de] tw:pt-4 tw:max-[650px]:grid-cols-1">
          <div className="tw:min-w-0">
            <dt className="tw:mb-1.5 tw:flex tw:items-center tw:gap-1.5 tw:text-[10px] tw:font-semibold tw:text-[#7a886e]">
              <Clock3 size={13} aria-hidden="true" />
              Requested · Europe/Rome
            </dt>
            <dd className="tw:m-0 tw:text-xs tw:leading-relaxed tw:wrap-anywhere">
              {formatWorkTime(request.createdAt)}
            </dd>
          </div>
          <div className="tw:min-w-0">
            <dt className="tw:mb-1.5 tw:flex tw:items-center tw:gap-1.5 tw:text-[10px] tw:font-semibold tw:text-[#7a886e]">
              <UserRound size={13} aria-hidden="true" />
              Recorded by
            </dt>
            <dd className="tw:m-0 tw:font-mono tw:text-[10px] tw:leading-relaxed tw:wrap-anywhere">
              {request.authorId}
            </dd>
          </div>
          <div className="tw:min-w-0">
            <dt className="tw:mb-1.5 tw:flex tw:items-center tw:gap-1.5 tw:text-[10px] tw:font-semibold tw:text-[#7a886e]">
              <History size={13} aria-hidden="true" />
              Follow-up attempts
            </dt>
            <dd className="tw:m-0 tw:text-xs tw:leading-relaxed">
              {detail.attempts.length} recorded
            </dd>
          </div>
        </dl>
        <div className="tw:mt-5 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-4">
          <p className={`${detailCopy} tw:max-w-[530px]`}>
            OPEN and PLANNED both mean the need is unresolved. Issues have a separate lifecycle.
          </p>
          <Link
            className={buttonVariants({ variant: 'outline' })}
            href={`/backoffice/orders/${request.orderId}`}
          >
            Open original order
            <ArrowUpRight aria-hidden="true" />
          </Link>
        </div>
      </section>

      <nav
        aria-label="Return request sections"
        className="tw:flex tw:flex-wrap tw:gap-2 tw:rounded-xl tw:border tw:border-solid tw:border-[#e0e6d9] tw:bg-[#edf2e8] tw:p-2"
      >
        {[
          { key: 'overview', label: 'Overview', icon: Layers },
          { key: 'actions', label: 'Plan & review', icon: CalendarCheck2 },
          { key: 'quantities', label: 'Quantities', icon: Package },
          { key: 'history', label: 'Attempt history', icon: History },
          { key: 'report', label: 'Source report', icon: LockKeyhole },
        ].map(({ key, label, icon: Icon }) => (
          <a
            key={key}
            className={buttonVariants({
              variant: 'ghost',
              size: 'sm',
              className: 'tw:flex-1 tw:whitespace-nowrap tw:max-[600px]:flex-auto',
            })}
            href={`#${id}-${key}`}
          >
            <Icon aria-hidden="true" />
            {label}
          </a>
        ))}
      </nav>

      <section
        className={detailCard}
        id={`${id}-actions`}
        aria-label="Follow-up planning and review"
      >
        <h3 className={detailHeading}>
          <CalendarCheck2 size={19} className="tw:shrink-0 tw:text-[#6f865c]" aria-hidden="true" />
          Plan & review
        </h3>
        <p className="tw:mt-2 tw:mb-5 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
          A planned visit keeps this need open. Resolution requires an explicit dispatcher review
          after the follow-up work is complete.
        </p>
        {detail.currentAppointment && (
          <div className="tw:mb-5 tw:grid tw:gap-2 tw:rounded-xl tw:border tw:border-solid tw:border-[#d8e4d1] tw:bg-[#f1f6eb] tw:p-4">
            <Link
              className={detailLinks}
              href={`/backoffice/planning/orders/${request.orderId}/appointments/${detail.currentAppointment.id}`}
            >
              <CalendarDays size={16} aria-hidden="true" />
              {request.status === 'RESOLVED' ? 'Open covering follow-up' : 'Open current follow-up'}
              <ArrowUpRight size={13} aria-hidden="true" />
            </Link>
            <p className={detailCopy}>
              {formatWorkTime(detail.currentAppointment.plannedStartAt)} ·{' '}
              {detail.currentAppointment.confirmationStatus === 'CONFIRMED'
                ? 'Client confirmed'
                : 'Client confirmation required'}
            </p>
          </div>
        )}
        {request.status === 'OPEN' && !planning && (
          <>
            <Button disabled={crews.length === 0} onClick={() => setPlanning(true)}>
              <CalendarDays aria-hidden="true" />
              Plan remaining work
            </Button>
            {crews.length === 0 && (
              <p className="tw:mt-3 tw:mb-0 tw:text-xs tw:leading-relaxed tw:text-[#7a886e]">
                Team options must be available before planning a follow-up.
              </p>
            )}
          </>
        )}
        {planning && (
          <ReturnVisitPlanForm
            detail={detail}
            crews={crews}
            onSaved={(response) => {
              setPlanning(false);
              onSaved(response);
            }}
            onRefresh={onRefresh}
          />
        )}
        {reviewing && (
          <ResolveReturnForm
            detail={detail}
            onSaved={(response) => {
              setReviewing(false);
              onSaved(response);
            }}
            onRefresh={onRefresh}
          />
        )}
        {request.status === 'RESOLVED' && (
          <div className="tw:mt-4 tw:flex tw:items-start tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#d5e4cd] tw:bg-[#edf5e7] tw:p-4">
            <CheckCheck
              size={19}
              className="tw:mt-0.5 tw:shrink-0 tw:text-[#52764c]"
              aria-hidden="true"
            />
            <p className="return-text tw:m-0 tw:text-xs tw:leading-7 tw:text-[#3b6240]">
              Need resolved {formatWorkTime(request.resolvedAt)} · {request.resolution}. The
              original report remains unchanged; other issues and requests may still prevent review.
            </p>
          </div>
        )}
      </section>

      <section
        className={`${detailCard} tw:overflow-hidden`}
        id={`${id}-quantities`}
        aria-label="Current accumulated quantities"
      >
        <h3 className={detailHeading}>
          <Package size={19} className="tw:shrink-0 tw:text-[#6f865c]" aria-hidden="true" />
          Current accumulated quantities
        </h3>
        <p className="tw:mt-2 tw:mb-5 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
          Live totals for the whole order. Delivery and assembly are tracked separately, across all
          visits.
        </p>
        {detail.items.length === 0 ? (
          <p className={detailCopy}>No items in this request.</p>
        ) : (
          <Table className="return-quantities-table tw:table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="tw:w-[50%]">Item</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead>Assembled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="tw:text-xs tw:font-medium tw:max-[650px]:px-0 tw:max-[650px]:py-0">
                    {item.description}
                  </TableCell>
                  <TableCell className="tw:text-xs tw:tabular-nums tw:max-[650px]:px-0 tw:max-[650px]:py-0">
                    <span className={quantityLabel}>Delivered</span>
                    {item.deliveredQuantity} / {item.quantity}
                  </TableCell>
                  <TableCell className="tw:text-xs tw:tabular-nums tw:max-[650px]:px-0 tw:max-[650px]:py-0">
                    <span className={quantityLabel}>Assembled</span>
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

      <section className={detailCard} id={`${id}-history`} aria-label="Follow-up attempt history">
        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
          <h3 className={detailHeading}>
            <History size={19} className="tw:shrink-0 tw:text-[#6f865c]" aria-hidden="true" />
            Attempt history
          </h3>
          <Badge variant="outline">{detail.attempts.length} attempts</Badge>
        </div>
        <p className="tw:mt-2 tw:mb-5 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
          Each follow-up is a separate visit of the same order. Accepted scope and previous outcomes
          remain in history.
        </p>
        {detail.attempts.length === 0 && (
          <div className="tw:grid tw:justify-items-center tw:gap-2 tw:rounded-xl tw:border tw:border-dashed tw:border-[#d9e2d2] tw:bg-[#f7f9f3] tw:p-7 tw:text-center">
            <CalendarDays size={25} className="tw:text-[#829572]" aria-hidden="true" />
            <p className={detailCopy}>No follow-up has been planned.</p>
          </div>
        )}
        <div className="tw:grid tw:gap-3">
          {detail.attempts.map((attempt, index) => (
            <details
              className="return-attempt tw:rounded-xl tw:border tw:border-solid tw:border-[#e0e7d7] tw:bg-[#fbfcf8] tw:px-4 tw:py-0"
              key={attempt.id}
            >
              <summary className="tw:min-h-12 tw:cursor-pointer tw:py-4 tw:text-xs tw:font-semibold">
                <span className="tw:ml-1 tw:inline-flex tw:items-center tw:gap-2">
                  <Route size={16} className="tw:text-[#7e916e]" aria-hidden="true" />
                  Attempt {index + 1} ·{' '}
                  {attempt.current ? 'Current follow-up' : attempt.closedOutcome?.toLowerCase()}
                </span>
              </summary>
              <div className="tw:grid tw:min-w-0 tw:gap-3 tw:border-x-0 tw:border-b-0 tw:border-t tw:border-solid tw:border-[#e5eadf] tw:pt-2 tw:pb-4">
                <Link
                  className={detailLinks}
                  href={`/backoffice/planning/orders/${request.orderId}/appointments/${attempt.appointmentId}`}
                >
                  Open attempt {index + 1} visit
                  <ArrowUpRight size={13} aria-hidden="true" />
                </Link>
                <p className={detailCopy}>
                  {formatWorkTime(attempt.createdAt)} · planned by {attempt.createdBy}.
                </p>
                {attempt.closeReason && (
                  <p className="return-text tw:m-0 tw:rounded-lg tw:bg-[#f9efe6] tw:p-3 tw:text-xs tw:leading-relaxed tw:text-[#93633f]">
                    {attempt.closedOutcome}: {attempt.closeReason} ·{' '}
                    {formatWorkTime(attempt.closedAt)}.
                  </p>
                )}
                {attempt.returnRequested && (
                  <p className={detailCopy}>
                    Another visit was requested during this attempt; planning alone does not clear
                    that need.
                  </p>
                )}
                <h4 className="tw:mt-1 tw:mb-0 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-semibold">
                  <ListChecks size={15} aria-hidden="true" />
                  Accepted tasks
                </h4>
                {!attempt.scope.tasks.length && (
                  <p className={detailCopy}>No tasks in this accepted scope.</p>
                )}
                <ul className="tw:m-0 tw:grid tw:gap-2 tw:pl-4 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
                  {attempt.scope.tasks.map((task) => (
                    <li key={task.key} className="tw:wrap-anywhere">
                      {task.name} · {task.required ? 'required' : 'optional'} ·{' '}
                      {task.sourceTaskId
                        ? `carried from ${task.sourceTaskId}`
                        : `new work: ${task.addedReason}`}
                      .
                    </li>
                  ))}
                </ul>
                <h4 className="tw:mt-1 tw:mb-0 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-semibold">
                  <Package size={15} aria-hidden="true" />
                  Absolute item targets
                </h4>
                {!attempt.scope.itemTargets.length && (
                  <p className={detailCopy}>No item targets in this accepted scope.</p>
                )}
                <ul className="tw:m-0 tw:grid tw:gap-2 tw:pl-4 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
                  {attempt.scope.itemTargets.map((target) => (
                    <li key={target.itemId} className="tw:wrap-anywhere">
                      {detail.items.find((item) => item.id === target.itemId)?.description ??
                        'Item'}
                      : absolute delivery target {target.deliveredQuantity}, assembly target{' '}
                      {target.assembledQuantity}.
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className={detailCard} id={`${id}-report`} aria-label="Immutable source report">
        <h3 className={detailHeading}>
          <LockKeyhole size={19} className="tw:shrink-0 tw:text-[#6f865c]" aria-hidden="true" />
          Original result, preserved
        </h3>
        <p className="tw:mt-2 tw:mb-5 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
          This is the saved result of the source visit. A later follow-up never rewrites this
          snapshot.
        </p>
        <details className="bo-execution-report tw:rounded-xl tw:border tw:border-solid tw:border-[#dfe5d8] tw:bg-[#f7f9f3] tw:p-4">
          <summary className="tw:min-h-11 tw:cursor-pointer tw:text-xs tw:font-semibold">
            Immutable source report · {executionStatusLabel(report.outcome)}
          </summary>
          <div className="tw:grid tw:min-w-0 tw:gap-4 tw:pt-3">
            <p className="return-text tw:m-0 tw:text-sm tw:leading-7">{report.summary}</p>
            {report.reason && (
              <p className="return-text tw:m-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
                Original reason: {report.reason}
              </p>
            )}
            {report.remainingWork && (
              <p className="return-text tw:m-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
                Original remaining work: {report.remainingWork}
              </p>
            )}
            <p className={detailCopy}>
              {formatWorkTime(report.actualEndAt)} · author {report.authorId}.
            </p>
            <h4 className="tw:m-0 tw:text-xs tw:font-semibold">Recorded checklist</h4>
            <ul className="tw:m-0 tw:grid tw:gap-2 tw:pl-4 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
              {report.taskResults.map((task) => (
                <li key={task.id} className="tw:wrap-anywhere">
                  {task.name} · {task.resultStatus.toLowerCase()}
                </li>
              ))}
            </ul>
            <h4 className="tw:m-0 tw:text-xs tw:font-semibold">Frozen accumulated quantities</h4>
            <ul className="tw:m-0 tw:grid tw:gap-2 tw:pl-4 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
              {report.quantities.map((item) => (
                <li key={item.id} className="tw:wrap-anywhere">
                  {item.description}: delivered {item.deliveredQuantity}/{item.quantity}; assembled{' '}
                  {item.assembledQuantity}/{item.quantity} · frozen accumulated snapshot.
                </li>
              ))}
            </ul>
            <Link
              className={detailLinks}
              href={`/backoffice/planning/orders/${request.orderId}/appointments/${request.appointmentId}`}
            >
              Open source visit
              <ArrowUpRight size={13} aria-hidden="true" />
            </Link>
          </div>
        </details>
      </section>
      <p className="tw:m-0 tw:flex tw:items-start tw:gap-2 tw:text-[11px] tw:leading-relaxed tw:text-[#7a886e]">
        <ShieldCheck size={15} className="tw:mt-0.5 tw:shrink-0" aria-hidden="true" />
        Return needs, issues and final order completion are separate decisions. Every action is
        checked by the server.
      </p>
    </section>
  );
}

function ReturnRequestDetailBody({ requestId }: Readonly<{ requestId: string }>) {
  const resource = useOrderResource<ReturnRequestResponse>(
    `/backoffice/return-requests/${requestId}`,
    isReturnRequestResponse,
    { retainDataOnRefresh: true },
  );
  const crews = useApiResource<CrewListResponse>('/crews', isCrewListResponse);
  async function refresh() {
    await resource.refresh();
  }
  return (
    <div className="return-workspace tw:grid tw:min-w-0 tw:gap-6 tw:text-[#18372e]">
      <nav
        aria-label="Breadcrumb"
        className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:text-xs tw:text-[#7a886e]"
      >
        <Link
          className="tw:inline-flex tw:min-h-11 tw:items-center tw:gap-1.5 tw:font-medium tw:text-[#58714e] tw:no-underline"
          href="/backoffice/return-requests"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Return visit queue
        </Link>
        <ChevronRight size={13} aria-hidden="true" />
        <span>Request details</span>
      </nav>
      <header className="tw:flex tw:flex-wrap tw:items-end tw:justify-between tw:gap-4">
        <div className="tw:min-w-0">
          <p className="tw:mt-0 tw:mb-3 tw:text-[10px] tw:font-bold tw:tracking-[1.8px] tw:text-[#226347] tw:uppercase">
            Follow-up workspace · Europe/Rome
          </p>
          <h1 className="tw:m-0 tw:text-[34px] tw:leading-[1.15] tw:font-medium tw:tracking-[-1px] tw:max-[600px]:text-[28px]">
            Follow-up planning and review
          </h1>
          <p className="tw:mt-3 tw:mb-0 tw:max-w-[620px] tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
            Connect the next visit to the remaining work, then review its saved outcome.
          </p>
        </div>
        <Button variant="outline" disabled={resource.pending} onClick={() => void refresh()}>
          <RefreshCw aria-hidden="true" />
          Refresh return request
        </Button>
      </header>
      <ResourceNotice
        pending={resource.pending}
        error={resource.error}
        retry={() => void refresh()}
      />
      <ResourceNotice
        pending={crews.pending}
        error={crews.error}
        retry={() => void crews.refresh()}
      />
      {resource.data && (
        <ReturnRequestPanel
          key={requestId}
          detail={resource.data.request}
          crews={crews.data?.crews ?? []}
          onSaved={(response) => {
            resource.setData(response);
            planningChanged();
          }}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}

export function ReturnRequestDetailScreen({ requestId }: Readonly<{ requestId: string }>) {
  const user = useCurrentUser();
  if (user.role !== 'ADMIN' && user.role !== 'DISPATCHER')
    return <p role="alert">Access denied. Return requests are available to backoffice users.</p>;
  return <ReturnRequestDetailBody key={requestId} requestId={requestId} />;
}
