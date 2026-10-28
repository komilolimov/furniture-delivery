'use client';

import type {
  CrewAvailabilityResponse,
  CrewPlanningConfigRecord,
  CrewUnavailabilityRecord,
  WeeklyWorkingWindow,
} from '@furniture-delivery/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiRequest, ApiError, describeError } from '../lib/api-client';
import { isCrewAvailabilityResponse } from '../lib/planning-guards';
import { displayRome, utcToRomeLocalInput } from '../lib/business-time';
import { useApiResource } from '../lib/use-api-resource';
import { useRealtimeCoordinator } from '../lib/realtime-context';
import { Feedback, ResourceNotice } from './form-parts';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { NativeSelect } from './ui/native-select';
import { Textarea } from './ui/textarea';
import { CalendarDays, Clock3, Plus, RefreshCw, Save, Trash2, TriangleAlert } from 'lucide-react';
import './team-availability.css';

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function changed() {
  window.dispatchEvent(new Event('fd:planning-changed'));
}
function workingWindowError(windows: WeeklyWorkingWindow[], buffer: number): string | null {
  if (!Number.isInteger(buffer) || buffer < 0 || buffer > 180)
    return 'Travel buffer must be a whole number between 0 and 180 minutes.';
  if (windows.length > 49) return 'Use at most 49 working windows per week.';
  const sorted = [...windows].sort(
    (a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime),
  );
  for (let index = 0; index < sorted.length; index++) {
    const window = sorted[index]!;
    if (
      window.weekday < 1 ||
      window.weekday > 7 ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.startTime) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.endTime) ||
      window.startTime >= window.endTime
    )
      return 'Each working window needs a weekday and start before end within one local date.';
    const previous = sorted[index - 1];
    if (previous?.weekday === window.weekday && previous.endTime > window.startTime)
      return `${weekdays[window.weekday - 1]} working windows overlap. Use separate windows for a break.`;
  }
  return null;
}

