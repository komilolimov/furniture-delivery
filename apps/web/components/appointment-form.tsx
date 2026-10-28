'use client';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { NativeSelect } from './ui/native-select';
import { Button } from './ui/button';
import { DraftChangeNotice } from './draft-change-notice';

import type {
  AppointmentDetail,
  AppointmentResponse,
  AssignmentTaskEdit,
  CreateAppointmentRequest,
  CrewSummary,
  OrderDetail,
  PlannedTaskInput,
  TaskSeverity,
  TaskTemplateRecord,
  UpdateAppointmentRequest,
} from '@furniture-delivery/contracts';
import { useRef, useState, type FormEvent } from 'react';
import { apiRequest, ApiError, describeError } from '../lib/api-client';
import { businessToday, utcToRomeLocalInput } from '../lib/business-time';
import { isAppointmentResponse, isOrderResponse } from '../lib/order-guards';
import { ordersChanged } from '../lib/use-order-resource';
import { Feedback } from './form-parts';
import './planning.css';

type TaskDraft = PlannedTaskInput & { key: string; name: string; required: boolean };
type AssignmentDraft = { assignmentId: string; crewName: string; tasks: TaskDraft[] };
const suitable = (template: TaskTemplateRecord, order: OrderDetail) =>
  template.active &&
  (template.applicability === 'ALL' || template.applicability === order.serviceType);
export function planningChanged() {
  window.dispatchEvent(new Event('fd:planning-changed'));
  ordersChanged();
}

