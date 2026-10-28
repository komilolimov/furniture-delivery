'use client';
import { DraftChangeNotice } from './draft-change-notice';
import { useState } from 'react';
import type {
  AssignmentExecution,
  EstimateCommand,
  EstimateResponse,
} from '@furniture-delivery/contracts';
import { apiRequest } from '../lib/api-client';
import { utcToRomeLocalInput } from '../lib/business-time';
import { formatWorkTime } from '../lib/execution-labels';
import { isEstimateResponse } from '../lib/rescheduling-guards';
import { useCommandAttempt } from '../lib/use-command-attempt';
import { planningChanged } from './appointment-form';
import { Feedback } from './form-parts';
import './rescheduling.css';

interface Props {
  assignmentId: string;
  execution: AssignmentExecution;
  mode: 'crew' | 'backoffice';
  onSaved: () => void;
  disabled?: boolean;
}
function EstimateDraft({
  assignmentId,
  execution,
  mode,
  onSaved,
  onCancel,
  readOnly,
}: Props & { onCancel: () => void; readOnly: boolean }) {
  const [version] = useState(execution.estimateVersion);
  const [localFinish, setLocalFinish] = useState(
    execution.estimatedFinishAt ? utcToRomeLocalInput(execution.estimatedFinishAt) : '',
  );
  const [reason, setReason] = useState(''),
    [clear, setClear] = useState(false);
  const command = useCommandAttempt<EstimateCommand, EstimateResponse>({
    send: (body) =>
      apiRequest(`/${mode === 'crew' ? 'crew' : 'planning'}/assignments/${assignmentId}/estimate`, {
        method: 'POST',
        body,
        validate: isEstimateResponse,
      }),
    onSaved: () => {
      planningChanged();
      onSaved();
      onCancel();
    },
    onAccessLost: onSaved,
  });
  return (
    <form
      className="estimate-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!readOnly)
          void command.submit({
            operationKey: crypto.randomUUID(),
            expectedEstimateVersion: version,
            localFinish: clear ? null : localFinish,
            reason: reason.trim(),
          });
      }}
    >
      <p className="section-copy">
        Expected end of all this team's work, Europe/Rome. The plan and actual timestamps stay
        unchanged. Draft revision {version}; refresh does not replace its version or your input.
      </p>
      <DraftChangeNotice paths={[`/crew/assignments/${assignmentId}`]} />
      {readOnly && (
        <p className="conflict-notice">
          This work is no longer active. Your draft is retained; an unknown original request can
          still be retried.
        </p>
      )}
      <fieldset disabled={command.locked || readOnly}>
        <label className="checkbox-field">
          <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} />
          Explicitly clear the estimate
        </label>
        {!clear && (
          <label>
            Estimated local finish
            <input
              type="datetime-local"
              required
              value={localFinish}
              onChange={(e) => setLocalFinish(e.target.value)}
            />
          </label>
        )}
        <label>
          Reason for estimate change
          <textarea
            required
            maxLength={4000}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </fieldset>
      <Feedback error={command.error} />
      {execution.estimateVersion !== version && (
        <p className="conflict-notice">
          The saved estimate changed. Your input still uses revision {version}; read current data
          and explicitly reopen to adopt a newer revision.
        </p>
      )}
      {command.error && (
        <>
          <p className="conflict-notice">
            Your draft and original revision remain unchanged. Read current data, then discard and
            reopen to intentionally use a newer revision.
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={command.pending}
            onClick={onSaved}
          >
            Read current estimate
          </button>
        </>
      )}
      {command.unknown && (
        <>
          <p role="status">
            The outcome is unknown. Retry sends the original payload and operation key.
          </p>
          <button
            type="button"
            className="primary-button"
            disabled={command.pending}
            onClick={() => void command.retry()}
          >
            Retry original estimate request
          </button>
        </>
      )}
      <div className="button-row">
        <button className="primary-button" disabled={command.locked || readOnly}>
          {command.pending
            ? 'Saving estimate…'
            : clear
              ? 'Clear estimate with reason'
              : 'Save estimate'}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={command.locked}
          onClick={onCancel}
        >
          Discard estimate draft
        </button>
      </div>
    </form>
  );
}
export function AssignmentEstimate(props: Readonly<Props>) {
  const [editing, setEditing] = useState(false);
  const active = ['ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS'].includes(props.execution.status);
  return (
    <section className="estimate-editor" aria-label="Team finish estimate">
      <h4>Team finish estimate</h4>
      <p>
        Estimated finish: {formatWorkTime(props.execution.estimatedFinishAt)}. Actual finish:{' '}
        {formatWorkTime(props.execution.actualEndAt)}.
      </p>
      {props.execution.estimateUpdatedAt && (
        <p className="section-copy">
          Updated {formatWorkTime(props.execution.estimateUpdatedAt)} · author{' '}
          {props.execution.estimateUpdatedBy} · revision {props.execution.estimateVersion}.{' '}
          {props.execution.estimateReason}
        </p>
      )}
      <p className="section-copy">
        An estimate is a forecast, not a promise or a change to the customer window.
      </p>
      {editing ? (
        <EstimateDraft
          {...props}
          onCancel={() => setEditing(false)}
          readOnly={!active || !!props.disabled}
        />
      ) : (
        active && (
          <button
            type="button"
            className="secondary-button"
            disabled={props.disabled}
            onClick={() => setEditing(true)}
          >
            Update finish estimate
          </button>
        )
      )}
    </section>
  );
}