function WorkingConfiguration({
  config,
  onSaved,
}: Readonly<{
  config: CrewPlanningConfigRecord;
  onSaved: (value: CrewAvailabilityResponse) => void;
}>) {
  // A focus refresh must not silently replace an unsaved working-hours draft or its version.
  const [base, setBase] = useState(config);
  const [windows, setWindows] = useState(() => config.weeklyWindows.map((row) => ({ ...row })));
  const [buffer, setBuffer] = useState(config.travelBufferMinutes);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  function adopt(value: CrewAvailabilityResponse) {
    setBase(value.config);
    setWindows(value.config.weeklyWindows.map((row) => ({ ...row })));
    setBuffer(value.config.travelBufferMinutes);
    onSaved(value);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    setError(null);
    setSuccess(null);
    setConflict(false);
    const validation = workingWindowError(windows, buffer);
    if (validation) {
      setError(validation);
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      const value = await apiRequest<CrewAvailabilityResponse>(`/crews/${config.crewId}/planning`, {
        method: 'PATCH',
        body: {
          expectedVersion: base.version,
          weeklyWindows: windows,
          travelBufferMinutes: buffer,
        },
        validate: isCrewAvailabilityResponse,
      });
      adopt(value);
      changed();
      setSuccess(
        'Working configuration saved. Existing visits and their buffer snapshots were preserved.',
      );
    } catch (error) {
      setError(describeError(error));
      setConflict(error instanceof ApiError && error.status === 409);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function reload() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      adopt(
        await apiRequest<CrewAvailabilityResponse>(`/crews/${config.crewId}/planning`, {
          validate: isCrewAvailabilityResponse,
        }),
      );
      setConflict(false);
    } catch (error) {
      setError(describeError(error));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  function update(index: number, field: Partial<WeeklyWorkingWindow>) {
    setWindows((rows) => rows.map((row, at) => (at === index ? { ...row, ...field } : row)));
  }
  return (
    <form
      className="team-working-form"
      aria-label="Working configuration"
      onSubmit={(event) => void save(event)}
    >
      <fieldset
        disabled={pending}
        className="tw:m-0 tw:grid tw:min-w-0 tw:gap-5 tw:border-0 tw:p-0"
      >
        <div className="team-buffer-panel">
          <div className="tw:flex tw:items-start tw:gap-3">
            <span className="tw:grid tw:size-10 tw:shrink-0 tw:place-items-center tw:rounded-xl tw:bg-[#e7efdf] tw:text-[#527348]">
              <Clock3 size={18} aria-hidden="true" />
            </span>
            <div className="tw:min-w-0">
              <h3 className="tw:mt-0 tw:mb-1 tw:text-sm tw:font-semibold">Time between visits</h3>
              <p className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
                Keep a reserved buffer after each new assignment.
              </p>
            </div>
          </div>
          <label className="team-availability-field">
            Default travel buffer (minutes)
            <Input
              type="number"
              min={0}
              max={180}
              step={1}
              required
              value={buffer}
              onChange={(event) => setBuffer(Number(event.target.value))}
            />
          </label>
        </div>
        <p className="section-copy tw:m-0">
          Europe/Rome local time. The full visit plus its travel buffer must fit one window. Changes
          to the default buffer apply to new assignments; existing snapshots are retained.
        </p>
        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
          <h3 className="tw:m-0 tw:text-sm tw:font-semibold">Weekly working windows</h3>
          <Badge variant="outline">
            {windows.length} draft {windows.length === 1 ? 'window' : 'windows'}
          </Badge>
        </div>
        <p className="section-copy tw:m-0">
          Add more than one window for a break. A day without windows is closed, including weekends
          until you add a window.
        </p>
        {windows.length === 0 && (
          <div className="team-availability-empty">
            <CalendarDays size={22} aria-hidden="true" />
            <p className="empty-copy tw:m-0">
              No working windows: the team is unavailable for new bookings all week.
            </p>
          </div>
        )}
        <div className="tw:grid tw:min-w-0 tw:gap-3">
          {windows.map((window, index) => (
            <div className="team-working-window" key={index}>
              <span className="team-working-window-number">
                Window {String(index + 1).padStart(2, '0')}
              </span>
              <label className="team-availability-field">
                <span aria-hidden="true">Day</span>
                <NativeSelect
                  aria-label={`Window ${index + 1} weekday`}
                  value={window.weekday}
                  onChange={(event) => update(index, { weekday: Number(event.target.value) })}
                >
                  {weekdays.map((label, at) => (
                    <option key={label} value={at + 1}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="team-availability-field">
                <span aria-hidden="true">From</span>
                <Input
                  aria-label={`Window ${index + 1} start`}
                  type="time"
                  required
                  value={window.startTime}
                  onInput={(event) => update(index, { startTime: event.currentTarget.value })}
                  onChange={(event) => update(index, { startTime: event.target.value })}
                />
              </label>
              <label className="team-availability-field">
                <span aria-hidden="true">Until</span>
                <Input
                  aria-label={`Window ${index + 1} end`}
                  type="time"
                  required
                  value={window.endTime}
                  onInput={(event) => update(index, { endTime: event.currentTarget.value })}
                  onChange={(event) => update(index, { endTime: event.target.value })}
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove window ${index + 1}`}
                title={`Remove window ${index + 1}`}
                className="team-working-window-remove"
                onClick={() => setWindows((rows) => rows.filter((_, at) => at !== index))}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          className="tw:w-fit"
          type="button"
          disabled={windows.length >= 49}
          onClick={() =>
            setWindows((rows) => [...rows, { weekday: 1, startTime: '08:00', endTime: '18:00' }])
          }
        >
          <Plus aria-hidden="true" />
          Add working window
        </Button>
      </fieldset>
      <Feedback error={error} success={success} />
      {(conflict || config.version !== base.version) && (
        <div className="conflict-notice">
          <p>
            The server configuration changed. Your draft and original revision are kept. Review it
            before saving again.
          </p>
          <Button type="button" variant="outline" disabled={pending} onClick={() => void reload()}>
            <RefreshCw aria-hidden="true" />
            Discard working-hours draft and reload
          </Button>
        </div>
      )}
      <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e0e6d9] tw:pt-5">
        <p className="tw:m-0 tw:text-[11px] tw:leading-relaxed tw:text-[#73816b]">
          Changes take effect after saving.
        </p>
        <Button type="submit" disabled={pending}>
          <Save aria-hidden="true" />
          {pending ? 'Saving…' : 'Save working hours'}
        </Button>
      </div>
    </form>
  );
}

function UnavailabilityForm({
  crewId,
  interval,
  onSaved,
}: Readonly<{
  crewId: string;
  interval?: CrewUnavailabilityRecord;
  onSaved: (value: CrewAvailabilityResponse) => void;
}>) {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget,
      data = new FormData(form);
    busy.current = true;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const value = await apiRequest<CrewAvailabilityResponse>(
        `/crews/${crewId}/unavailability${interval ? '/' + interval.id : ''}`,
        {
          method: interval ? 'PATCH' : 'POST',
          body: {
            localStart: String(data.get('localStart') ?? ''),
            localEnd: String(data.get('localEnd') ?? ''),
            reason: String(data.get('reason') ?? '').trim(),
            ...(interval ? { active: data.get('active') === 'on' } : {}),
          },
          validate: isCrewAvailabilityResponse,
        },
      );
      onSaved(value);
      changed();
      if (!interval) form.reset();
      setSuccess(
        interval
          ? 'Unavailability updated. Existing bookings were kept for review.'
          : 'Unavailability recorded. Review affected appointments below.',
      );
    } catch (error) {
      setError(describeError(error));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <form
      className="team-unavailability-form"
      aria-label={interval ? `Edit unavailability ${interval.id}` : 'Add unavailability'}
      onSubmit={(event) => void save(event)}
    >
      <fieldset
        disabled={pending}
        className="tw:m-0 tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-4 tw:border-0 tw:p-0 tw:max-[650px]:grid-cols-1"
      >
        <label className="team-availability-field">
          Local start (Europe/Rome)
          <Input
            name="localStart"
            type="datetime-local"
            required
            defaultValue={interval ? utcToRomeLocalInput(interval.startAt) : ''}
          />
        </label>
        <label className="team-availability-field">
          Local end (Europe/Rome)
          <Input
            name="localEnd"
            type="datetime-local"
            required
            defaultValue={interval ? utcToRomeLocalInput(interval.endAt) : ''}
          />
        </label>
        <label className="team-availability-field tw:col-span-full">
          Unavailability reason
          <Textarea
            name="reason"
            required
            minLength={1}
            maxLength={1000}
            rows={2}
            defaultValue={interval?.reason}
          />
        </label>
        {interval && (
          <label className="checkbox-field tw:col-span-full">
            <input type="checkbox" name="active" defaultChecked={interval.active} />
            Unavailability active
          </label>
        )}
      </fieldset>
      <Feedback error={error} success={success} />
      <Button type="submit" variant="outline" className="tw:w-fit" disabled={pending}>
        {interval ? <Save aria-hidden="true" /> : <Plus aria-hidden="true" />}
        {pending ? 'Saving…' : interval ? 'Save unavailability' : 'Add unavailability'}
      </Button>
    </form>
  );
}

export function CrewPlanningEditor({
  crewId,
  active = true,
}: Readonly<{ crewId: string; active?: boolean }>) {
  const live = useRealtimeCoordinator();
  const resource = useApiResource<CrewAvailabilityResponse>(
    `/crews/${crewId}/planning`,
    isCrewAvailabilityResponse,
    { retainDataOnRefresh: true },
  );
  const previousActive = useRef(active);
  useEffect(() => {
    if (previousActive.current !== active) {
      previousActive.current = active;
      if (live) live.invalidate(['crews', 'planning']);
      else void resource.refresh();
      changed();
    }
  }, [active, resource.refresh, live]);
  useEffect(() => {
    if (live) return;
    const refresh = () => {
      void resource.refresh();
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [resource.refresh, live]);
  const data = resource.data;
  function saved(value: CrewAvailabilityResponse) {
    resource.setData(value);
    void resource.refresh();
  }
  return (
    <div className="team-availability">
      <section className="content-card">
        <div className="card-line">
          <div>
            <p className="tw:mt-0 tw:mb-2 tw:text-[10px] tw:font-bold tw:tracking-widest tw:text-[#748669] tw:uppercase">
              Availability · Europe/Rome
            </p>
            <h2 className="tw:m-0">Working hours and travel buffer</h2>
          </div>
          <Button variant="outline" onClick={() => void resource.refresh()}>
            <RefreshCw aria-hidden="true" />
            Refresh availability
          </Button>
        </div>
        {!active && (
          <p className="form-error" role="status">
            This team is inactive. Existing visits remain booked and need attention; new assignments
            are blocked.
          </p>
        )}
        <ResourceNotice
          pending={resource.pending}
          error={resource.error}
          retry={() => void resource.refresh()}
        />
        {data && <WorkingConfiguration config={data.config} onSaved={saved} />}
      </section>
      {data && (
        <section className="content-card">
          <div className="tw:mb-4 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
            <h2 className="tw:m-0">Unavailability</h2>
            <Badge variant="outline">
              {data.unavailability.filter((interval) => interval.active).length} active intervals
            </Badge>
          </div>
          <p className="section-copy">
            Record the actual absence even when a booking exists. It does not silently cancel or
            move visits. All dates and times are Europe/Rome; ambiguous or missing local times are
            rejected.
          </p>
          {data.unavailability.length === 0 && (
            <div className="team-availability-empty">
              <CalendarDays size={22} aria-hidden="true" />
              <p className="empty-copy tw:m-0">No unavailability recorded.</p>
            </div>
          )}
          <div className="tw:my-4 tw:grid tw:min-w-0 tw:gap-3">
            {data.unavailability.map((interval) => (
              <details className="contact-editor team-absence-editor" key={interval.id}>
                <summary>
                  {displayRome(interval.startAt)} – {displayRome(interval.endAt)} ·{' '}
                  {interval.active ? 'Active' : 'Inactive'} · {interval.reason}
                </summary>
                <UnavailabilityForm crewId={crewId} interval={interval} onSaved={saved} />
              </details>
            ))}
            <details className="contact-editor team-absence-editor team-absence-editor-new">
              <summary>
                <Plus size={16} aria-hidden="true" />
                Record new unavailability
              </summary>
              <UnavailabilityForm crewId={crewId} onSaved={saved} />
            </details>
          </div>
          <div className="team-availability-attention">
            <div className="tw:mb-3 tw:flex tw:items-center tw:gap-2">
              <TriangleAlert size={16} aria-hidden="true" className="tw:text-[#9b7b3e]" />
              <h3 className="tw:m-0 tw:text-sm tw:font-semibold">Appointments needing attention</h3>
            </div>
            {data.affectedAppointments.length === 0 ? (
              <p className="empty-copy tw:m-0">
                No active appointments currently affected by this team’s availability.
              </p>
            ) : (
              <ul className="person-list">
                {data.affectedAppointments.map((appointment) => (
                  <li key={appointment.id}>
                    <div>
                      <Link href={`/backoffice/orders/${appointment.orderId}`}>
                        {appointment.orderNumber} · {displayRome(appointment.plannedStartAt)}
                      </Link>
                      <p>
                        {appointment.attention
                          .filter((issue) => issue.crewId === crewId)
                          .map((issue) => issue.message)
                          .join(' ')}
                      </p>
                    </div>
                    <Badge variant="warning">Needs attention</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
