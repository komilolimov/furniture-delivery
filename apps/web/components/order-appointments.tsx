'use client';
import { Textarea } from './ui/textarea';
import { Button, buttonVariants } from './ui/button';

import type {
  AppointmentDetail,
  AppointmentResponse,
  CrewListResponse,
  CrewSummary,
  OrderDetail,
  TaskTemplateListResponse,
  TaskTemplateRecord,
} from '@furniture-delivery/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiRequest, ApiError, describeError } from '../lib/api-client';
import { displayRome } from '../lib/business-time';
import { isCrewListResponse } from '../lib/contracts-guards';
import { isAppointmentResponse, isOrderResponse } from '../lib/order-guards';
import { isTaskTemplateListResponse } from '../lib/planning-guards';
import { useApiResource } from '../lib/use-api-resource';
import { useRealtimeCoordinator } from '../lib/realtime-context';
import { AppointmentForm, planningChanged } from './appointment-form';
import { Feedback, ResourceNotice } from './form-parts';
import { AppointmentExecutionReadout } from './backoffice-execution-panel';
import { executionStatusLabel, formatWorkTime } from '../lib/execution-labels';
import { AssignmentEstimate } from './assignment-estimate';
import './planning.css';

export function appointmentHref(appointment: Pick<AppointmentDetail, 'orderId' | 'id'>) {
  return `/backoffice/planning/orders/${appointment.orderId}/appointments/${appointment.id}`;
}

