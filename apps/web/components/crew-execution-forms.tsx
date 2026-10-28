'use client';
import { DraftChangeNotice } from './draft-change-notice';

import { useEffect, useState } from 'react';
import type {
  CrewAssignmentDetail,
  CrewAssignmentResponse,
  CrewWorkItem,
  CrewWorkTask,
  DepartCommand,
  ExecutionCommand,
  FinishCommand,
  FulfillmentCommand,
  TaskResultCommand,
  TaskResultStatus,
  TerminalOutcome,
} from '@furniture-delivery/contracts';
import { apiRequest } from '../lib/api-client';
import { isCrewAssignmentResponse } from '../lib/execution-guards';
import { useCommandAttempt } from '../lib/use-command-attempt';
import { Feedback } from './form-parts';
import {
  CheckCheck,
  ClipboardCheck,
  Flag,
  ListChecks,
  MapPin,
  Navigation,
  PackageCheck,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Undo2,
  Wrench,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { NativeSelect } from './ui/native-select';
import { Textarea } from './ui/textarea';
import './crew-actions.css';

type Saved = (response: CrewAssignmentResponse) => void;
interface EditorProps {
  assignmentId: string;
  onSaved: Saved;
  onCancel: () => void;
  onReload: () => void;
  readOnly?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

/** Only presentation ownership: an open editor keeps its original command while locked. */
function useEditorBusy(locked: boolean, onBusyChange?: (busy: boolean) => void) {
  useEffect(() => {
    onBusyChange?.(locked);
    return () => onBusyChange?.(false);
  }, [locked, onBusyChange]);
}
function CommandResult({
  error,
  unknown,
  retry,
  onReload,
}: {
  error: string | null;
  unknown: boolean;
  retry: () => Promise<void>;
  onReload: () => void;
}) {
  return (
    <>
      <Feedback error={error} />
      {unknown && (
        <p className="conflict-notice">
          The result is unknown. Keep this form open. Retry sends the original details and operation
          key.
        </p>
      )}
      {unknown && (
        <Button type="button" onClick={() => void retry()}>
          <RotateCcw aria-hidden="true" />
          Retry original request
        </Button>
      )}
      {error && (
        <Button variant="outline" type="button" onClick={onReload}>
          <RefreshCw aria-hidden="true" />
          Read current assignment
        </Button>
      )}
    </>
  );
}
function EditorHelp() {
  return (
    <p className="section-copy crew-command-help">
      This draft keeps the version shown when you opened it. Reading current data does not replace
      your input. Discard and reopen to use a newer version.
    </p>
  );
}
function ReadOnlyNotice({ readOnly }: { readOnly: boolean }) {
  return readOnly ? (
    <p className="conflict-notice">
      This assignment no longer permits a new result. Your draft is retained for reference. An
      unknown original request can still be retried to confirm its receipt.
    </p>
  ) : null;
}

export function ExecutionActions({
  assignment,
  onSaved,
  disabled,
  onBusyChange,
  onReload,
}: {
  assignment: CrewAssignmentDetail;
  onSaved: Saved;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onReload: () => void;
}) {
  type Step = { action: 'DEPART' | 'ARRIVE' | 'START'; command: ExecutionCommand | DepartCommand };
  const command = useCommandAttempt<Step, CrewAssignmentResponse>({
    send: (payload) =>
      apiRequest(`/crew/assignments/${assignment.id}/actions/${payload.action.toLowerCase()}`, {
        method: 'POST',
        body: payload.command,
        validate: isCrewAssignmentResponse,
      }),
    onSaved,
    onAccessLost: onReload,
  });
  useEffect(() => onBusyChange(command.locked), [command.locked, onBusyChange]);
  const labels = { DEPART: 'Depart', ARRIVE: 'Arrive', START: 'Start work' };
  const icons = { DEPART: Navigation, ARRIVE: MapPin, START: Play };
  return (
    <>
      <div className="button-row crew-step-actions">
        {(['DEPART', 'ARRIVE', 'START'] as const)
          .filter((action) => assignment.allowedActions.includes(action))
          .map((action) => {
            const Icon = icons[action];
            return (
              <Button
                type="button"
                className="tw:w-full tw:min-h-12 tw:text-sm"
                key={action}
                disabled={disabled || command.locked}
                onClick={() =>
                  void command.submit({
                    action,
                    command: {
                      operationKey: crypto.randomUUID(),
                      expectedExecutionVersion: assignment.execution.version,
                      ...(action === 'DEPART'
                        ? { expectedAppointmentVersion: assignment.appointmentVersion }
                        : {}),
                    },
                  })
                }
              >
                <Icon aria-hidden="true" />
                {command.pending ? 'Saving…' : labels[action]}
              </Button>
            );
          })}
      </div>
      {assignment.execution.status === 'NOT_STARTED' && assignment.departureBlockedReason && (
        <p className="conflict-notice">{assignment.departureBlockedReason}</p>
      )}
      <CommandResult
        error={command.error}
        unknown={command.unknown}
        retry={command.retry}
        onReload={onReload}
      />
    </>
  );
}

export function TaskResultForm({
  assignmentId,
  task,
  onSaved,
  onCancel,
  onReload,
  readOnly = false,
  onBusyChange,
}: EditorProps & { task: CrewWorkTask }) {
  const [snapshot] = useState(() => structuredClone(task));
  const [status, setStatus] = useState<TaskResultStatus>(snapshot.resultStatus);
  const [reason, setReason] = useState('');
  const command = useCommandAttempt<TaskResultCommand, CrewAssignmentResponse>({
    send: (payload) =>
      apiRequest(`/crew/assignments/${assignmentId}/tasks/${snapshot.id}/result`, {
        method: 'POST',
        body: payload,
        validate: isCrewAssignmentResponse,
      }),
    onSaved,
    onAccessLost: onReload,
  });
  useEditorBusy(command.locked, onBusyChange);
  return (
    <form
      className="crew-command crew-command-modern"
      aria-label={`Edit task ${snapshot.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (readOnly) return;
        void command.submit({
          operationKey: crypto.randomUUID(),
          expectedTaskVersion: snapshot.resultVersion,
          resultStatus: status,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        });
      }}
    >
      <DraftChangeNotice paths={[`/crew/assignments/${assignmentId}`]} />
      <div className="crew-command-heading">
        <span className="crew-command-symbol">
          <ListChecks aria-hidden="true" size={22} />
        </span>
        <div>
          <p className="crew-command-kicker">Update checklist</p>
          <h3>{snapshot.name}</h3>
        </div>
      </div>
      <EditorHelp />
      <ReadOnlyNotice readOnly={readOnly} />
      <fieldset disabled={command.locked || readOnly}>
        <legend>
          <ClipboardCheck aria-hidden="true" size={16} />
          Task result
        </legend>
        <label>
          Task result
          <NativeSelect
            className="tw:min-h-12 tw:text-base tw:sm:text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskResultStatus)}
          >
            <option value="PENDING">Pending</option>
            <option value="DONE">Done</option>
            {!snapshot.required && <option value="SKIPPED">Skipped</option>}
          </NativeSelect>
        </label>
        <label>
          Reason for checklist change
          <Textarea
            className="tw:text-base tw:sm:text-sm"
            rows={3}
            maxLength={4000}
            value={reason}
            required={
              status === 'SKIPPED' || (status === 'PENDING' && snapshot.resultStatus !== 'PENDING')
            }
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <Button type="submit" className="tw:min-h-12 tw:w-full tw:text-sm">
          <Save aria-hidden="true" />
          {command.pending ? 'Saving…' : 'Save task result'}
        </Button>
      </fieldset>
      <CommandResult
        error={command.error}
        unknown={command.unknown}
        retry={command.retry}
        onReload={onReload}
      />
      <div className="button-row">
        <Button
          variant="outline"
          type="button"
          className="tw:min-h-12 tw:w-full tw:text-sm"
          disabled={command.locked}
          onClick={onCancel}
        >
          <Undo2 aria-hidden="true" />
          Discard draft
        </Button>
      </div>
    </form>
  );
}

export function FulfillmentForm({
  assignmentId,
  item,
  onSaved,
  onCancel,
  onReload,
  readOnly = false,
  onBusyChange,
}: EditorProps & { item: CrewWorkItem }) {
  const [snapshot] = useState(() => structuredClone(item));
  const [delivered, setDelivered] = useState(String(snapshot.deliveredQuantity));
  const [assembled, setAssembled] = useState(String(snapshot.assembledQuantity));
  const [reason, setReason] = useState('');
  const command = useCommandAttempt<FulfillmentCommand, CrewAssignmentResponse>({
    send: (payload) =>
      apiRequest(`/crew/assignments/${assignmentId}/items/${snapshot.id}/fulfillment`, {
        method: 'POST',
        body: payload,
        validate: isCrewAssignmentResponse,
      }),
    onSaved,
    onAccessLost: onReload,
  });
  useEditorBusy(command.locked, onBusyChange);
  return (
    <form
      className="crew-command crew-command-modern"
      aria-label={`Edit quantities ${snapshot.description}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (readOnly) return;
        void command.submit({
          operationKey: crypto.randomUUID(),
          expectedFulfillmentVersion: snapshot.fulfillmentVersion,
          deliveredQuantity: Number(delivered),
          assembledQuantity: Number(assembled),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        });
      }}
    >
      <DraftChangeNotice paths={[`/crew/assignments/${assignmentId}`]} />
      <div className="crew-command-heading">
        <span className="crew-command-symbol">
          <PackageCheck aria-hidden="true" size={22} />
        </span>
        <div>
          <p className="crew-command-kicker">Record order totals</p>
          <h3>{snapshot.description}</h3>
        </div>
      </div>
      <p>
        Accumulated totals for the whole order, including other teams and earlier visits. Previously
        delivered {snapshot.deliveredQuantity}; assembled {snapshot.assembledQuantity}.
      </p>
      <EditorHelp />
      <ReadOnlyNotice readOnly={readOnly} />
      <fieldset disabled={command.locked || readOnly}>
        <legend>
          <Wrench aria-hidden="true" size={16} />
          Delivery and assembly
        </legend>
        <label>
          Delivered in total
          <Input
            className="tw:min-h-12 tw:text-base tw:sm:text-sm"
            type="number"
            min={0}
            max={snapshot.quantity}
            step={1}
            required
            value={delivered}
            onChange={(e) => setDelivered(e.target.value)}
          />
        </label>
        <label>
          Assembled in total
          <Input
            className="tw:min-h-12 tw:text-base tw:sm:text-sm"
            type="number"
            min={0}
            max={snapshot.requiresAssembly ? snapshot.quantity : 0}
            step={1}
            required
            disabled={!snapshot.requiresAssembly}
            value={assembled}
            onChange={(e) => setAssembled(e.target.value)}
          />
        </label>
        {!snapshot.requiresAssembly && (
          <p>No assembly is required for this item; assembled stays zero.</p>
        )}
        <label>
          Reason for quantity correction
          <Textarea
            className="tw:text-base tw:sm:text-sm"
            rows={3}
            maxLength={4000}
            value={reason}
            required={
              Number(delivered) < snapshot.deliveredQuantity ||
              Number(assembled) < snapshot.assembledQuantity
            }
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <Button type="submit" className="tw:min-h-12 tw:w-full tw:text-sm">
          <Save aria-hidden="true" />
          {command.pending ? 'Saving…' : 'Save accumulated quantities'}
        </Button>
      </fieldset>
      <CommandResult
        error={command.error}
        unknown={command.unknown}
        retry={command.retry}
        onReload={onReload}
      />
      <div className="button-row">
        <Button
          variant="outline"
          type="button"
          className="tw:min-h-12 tw:w-full tw:text-sm"
          disabled={command.locked}
          onClick={onCancel}
        >
          <Undo2 aria-hidden="true" />
          Discard draft
        </Button>
      </div>
    </form>
  );
}

export function FinishWorkForm({
  assignment,
  onSaved,
  onCancel,
  onReload,
  currentOpenIssueCount,
  readOnly = false,
  onBusyChange,
}: Omit<EditorProps, 'assignmentId'> & {
  assignment: CrewAssignmentDetail;
  currentOpenIssueCount: number;
}) {
  const [snapshot] = useState(() => structuredClone(assignment));
  const working = snapshot.execution.status === 'IN_PROGRESS';
  const [outcome, setOutcome] = useState<TerminalOutcome>(working ? 'COMPLETED' : 'BLOCKED');
  const [summary, setSummary] = useState(''),
    [reason, setReason] = useState(''),
    [remaining, setRemaining] = useState(''),
    [returnRequired, setReturnRequired] = useState(false),
    [returnReason, setReturnReason] = useState('');
  const command = useCommandAttempt<FinishCommand, CrewAssignmentResponse>({
    send: (payload) =>
      apiRequest(`/crew/assignments/${snapshot.id}/actions/finish`, {
        method: 'POST',
        body: payload,
        validate: isCrewAssignmentResponse,
      }),
    onSaved,
    onAccessLost: onReload,
  });
  useEditorBusy(command.locked, onBusyChange);
  return (
    <form
      className="crew-command crew-command-modern"
      aria-label="Finish my team's visit"
      onSubmit={(e) => {
        e.preventDefault();
        if (readOnly) return;
        void command.submit({
          operationKey: crypto.randomUUID(),
          expectedExecutionVersion: snapshot.execution.version,
          outcome,
          summary: summary.trim(),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(remaining.trim() ? { remainingWork: remaining.trim() } : {}),
          returnVisitRequired: returnRequired,
          ...(returnRequired ? { returnReason: returnReason.trim() } : {}),
        });
      }}
    >
      <DraftChangeNotice paths={[`/crew/assignments/${assignment.id}`]} />
      <div className="crew-command-heading">
        <span className="crew-command-symbol">
          <Flag aria-hidden="true" size={22} />
        </span>
        <div>
          <p className="crew-command-kicker">Your team's result</p>
          <h3>Finish my team's visit</h3>
        </div>
      </div>
      <p>
        This records this team's participation. Quantities remain accumulated order totals. It does
        not sign or close the order.
      </p>
      <p>
        {currentOpenIssueCount} visible open issues. Finishing does not resolve issues or return
        requests.
      </p>
      <EditorHelp />
      <ReadOnlyNotice readOnly={readOnly} />
      <fieldset disabled={command.locked || readOnly}>
        <legend>
          <ShieldCheck aria-hidden="true" size={16} />
          Finish report
        </legend>
        <label>
          Outcome
          <NativeSelect
            className="tw:min-h-12 tw:text-base tw:sm:text-sm"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as TerminalOutcome)}
          >
            {working && (
              <>
                <option value="COMPLETED">Completed my team's work</option>
                <option value="PARTIALLY_COMPLETED">Partially completed</option>
              </>
            )}
            <option value="BLOCKED">Blocked attempt</option>
          </NativeSelect>
        </label>
        <label>
          Result summary
          <Textarea
            className="tw:text-base tw:sm:text-sm"
            required
            maxLength={4000}
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>
        <label>
          Reason for partial or blocked result
          <Textarea
            className="tw:text-base tw:sm:text-sm"
            required={outcome !== 'COMPLETED'}
            maxLength={4000}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <label>
          Remaining work
          <Textarea
            className="tw:text-base tw:sm:text-sm"
            required={outcome !== 'COMPLETED' || returnRequired}
            maxLength={4000}
            rows={3}
            value={remaining}
            onChange={(e) => setRemaining(e.target.value)}
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={returnRequired}
            onChange={(e) => setReturnRequired(e.target.checked)}
          />
          Another visit is required
        </label>
        {returnRequired && (
          <label>
            Reason for another visit
            <Textarea
              className="tw:text-base tw:sm:text-sm"
              required
              maxLength={4000}
              rows={3}
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
            />
          </label>
        )}
        <Button type="submit" className="tw:min-h-12 tw:w-full tw:text-sm">
          <CheckCheck aria-hidden="true" />
          {command.pending ? 'Saving…' : "Finish my team's visit"}
        </Button>
      </fieldset>
      <CommandResult
        error={command.error}
        unknown={command.unknown}
        retry={command.retry}
        onReload={onReload}
      />
      <div className="button-row">
        <Button
          variant="outline"
          type="button"
          className="tw:min-h-12 tw:w-full tw:text-sm"
          disabled={command.locked}
          onClick={onCancel}
        >
          <Undo2 aria-hidden="true" />
          Discard draft
        </Button>
      </div>
    </form>
  );
}