export function AppointmentForm({
  order,
  appointment,
  crews,
  templates,
  onSaved,
  onReload,
  onOrderReloaded,
  onLockChange,
}: Readonly<{
  order: OrderDetail;
  appointment?: AppointmentDetail;
  crews: CrewSummary[];
  templates: TaskTemplateRecord[];
  onSaved: (response: AppointmentResponse) => void;
  onReload?: () => void;
  onOrderReloaded?: (order: OrderDetail) => void;
  onLockChange?: (locked: boolean) => void;
}>) {
  const followUp = !!appointment?.returnRequestId;
  const [localStart, setLocalStart] = useState(() =>
    appointment ? utcToRomeLocalInput(appointment.plannedStartAt) : `${businessToday()}T09:00`,
  );
  const [duration, setDuration] = useState(
    appointment?.durationMinutes ?? order.estimatedDurationMinutes,
  );
  const [crewIds, setCrewIds] = useState<string[]>(
    () =>
      appointment?.assignments.filter((a) => a.status === 'ASSIGNED').map((a) => a.crewId) ?? [],
  );
  const [templateIds, setTemplateIds] = useState<string[]>([]);
  const [notes, setNotes] = useState(appointment?.notes ?? '');
  const [reason, setReason] = useState('');
  const [assignments, setAssignments] = useState<AssignmentDraft[]>(
    () =>
      appointment?.assignments
        .filter((a) => a.status === 'ASSIGNED')
        .map((a) => ({
          assignmentId: a.id,
          crewName: a.crewName,
          tasks: a.tasks
            .filter((t) => t.active)
            .map((t) => ({
              id: t.id,
              key: t.id,
              name: t.name,
              required: t.required,
              severity: t.severity,
              priority: t.priority,
            })),
        })) ?? [],
  );
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [unknown, setUnknown] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<CreateAppointmentRequest | null>(null);
  const attemptRef = useRef<CreateAppointmentRequest | null>(null),
    busy = useRef(false);
  const available = templates.filter((t) => suitable(t, order));
  function setTask(assignmentId: string, key: string, fields: Partial<TaskDraft>) {
    setAssignments((current) =>
      current.map((a) =>
        a.assignmentId === assignmentId
          ? { ...a, tasks: a.tasks.map((t) => (t.key === key ? { ...t, ...fields } : t)) }
          : a,
      ),
    );
  }
  function clearAttempt() {
    attemptRef.current = null;
    setAttempt(null);
    onLockChange?.(false);
  }
  async function send(body: CreateAppointmentRequest | UpdateAppointmentRequest) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    onLockChange?.(true);
    try {
      const response = await apiRequest<AppointmentResponse>(
        `/orders/${order.id}/appointments${appointment ? `/${appointment.id}` : ''}`,
        { method: appointment ? 'PATCH' : 'POST', body, validate: isAppointmentResponse },
      );
      clearAttempt();
      planningChanged();
      onSaved(response);
    } catch (error) {
      setError(describeError(error));
      if (appointment) {
        const uncertain = error instanceof ApiError && (error.status === 0 || error.status >= 500);
        setUnknown(uncertain);
        onLockChange?.(uncertain);
      } else if (error instanceof ApiError && error.status > 0 && error.status < 500)
        clearAttempt();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || unknown) return;
    if (!appointment && attemptRef.current) {
      void send(attemptRef.current);
      return;
    }
    if (appointment) {
      const tasks: AssignmentTaskEdit[] = assignments
        .filter((a) =>
          appointment.assignments.some(
            (original) => original.id === a.assignmentId && crewIds.includes(original.crewId),
          ),
        )
        .map((a) => ({
          assignmentId: a.assignmentId,
          tasks: a.tasks.map(({ id, templateId, severity, priority }) => ({
            ...(id ? { id } : { templateId }),
            severity,
            priority,
          })),
        }));
      void send({
        expectedVersion: appointment.version,
        localStart,
        durationMinutes: duration,
        crewIds: [...crewIds].sort(),
        notes,
        reason: reason.trim() || undefined,
        ...(followUp ? {} : { tasks }),
      });
    } else {
      const body: CreateAppointmentRequest = Object.freeze({
        localStart,
        durationMinutes: duration,
        crewIds: [...crewIds].sort(),
        templateIds: [...templateIds].sort(),
        notes,
        idempotencyKey: crypto.randomUUID(),
      });
      attemptRef.current = body;
      setAttempt(body);
      void send(body);
    }
  }
  async function startNew() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    onLockChange?.(true);
    try {
      const response = await apiRequest(`/orders/${order.id}`, { validate: isOrderResponse });
      onOrderReloaded?.(response.order);
      clearAttempt();
      setNotice('Visits reloaded. Review the order before intentionally creating another visit.');
    } catch (error) {
      setError(describeError(error));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <form className="appointment-form tw:my-5 tw:grid tw:min-w-0 tw:gap-5" onSubmit={submit}>
      <DraftChangeNotice
        paths={[
          `/orders/${order.id}`,
          ...(appointment ? [`/orders/${order.id}/appointments/${appointment.id}`] : []),
        ]}
      />
      <p className="section-copy">
        All times are Europe/Rome. Duration is the time at the customer; each team also reserves its
        snapshot travel buffer. Long work must be split into several visits.
      </p>
      <fieldset
        className="tw:m-0 tw:min-w-0 tw:border-0 tw:p-0"
        disabled={pending || Boolean(attempt)}
      >
        <div className="form-grid tw:mt-4 tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-4 tw:max-[700px]:grid-cols-1">
          <label>
            Local start (Europe/Rome)
            <Input
              type="datetime-local"
              value={localStart}
              min="1900-01-01T00:00"
              max="9999-12-31T23:59"
              required
              onInput={(e) => setLocalStart(e.currentTarget.value)}
              onChange={(e) => setLocalStart(e.target.value)}
            />
          </label>
          <label>
            Duration (minutes)
            <Input
              type="number"
              min={1}
              max={1440}
              step={1}
              value={duration}
              required
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </label>
          <label className="wide-field tw:col-span-full">
            Notes
            <Textarea
              value={notes}
              maxLength={4000}
              rows={2}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {appointment && (
            <label className="wide-field tw:col-span-full">
              Reason for change
              <Textarea
                aria-label="Reason for change"
                value={reason}
                maxLength={1000}
                rows={2}
                onChange={(e) => setReason(e.target.value)}
              />
              <small>
                Required when changing the visit time or assigned teams. Changing the time clears
                client confirmation.
              </small>
            </label>
          )}
        </div>
        <h3>Assigned teams</h3>
        <p className="section-copy">
          No selection means Unassigned. Inactive teams may be removed from existing visits but
          cannot be newly assigned.
        </p>
        <div className="planning-team-choices tw:my-4 tw:grid tw:grid-cols-2 tw:gap-3 tw:max-[700px]:grid-cols-1">
          {crews.map((crew) => (
            <label
              className="checkbox-field tw:flex tw:min-h-11 tw:min-w-0 tw:items-center tw:gap-2.5 tw:rounded-lg tw:border tw:border-solid tw:border-[#e0e6da] tw:bg-[#fbfcf8] tw:p-3 tw:font-medium"
              key={crew.id}
            >
              <input
                className="tw:size-4 tw:min-h-4 tw:shrink-0 tw:accent-[#28543b]"
                type="checkbox"
                aria-label={`Team ${crew.name}`}
                checked={crewIds.includes(crew.id)}
                disabled={!crew.active && !crewIds.includes(crew.id)}
                onChange={(e) =>
                  setCrewIds((current) =>
                    e.target.checked
                      ? [...current, crew.id]
                      : current.filter((id) => id !== crew.id),
                  )
                }
              />
              {crew.name}
              {!crew.active ? ' (inactive)' : ''}
            </label>
          ))}
        </div>
        {!appointment && (
          <>
            <h3>Task templates</h3>
            <p className="section-copy">
              Required templates for this service are always added to each assigned team by the
              server. Optional templates selected here apply to those teams. An Unassigned visit
              saves no tasks; add optional tasks after assigning a team.
            </p>
            <div className="planning-team-choices tw:my-4 tw:grid tw:grid-cols-2 tw:gap-3 tw:max-[700px]:grid-cols-1">
              {available.map((template) => (
                <label
                  className="checkbox-field tw:flex tw:min-h-11 tw:min-w-0 tw:items-center tw:gap-2.5 tw:rounded-lg tw:border tw:border-solid tw:border-[#e0e6da] tw:bg-[#fbfcf8] tw:p-3 tw:font-medium"
                  key={template.id}
                >
                  <input
                    className="tw:size-4 tw:min-h-4 tw:shrink-0 tw:accent-[#28543b]"
                    type="checkbox"
                    checked={template.required || templateIds.includes(template.id)}
                    disabled={template.required}
                    onChange={(e) =>
                      setTemplateIds((current) =>
                        e.target.checked
                          ? [...current, template.id]
                          : current.filter((id) => id !== template.id),
                      )
                    }
                  />
                  {template.name}
                  {template.required ? ' · required' : ''}
                </label>
              ))}
            </div>
          </>
        )}
        {followUp && (
          <p className="section-copy">
            Follow-up task scope is fixed by its return request. Changing teams preserves unfinished
            task snapshots and provenance; no default templates are added.
          </p>
        )}
        {appointment &&
          !followUp &&
          assignments
            .filter((a) =>
              appointment.assignments.some(
                (original) => original.id === a.assignmentId && crewIds.includes(original.crewId),
              ),
            )
            .map((a) => (
              <section
                className="planning-task-editor"
                key={a.assignmentId}
                aria-label={`Tasks for ${a.crewName}`}
              >
                <h3>Tasks for {a.crewName}</h3>
                <p className="section-copy">
                  Saved task text and required flags are snapshots. Moving a visit preserves them.
                </p>
                {a.tasks.map((task) => (
                  <div className="planning-task-edit" key={task.key}>
                    <strong>
                      {task.name}
                      {task.required ? ' · required' : ''}
                    </strong>
                    <label>
                      Severity for {a.crewName}: {task.name}
                      <NativeSelect
                        value={task.severity}
                        onChange={(e) =>
                          setTask(a.assignmentId, task.key, {
                            severity: e.target.value as TaskSeverity,
                          })
                        }
                      >
                        <option value="LOW">Low</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HIGH">High</option>
                      </NativeSelect>
                    </label>
                    <label>
                      Priority for {a.crewName}: {task.name}
                      <Input
                        type="number"
                        min={0}
                        max={9999}
                        step={1}
                        required
                        value={task.priority}
                        onChange={(e) =>
                          setTask(a.assignmentId, task.key, { priority: Number(e.target.value) })
                        }
                      />
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={task.required}
                      aria-label={`Remove ${a.crewName}: ${task.name}`}
                      onClick={() =>
                        setAssignments((current) =>
                          current.map((row) =>
                            row.assignmentId === a.assignmentId
                              ? { ...row, tasks: row.tasks.filter((t) => t.key !== task.key) }
                              : row,
                          ),
                        )
                      }
                    >
                      Remove optional task
                    </Button>
                  </div>
                ))}
                <label>
                  Add task for {a.crewName}
                  <NativeSelect
                    value=""
                    onChange={(e) => {
                      const template = available.find((t) => t.id === e.target.value);
                      if (template)
                        setAssignments((current) =>
                          current.map((row) =>
                            row.assignmentId === a.assignmentId
                              ? {
                                  ...row,
                                  tasks: [
                                    ...row.tasks,
                                    {
                                      key: crypto.randomUUID(),
                                      templateId: template.id,
                                      name: template.name,
                                      required: template.required,
                                      severity: template.severity,
                                      priority: template.defaultPriority,
                                    },
                                  ],
                                }
                              : row,
                          ),
                        );
                    }}
                  >
                    <option value="">Choose a template</option>
                    {available
                      .filter(
                        (t) =>
                          !a.tasks.some(
                            (task) =>
                              task.templateId === t.id ||
                              appointment.assignments
                                .find((original) => original.id === a.assignmentId)
                                ?.tasks.find((original) => original.id === task.id)?.templateId ===
                                t.id,
                          ),
                      )
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </NativeSelect>
                </label>
              </section>
            ))}
      </fieldset>
      <Feedback error={error} success={notice} />
      {unknown && (
        <p className="conflict-notice">
          The result is unknown. Reload the visit before editing again; no update is retried with a
          newer version automatically. Your draft is retained until you choose to reload.
        </p>
      )}
      {appointment && error && onReload && (
        <Button type="button" variant="outline" disabled={pending} onClick={onReload}>
          Reload visit before editing again
        </Button>
      )}
      {attempt && !pending && (
        <p className="conflict-notice">
          The result may be unknown. Retry sends exactly the same visit details and operation key.
          Check existing visits before intentionally starting another request.
        </p>
      )}
      <div className="button-row tw:flex tw:flex-wrap tw:gap-2">
        <Button type="submit" disabled={pending || unknown}>
          {pending
            ? 'Saving…'
            : appointment
              ? 'Save visit'
              : attempt
                ? 'Retry same visit'
                : 'Create visit'}
        </Button>
        {attempt && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void startNew()}
          >
            Check visits before starting a new request
          </Button>
        )}
      </div>
    </form>
  );
}