function AppointmentActions({
  appointment,
  onSaved,
  onReload,
  disabled = false,
  onLockChange,
}: Readonly<{
  appointment: AppointmentDetail;
  onSaved: (response: AppointmentResponse) => void;
  onReload: () => Promise<void>;
  disabled?: boolean;
  onLockChange?: (locked: boolean) => void;
}>) {
  const lockCallback = useRef(onLockChange);
  useEffect(() => {
    lockCallback.current = onLockChange;
  }, [onLockChange]);
  useEffect(
    () => () => {
      lockCallback.current?.(false);
    },
    [],
  );
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [cancelVersion, setCancelVersion] = useState<number | null>(null),
    [reason, setReason] = useState(''),
    [needsReload, setNeedsReload] = useState(false);
  const started = appointment.assignments.some(
    (assignment) => assignment.execution.departedAt !== null,
  );
  const busy = useRef(false);
  async function mutate(path: string, body: unknown) {
    if (busy.current || needsReload || disabled) return;
    busy.current = true;
    setPending(true);
    setError(null);
    onLockChange?.(true);
    try {
      const response = await apiRequest<AppointmentResponse>(
        `/orders/${appointment.orderId}/appointments/${appointment.id}/${path}`,
        { method: 'POST', body, validate: isAppointmentResponse },
      );
      onLockChange?.(false);
      planningChanged();
      onSaved(response);
      setCancelVersion(null);
      setReason('');
    } catch (error) {
      setError(describeError(error));
      const uncertain =
        error instanceof ApiError &&
        (error.status === 0 || error.status >= 500 || error.status === 409);
      setNeedsReload(uncertain);
      onLockChange?.(uncertain);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get('confirm') !== 'on') {
      setError('Confirm cancellation before saving.');
      return;
    }
    void mutate('cancel', { expectedVersion: cancelVersion, reason: reason.trim() });
  }
  async function reload() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      await onReload();
      onLockChange?.(false);
      setNeedsReload(false);
      setError(null);
      setCancelVersion(null);
      setReason('');
    } catch (error) {
      setError(describeError(error));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <>
      <div className="button-row tw:flex tw:flex-wrap tw:gap-2">
        {appointment.confirmationStatus === 'NEEDS_CONFIRMATION' && (
          <Button
            type="button"
            variant="outline"
            disabled={pending || needsReload || disabled || started}
            onClick={() => void mutate('confirm', { expectedVersion: appointment.version })}
          >
            Confirm client agreement
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={pending || needsReload || disabled || started}
          onClick={() => {
            setCancelVersion(appointment.version);
            setError(null);
          }}
        >
          Cancel visit
        </Button>
      </div>
      {cancelVersion !== null && (
        <form
          className="void-form tw:my-5 tw:grid tw:gap-4 tw:rounded-xl tw:border tw:border-solid tw:border-[#e8dab9] tw:bg-[#fcf7e9] tw:p-5"
          onSubmit={cancel}
        >
          <h3>Cancel this visit</h3>
          <p className="section-copy">
            Cancellation releases the team reservations and preserves this visit, assignments, task
            snapshots and history.
          </p>
          <label>
            Reason for cancellation
            <Textarea
              required
              maxLength={1000}
              rows={2}
              value={reason}
              disabled={pending}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="checkbox-field">
            <input
              className="tw:size-4 tw:min-h-4 tw:shrink-0 tw:accent-[#28543b]"
              type="checkbox"
              name="confirm"
              required
              disabled={pending}
            />
            Confirm cancellation
          </label>
          <div className="button-row tw:flex tw:flex-wrap tw:gap-2">
            <Button type="submit" disabled={pending || needsReload || disabled || started}>
              {pending ? 'Saving…' : 'Confirm cancellation'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setCancelVersion(null)}
            >
              Keep visit
            </Button>
          </div>
        </form>
      )}
      <Feedback error={error} />
      {needsReload && (
        <div className="conflict-notice">
          <p>
            The visit may have changed. Read its current state before another action. Your
            cancellation reason is retained until you choose to reload.
          </p>
          <Button type="button" variant="outline" disabled={pending} onClick={() => void reload()}>
            Reload current visit
          </Button>
        </div>
      )}
    </>
  );
}

export function AppointmentCard({
  appointment,
  onEdit,
  onSaved,
  onReload,
  readOnly = false,
  disabled = false,
  onLockChange,
}: Readonly<{
  appointment: AppointmentDetail;
  onEdit?: () => void;
  readOnly?: boolean;
  disabled?: boolean;
  onLockChange?: (locked: boolean) => void;
  onSaved: (response: AppointmentResponse) => void;
  onReload: () => Promise<void>;
}>) {
  const [operationLocked, setOperationLocked] = useState(false);
  const active = appointment.assignments.filter((a) => a.status === 'ASSIGNED');
  const started = appointment.assignments.some(
    (assignment) => assignment.execution.departedAt !== null,
  );
  return (
    <article
      className="appointment-card tw:min-w-0 tw:rounded-xl tw:border tw:border-solid tw:border-[#e0e7da] tw:bg-[#fffefa] tw:p-5 tw:max-[600px]:p-4"
      aria-label={`Visit ${appointment.id}`}
    >
      <div className="card-line tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-3">
        <div>
          <p className="eyebrow">
            Visit ·{' '}
            {appointment.status === 'CANCELLED'
              ? 'Cancelled'
              : active.length
                ? 'Assigned'
                : 'Unassigned'}
          </p>
          <h3>
            <Link href={appointmentHref(appointment)}>
              {displayRome(appointment.plannedStartAt)} – {displayRome(appointment.plannedEndAt)}
            </Link>
          </h3>
          <p className="section-copy">
            {appointment.durationMinutes} minutes at customer · Europe/Rome · revision{' '}
            {appointment.version}
          </p>
        </div>
        <span
          className={`service-badge ${appointment.confirmationStatus === 'CONFIRMED' ? 'up' : 'down'}`}
        >
          {appointment.confirmationStatus === 'CONFIRMED'
            ? 'Client confirmed'
            : 'Needs confirmation'}
        </span>
      </div>
      <AppointmentExecutionReadout appointment={appointment} />
      {started && (
        <p className="conflict-notice">
          A team has departed. Time, teams, task definitions and cancellation are locked. Internal
          visit notes may still be edited; the server checks every change.
        </p>
      )}
      {appointment.notes && <p className="section-copy">{appointment.notes}</p>}
      {appointment.status === 'CANCELLED' && (
        <p className="conflict-notice">
          Cancelled: {appointment.cancelReason}. The visit is retained in history and no longer
          reserves team time.
        </p>
      )}
      {appointment.needsAttention && (
        <div className="conflict-notice">
          <strong>Needs attention</strong>
          <ul>
            {appointment.attention.map((issue, index) => (
              <li key={`${issue.crewId}-${issue.code}-${index}`}>
                {appointment.assignments.find((a) => a.crewId === issue.crewId)?.crewName ?? 'Team'}
                : {issue.message}
              </li>
            ))}
          </ul>
          <p>
            {started
              ? 'Existing reservations and actual work are retained. Review the planning warning and document the team’s result.'
              : 'Existing reservations are retained. Cancel or reassign the visit explicitly.'}
          </p>
        </div>
      )}
      {active.length === 0 && appointment.status !== 'CANCELLED' && (
        <p className="empty-copy">Unassigned — this visit does not reserve a team.</p>
      )}
      <div className="assignment-snapshots">
        {appointment.assignments.map((a) => (
          <section
            key={a.id}
            className="assignment-snapshot tw:min-w-0 tw:rounded-xl tw:border tw:border-solid tw:border-[#e0e7da] tw:bg-white tw:p-4"
          >
            <h4>
              {a.crewName}
              {!a.crewActive ? ' (inactive)' : ''} ·{' '}
              {a.status === 'ASSIGNED' ? 'Assigned' : 'Removed'}
            </h4>
            <p className="section-copy">
              Travel buffer: {a.travelBufferMinutes} minutes after the customer window.
              {a.status === 'CANCELLED' && ` Removal reason: ${a.cancelReason}`}
            </p>
            <p>
              {executionStatusLabel(a.execution.status)} · Departed{' '}
              {formatWorkTime(a.execution.departedAt)} · Arrived{' '}
              {formatWorkTime(a.execution.arrivedAt)} · Started{' '}
              {formatWorkTime(a.execution.actualStartAt)} · Ended{' '}
              {formatWorkTime(a.execution.actualEndAt)}
            </p>
            <AssignmentEstimate
              assignmentId={a.id}
              execution={a.execution}
              mode="backoffice"
              onSaved={() => void onReload()}
              disabled={disabled || readOnly || a.status !== 'ASSIGNED'}
            />
            <ul className="planned-tasks">
              {a.tasks.map((task) => (
                <li key={task.id}>
                  <strong>
                    {task.name}
                    {!task.active ? ' (removed)' : ''}
                  </strong>
                  <span>
                    {task.required ? 'Required' : 'Optional'} · {task.severity.toLowerCase()} ·
                    priority {task.priority}
                  </span>
                  <span>
                    Result: {task.resultStatus.toLowerCase()}
                    {task.doneAt ? ` · ${formatWorkTime(task.doneAt)} · author ${task.doneBy}` : ''}
                  </span>
                  {task.resultReason && <p>{task.resultReason}</p>}
                  {task.description && <p>{task.description}</p>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {appointment.status === 'SCHEDULED' && !readOnly && (
        <>
          <div className="button-row tw:flex tw:flex-wrap tw:gap-2">
            {onEdit && (
              <Button type="button" disabled={disabled || operationLocked} onClick={onEdit}>
                Edit visit
              </Button>
            )}
          </div>
          <AppointmentActions
            appointment={appointment}
            onSaved={onSaved}
            onReload={onReload}
            disabled={disabled}
            onLockChange={(locked) => {
              setOperationLocked(locked);
              onLockChange?.(locked);
            }}
          />
        </>
      )}
    </article>
  );
}

export function OrderAppointments({
  order,
  onSaved,
}: Readonly<{ order: OrderDetail; onSaved: (order: OrderDetail) => void }>) {
  const live = useRealtimeCoordinator();
  const crews = useApiResource<CrewListResponse>('/crews', isCrewListResponse),
    templates = useApiResource<TaskTemplateListResponse>(
      '/task-templates',
      isTaskTemplateListResponse,
    );
  const [formSources, setFormSources] = useState<{
      crews: CrewSummary[];
      templates: TaskTemplateRecord[];
    } | null>(null),
    [createOrder, setCreateOrder] = useState<OrderDetail | null>(null);
  const [creating, setCreating] = useState(false),
    [editing, setEditing] = useState<{ appointment: AppointmentDetail; order: OrderDetail } | null>(
      null,
    ),
    [error, setError] = useState<string | null>(null),
    [formLocked, setFormLocked] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [operationLocks, setOperationLocks] = useState<Set<string>>(() => new Set());
  const refreshRequest = useRef<AbortController | null>(null),
    latestVersion = useRef(order.version);
  useEffect(() => {
    latestVersion.current = Math.max(latestVersion.current, order.version);
  }, [order.version]);
  async function refreshOrder() {
    refreshRequest.current?.abort();
    const controller = new AbortController();
    refreshRequest.current = controller;
    setRefreshing(true);
    try {
      const response = live
        ? await live.readCanonical(`/orders/${order.id}`, isOrderResponse)
        : await apiRequest(`/orders/${order.id}`, {
            validate: isOrderResponse,
            signal: controller.signal,
          });
      if (
        refreshRequest.current === controller &&
        !controller.signal.aborted &&
        response.order.version >= latestVersion.current
      ) {
        latestVersion.current = response.order.version;
        onSaved(response.order);
        setError(null);
      }
    } catch (error) {
      if (refreshRequest.current === controller && !controller.signal.aborted)
        setError(describeError(error));
    } finally {
      if (refreshRequest.current === controller) setRefreshing(false);
    }
  }
  useEffect(() => {
    if (live)
      return () => {
        refreshRequest.current?.abort();
      };
    const refresh = () => {
      void refreshOrder();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('fd:planning-changed', refresh);
    window.addEventListener('fd:orders-changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('fd:planning-changed', refresh);
      window.removeEventListener('fd:orders-changed', refresh);
      refreshRequest.current?.abort();
    };
  }, [order.id, onSaved, live]);
  const ready =
    crews.data &&
    templates.data &&
    !crews.pending &&
    !templates.pending &&
    !crews.error &&
    !templates.error;
  function publishOrder(saved: OrderDetail) {
    latestVersion.current = saved.version;
    refreshRequest.current?.abort();
    onSaved(saved);
  }
  async function reload(id: string) {
    const response = await apiRequest<AppointmentResponse>(
      `/orders/${order.id}/appointments/${id}`,
      { validate: isAppointmentResponse },
    );
    publishOrder(response.order);
    return response;
  }
  const saved = (response: AppointmentResponse) => {
    latestVersion.current = response.order.version;
    refreshRequest.current?.abort();
    setFormLocked(false);
    onSaved(response.order);
    setCreating(false);
    setEditing(null);
    setError(null);
  };
  return (
    <section className="content-card order-appointments tw:min-w-0 tw:rounded-2xl tw:border tw:border-solid tw:border-[#dfe6d8] tw:bg-[#fffefa] tw:p-6 tw:max-[600px]:p-4">
      <div className="card-line tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-3">
        <div>
          <h2>Appointments</h2>
          <p className="section-copy">
            Plan visits, assign teams and prepare their task snapshots.
          </p>
        </div>
        <Link className={buttonVariants({ variant: 'outline' })} href="/backoffice/planning">
          Open calendar
        </Link>
      </div>
      <ResourceNotice
        pending={crews.pending || templates.pending}
        error={crews.error ?? templates.error}
        retry={() => {
          void crews.refresh();
          void templates.refresh();
        }}
      />
      <Feedback error={error} />
      {order.progress === 'COMPLETED' && (
        <p className="conflict-notice">
          This order is completed.{' '}
          <Link href={`/backoffice/orders/${order.id}#order-completion`}>
            Explicitly reopen the order
          </Link>{' '}
          before planning more work. Existing visits, results and signatures remain in history.
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={refreshing}
        onClick={() => void refreshOrder()}
      >
        {refreshing ? 'Refreshing visits…' : 'Refresh visits'}
      </Button>
      {!creating && !editing && (
        <Button
          type="button"
          disabled={!ready || operationLocks.size > 0 || order.progress === 'COMPLETED'}
          onClick={() => {
            setCreateOrder(order);
            setFormSources({ crews: crews.data!.crews, templates: templates.data!.templates });
            setCreating(true);
          }}
        >
          Plan a visit
        </Button>
      )}
      {creating && createOrder && formSources && (
        <div className="planning-editor tw:my-5 tw:min-w-0 tw:rounded-xl tw:border tw:border-solid tw:border-[#dfe6d8] tw:bg-[#f8faf4] tw:p-5 tw:max-[600px]:p-4">
          <h3>New visit</h3>
          <fieldset disabled={order.progress === 'COMPLETED'} className="closed-order-plan">
            <AppointmentForm
              order={createOrder}
              crews={formSources.crews}
              templates={formSources.templates}
              onSaved={saved}
              onOrderReloaded={(saved) => {
                publishOrder(saved);
                setCreateOrder(saved);
              }}
              onLockChange={setFormLocked}
            />
          </fieldset>
          <Button
            type="button"
            variant="outline"
            disabled={formLocked}
            onClick={() => setCreating(false)}
          >
            Close new visit form
          </Button>
        </div>
      )}
      {editing && formSources && (
        <div className="planning-editor tw:my-5 tw:min-w-0 tw:rounded-xl tw:border tw:border-solid tw:border-[#dfe6d8] tw:bg-[#f8faf4] tw:p-5 tw:max-[600px]:p-4">
          <h3>Edit visit</h3>
          <AppointmentForm
            key={`${editing.appointment.id}-${editing.appointment.version}`}
            order={editing.order}
            appointment={editing.appointment}
            crews={formSources.crews}
            templates={formSources.templates}
            onSaved={saved}
            onLockChange={setFormLocked}
            onReload={() => {
              void reload(editing.appointment.id)
                .then((response) => {
                  setFormLocked(false);
                  setEditing({ appointment: response.appointment, order: response.order });
                  setError(null);
                })
                .catch((error) => setError(describeError(error)));
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={formLocked}
            onClick={() => setEditing(null)}
          >
            Close visit editor
          </Button>
        </div>
      )}
      {order.appointments.length === 0 ? (
        <p className="empty-copy">No visits planned. This order is in Inbox.</p>
      ) : (
        <div className="appointment-list">
          {order.appointments.map((appointment) => (
            <AppointmentCard
              key={appointment.id}
              appointment={appointment}
              readOnly={creating || Boolean(editing)}
              disabled={operationLocks.size > 0}
              onLockChange={(locked) =>
                setOperationLocks((current) => {
                  if (current.has(appointment.id) === locked) return current;
                  const next = new Set(current);
                  if (locked) next.add(appointment.id);
                  else next.delete(appointment.id);
                  return next;
                })
              }
              onEdit={
                ready
                  ? () => {
                      setFormSources({
                        crews: crews.data!.crews,
                        templates: templates.data!.templates,
                      });
                      setCreating(false);
                      setEditing({ appointment, order });
                    }
                  : undefined
              }
              onSaved={saved}
              onReload={async () => {
                await reload(appointment.id);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function AppointmentEditor({
  order,
  appointment,
  crews,
  templates,
  onSaved,
  onEditingChange,
}: Readonly<{
  order: OrderDetail;
  appointment: AppointmentDetail;
  crews: CrewSummary[];
  templates: TaskTemplateRecord[];
  onSaved: (response: AppointmentResponse) => void;
  onEditingChange?: (editing: boolean) => void;
}>) {
  const [editing, setEditing] = useState<{
      order: OrderDetail;
      appointment: AppointmentDetail;
    } | null>(null),
    [error, setError] = useState<string | null>(null),
    [formLocked, setFormLocked] = useState(false),
    [operationLocked, setOperationLocked] = useState(false);
  useEffect(() => {
    onEditingChange?.(Boolean(editing) || operationLocked);
  }, [editing, operationLocked, onEditingChange]);
  async function reload() {
    const response = await apiRequest<AppointmentResponse>(
      `/orders/${order.id}/appointments/${appointment.id}`,
      { validate: isAppointmentResponse },
    );
    onSaved(response);
    return response;
  }
  return (
    <>
      <Feedback error={error} />
      {editing && (
        <div className="planning-editor tw:my-5 tw:min-w-0 tw:rounded-xl tw:border tw:border-solid tw:border-[#dfe6d8] tw:bg-[#f8faf4] tw:p-5 tw:max-[600px]:p-4">
          <h2>Edit visit</h2>
          <AppointmentForm
            key={`${editing.appointment.id}-${editing.appointment.version}`}
            {...editing}
            crews={crews}
            templates={templates}
            onLockChange={setFormLocked}
            onSaved={(response) => {
              setFormLocked(false);
              onSaved(response);
              setEditing(null);
            }}
            onReload={() => {
              void reload()
                .then((response) => {
                  setFormLocked(false);
                  setEditing(response);
                  setError(null);
                })
                .catch((error) => setError(describeError(error)));
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={formLocked}
            onClick={() => {
              setEditing(null);
            }}
          >
            Close visit editor
          </Button>
        </div>
      )}
      <AppointmentCard
        appointment={appointment}
        readOnly={Boolean(editing)}
        disabled={operationLocked}
        onLockChange={setOperationLocked}
        onEdit={() => {
          setEditing({ order, appointment });
        }}
        onSaved={onSaved}
        onReload={async () => {
          await reload();
        }}
      />
    </>
  );
}
