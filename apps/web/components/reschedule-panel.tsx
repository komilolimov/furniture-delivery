'use client';
import { DraftChangeNotice } from './draft-change-notice';
import { useState } from 'react';
import type {
  AppointmentDetail,
  AppointmentResponse,
  ApplyRescheduleCommand,
  ApplyRescheduleResponse,
  CrewSummary,
  SlotCandidate,
} from '@furniture-delivery/contracts';
import { apiRequest } from '../lib/api-client';
import { displayRome, utcToRomeLocalInput } from '../lib/business-time';
import { isApplyRescheduleResponse } from '../lib/rescheduling-guards';
import { useCommandAttempt } from '../lib/use-command-attempt';
import { planningChanged } from './appointment-form';
import { Feedback } from './form-parts';
import { SlotFinder } from './slot-finder';
import './rescheduling.css';

function ReschedulePreview({
  before,
  candidate,
  live,
  onSaved,
  onReload,
  onDiscard,
}: {
  before: AppointmentDetail;
  candidate: SlotCandidate;
  live: AppointmentDetail;
  onSaved: (result: AppointmentResponse) => void;
  onReload: () => void;
  onDiscard: () => void;
}) {
  const [reason, setReason] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const command = useCommandAttempt<ApplyRescheduleCommand, ApplyRescheduleResponse>({
    send: (body) =>
      apiRequest(`/orders/${before.orderId}/appointments/${before.id}/reschedule`, {
        method: 'POST',
        body,
        validate: isApplyRescheduleResponse,
      }),
    onSaved: (response) => {
      planningChanged();
      onSaved(response);
      onDiscard();
    },
    onAccessLost: onReload,
  });
  const readOnly =
    live.status !== 'SCHEDULED' || live.assignments.some((a) => a.execution.departedAt !== null);
  const timeChanged =
    candidate.plannedStartAt !== before.plannedStartAt ||
    candidate.plannedEndAt !== before.plannedEndAt;
  return (
    <form
      className="reschedule-preview"
      aria-label="Reschedule preview"
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmed && !readOnly)
          void command.submit({
            operationKey: crypto.randomUUID(),
            expectedVersion: before.version,
            localStart: candidate.localStart,
            durationMinutes: candidate.durationMinutes,
            crewIds: candidate.crewIds,
            reason: reason.trim(),
          });
      }}
    >
      <DraftChangeNotice
        paths={[`/orders/${before.orderId}`, `/orders/${before.orderId}/appointments/${before.id}`]}
      />
      <h3>Review and confirm reschedule</h3>
      <p>
        {before.orderNumber} · same visit {before.id} · draft revision {before.version}.
      </p>
      <p>
        <strong>Before:</strong> {displayRome(before.plannedStartAt)} –{' '}
        {displayRome(before.plannedEndAt)} ·{' '}
        {before.assignments
          .filter((a) => a.status === 'ASSIGNED')
          .map((a) => a.crewName)
          .join(' + ') || 'Unassigned'}
        .
      </p>
      <p>
        <strong>After:</strong> {displayRome(candidate.plannedStartAt)} –{' '}
        {displayRome(candidate.plannedEndAt)} · {candidate.crews.map((c) => c.name).join(' + ')} ·{' '}
        {candidate.durationMinutes} minutes.
      </p>
      {before.returnRequestId &&
        before.assignments.some(
          (assignment) =>
            assignment.status === 'ASSIGNED' && !candidate.crewIds.includes(assignment.crewId),
        ) && (
          <p className="conflict-notice">
            Unfinished follow-up tasks of removed teams will be assigned once to{' '}
            {candidate.crews.find((crew) => crew.id === [...candidate.crewIds].sort()[0])?.name}.
            Kept teams retain their task snapshots. The original accepted scope and execution
            history are preserved.
          </p>
        )}
      <p>
        {timeChanged
          ? 'Changing the customer window resets client confirmation to Needs confirmation.'
          : 'The customer window is unchanged; an existing confirmation is retained.'}{' '}
        Availability is checked again inside the save transaction.
      </p>
      {readOnly && (
        <p className="conflict-notice">
          This visit has started or is cancelled. A new change is blocked; your draft remains
          visible.
        </p>
      )}
      <fieldset disabled={command.locked || readOnly}>
        <label>
          Reschedule reason
          <textarea
            required
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I reviewed the new window, teams and client confirmation requirement
        </label>
      </fieldset>
      <Feedback error={command.error} />
      {command.error && (
        <>
          <p className="conflict-notice">
            The draft keeps its original revision and your reason. Read current data; discard and
            choose a fresh preview before intentionally using a newer revision.
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={command.pending}
            onClick={onReload}
          >
            Read current visit
          </button>
        </>
      )}
      {command.unknown && (
        <>
          <p role="status">
            Save outcome unknown. Retry uses the original operation key and payload.
          </p>
          <button
            type="button"
            className="primary-button"
            disabled={command.pending}
            onClick={() => void command.retry()}
          >
            Retry original reschedule
          </button>
        </>
      )}
      <div className="button-row">
        <button className="primary-button" disabled={command.locked || readOnly || !confirmed}>
          {command.pending ? 'Saving reschedule…' : 'Confirm reschedule'}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={command.locked}
          onClick={onDiscard}
        >
          Discard reschedule preview
        </button>
      </div>
    </form>
  );
}
export function ReschedulePanel({
  appointment,
  crews,
  onSaved,
  onReload,
}: Readonly<{
  appointment: AppointmentDetail;
  crews: CrewSummary[];
  onSaved: (response: AppointmentResponse) => void;
  onReload: () => void;
}>) {
  const [open, setOpen] = useState(false),
    [duration, setDuration] = useState(appointment.durationMinutes);
  const [crewIds, setCrewIds] = useState(() =>
    appointment.assignments
      .filter((a) => a.status === 'ASSIGNED')
      .map((a) => a.crewId)
      .sort(),
  );
  const [preview, setPreview] = useState<{
    before: AppointmentDetail;
    candidate: SlotCandidate;
  } | null>(null);
  const started =
    appointment.status !== 'SCHEDULED' ||
    appointment.assignments.some((a) => a.execution.departedAt !== null);
  return (
    <section className="content-card" aria-label="Find and preview reschedule">
      <h2>Find a new window</h2>
      <p className="section-copy">
        The system suggests; the dispatcher confirms. A started visit keeps its original plan and
        execution history.
      </p>
      {!open && !preview && (
        <button
          type="button"
          className="secondary-button"
          disabled={started}
          onClick={() => setOpen(true)}
        >
          Find available time
        </button>
      )}
      {open && !preview && (
        <>
          <fieldset disabled={started}>
            <legend>Duration and explicitly selected teams</legend>
            <label>
              Search visit duration (minutes)
              <input
                type="number"
                min={1}
                max={1440}
                step={1}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </label>
            <div className="planning-team-choices">
              {crews.map((crew) => (
                <label className="checkbox-field" key={crew.id}>
                  <input
                    type="checkbox"
                    checked={crewIds.includes(crew.id)}
                    disabled={!crew.active && !crewIds.includes(crew.id)}
                    onChange={(e) =>
                      setCrewIds((current) =>
                        e.target.checked
                          ? [...current, crew.id].sort()
                          : current.filter((id) => id !== crew.id),
                      )
                    }
                  />
                  {crew.name} · {crew.workEnvironment.toLowerCase()} · {crew.serviceArea}
                  {crew.active ? '' : ' (inactive)'}
                </label>
              ))}
            </div>
          </fieldset>
          <SlotFinder
            query={{
              context: 'APPOINTMENT',
              orderId: appointment.orderId,
              appointmentId: appointment.id,
              earliestLocal: utcToRomeLocalInput(appointment.plannedStartAt),
              durationMinutes: duration,
              crewIds,
              alternativeCrews: false,
            }}
            disabled={started}
            onSelect={(candidate) =>
              setPreview({ before: structuredClone(appointment), candidate })
            }
          />
        </>
      )}
      {preview && (
        <ReschedulePreview
          key={`${preview.before.version}:${preview.candidate.localStart}:${preview.candidate.crewIds.join(',')}`}
          {...preview}
          live={appointment}
          onSaved={onSaved}
          onReload={onReload}
          onDiscard={() => setPreview(null)}
        />
      )}
    </section>
  );
}
