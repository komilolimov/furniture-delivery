'use client';

import type {
  CrewSummary,
  NewReturnTaskInput,
  PlanReturnVisitCommand,
  ReturnItemTarget,
  ReturnRequestDetail,
  ReturnRequestResponse,
  SlotCandidate,
} from '@furniture-delivery/contracts';
import { useState, type FormEvent } from 'react';
import {
  CalendarClock,
  CheckCheck,
  ClipboardList,
  Clock3,
  ListChecks,
  PackageCheck,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api-client';
import { businessToday, displayRome } from '../lib/business-time';
import { isReturnRequestResponse } from '../lib/return-visit-guards';
import { useCommandAttempt } from '../lib/use-command-attempt';
import { Feedback } from './form-parts';
import { SlotFinder } from './slot-finder';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { NativeSelect } from './ui/native-select';
import { Textarea } from './ui/textarea';
import './return-visits.css';
import './return-plan-workspace.css';

type CarryDraft = { include: boolean; crewId: string };
type TargetDraft = { include: boolean; delivered: string; assembled: string };
type NewTaskDraft = NewReturnTaskInput & { key: string };

/** Failed attempts keep their accepted, still-unfulfilled absolute targets. */
export function requiredReturnTargets(detail: ReturnRequestDetail): Map<string, ReturnItemTarget> {
  const result = new Map<string, ReturnItemTarget>();
  for (const attempt of detail.attempts) {
    if (attempt.closedOutcome !== 'FAILED') continue;
    for (const target of attempt.scope.itemTargets) {
      const item = detail.items.find((item) => item.id === target.itemId);
      if (
        !item ||
        (item.deliveredQuantity >= target.deliveredQuantity &&
          item.assembledQuantity >= target.assembledQuantity)
      )
        continue;
      const previous = result.get(target.itemId);
      result.set(target.itemId, {
        itemId: target.itemId,
        deliveredQuantity: Math.max(previous?.deliveredQuantity ?? 0, target.deliveredQuantity),
        assembledQuantity: Math.max(previous?.assembledQuantity ?? 0, target.assembledQuantity),
      });
    }
  }
  return result;
}

function initialTargets(detail: ReturnRequestDetail): Record<string, TargetDraft> {
  const required = requiredReturnTargets(detail);
  return Object.fromEntries(
    detail.items.map((item) => [
      item.id,
      {
        include: required.has(item.id),
        delivered: String(
          Math.max(item.deliveredQuantity, required.get(item.id)?.deliveredQuantity ?? 0),
        ),
        assembled: String(
          Math.max(item.assembledQuantity, required.get(item.id)?.assembledQuantity ?? 0),
        ),
      },
    ]),
  );
}

export function ReturnVisitPlanForm({
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
  const [baseline, setBaseline] = useState(() => structuredClone(detail));
  const [crewIds, setCrewIds] = useState<string[]>([]);
  const [duration, setDuration] = useState('60');
  const [carried, setCarried] = useState<Record<string, CarryDraft>>(() =>
    Object.fromEntries(
      detail.scopeCandidates.map((task) => [task.sourceTaskId, { include: true, crewId: '' }]),
    ),
  );
  const [targets, setTargets] = useState(() => initialTargets(detail));
  const [newTasks, setNewTasks] = useState<NewTaskDraft[]>([]);
  const [candidate, setCandidate] = useState<SlotCandidate | null>(null);
  const [reason, setReason] = useState(''),
    [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false),
    [conflict, setConflict] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const activeCrews = crews.filter((crew) => crew.active);
  const requiredTargets = requiredReturnTargets(baseline);
  const stale = baseline.request.version !== detail.request.version;
  const command = useCommandAttempt<PlanReturnVisitCommand, ReturnRequestResponse>({
    send: async (body) => {
      try {
        return await apiRequest(`/backoffice/return-requests/${baseline.request.id}/plan`, {
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
  function changePlan() {
    setCandidate(null);
    setConfirmed(false);
  }
  function reviewLatest() {
    setBaseline(structuredClone(detail));
    setCarried((previous) =>
      Object.fromEntries(
        detail.scopeCandidates.map((task) => [
          task.sourceTaskId,
          {
            include: task.required || (previous[task.sourceTaskId]?.include ?? true),
            crewId: previous[task.sourceTaskId]?.crewId ?? '',
          },
        ]),
      ),
    );
    const defaults = initialTargets(detail);
    setTargets((previous) =>
      Object.fromEntries(
        Object.entries(defaults).map(([id, target]) => [
          id,
          {
            include: target.include || previous[id]?.include === true,
            delivered: String(
              Math.max(Number(target.delivered), Number(previous[id]?.delivered ?? 0)),
            ),
            assembled: String(
              Math.max(Number(target.assembled), Number(previous[id]?.assembled ?? 0)),
            ),
          },
        ]),
      ),
    );
    setConflict(false);
    changePlan();
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    if (!candidate || !confirmed) {
      setLocalError('Select an available time and confirm the preview before planning.');
      return;
    }
    if (stale || conflict) {
      setLocalError('Refresh and explicitly review the latest request before planning again.');
      return;
    }
    const carriedTasks = baseline.scopeCandidates
      .filter((task) => carried[task.sourceTaskId]?.include)
      .map((task) => ({
        sourceTaskId: task.sourceTaskId,
        crewId: carried[task.sourceTaskId]!.crewId,
      }));
    if (
      !crewIds.length ||
      carriedTasks.some((task) => !crewIds.includes(task.crewId)) ||
      newTasks.some((task) => !crewIds.includes(task.crewId))
    ) {
      setLocalError('Assign each selected task to exactly one selected team.');
      return;
    }
    const itemTargets = baseline.items
      .filter((item) => targets[item.id]?.include)
      .map((item) => ({
        itemId: item.id,
        deliveredQuantity: Number(targets[item.id]!.delivered),
        assembledQuantity: Number(targets[item.id]!.assembled),
      }));
    if (!carriedTasks.length && !newTasks.length && !itemTargets.length) {
      setLocalError('Choose remaining tasks, explicit new work or item targets.');
      return;
    }
    void command.submit({
      operationKey: crypto.randomUUID(),
      expectedVersion: baseline.request.version,
      localStart: candidate.localStart,
      durationMinutes: candidate.durationMinutes,
      crewIds: [...candidate.crewIds],
      carriedTasks,
      newTasks: newTasks.map((task) => ({
        crewId: task.crewId,
        name: task.name,
        description: task.description,
        required: task.required,
        severity: task.severity,
        priority: task.priority,
        reason: task.reason,
      })),
      itemTargets,
      reason: reason.trim(),
      notes: notes.trim(),
    });
  }
  const crewOptions = crewIds
    .map((id) => activeCrews.find((crew) => crew.id === id))
    .filter((crew): crew is CrewSummary => !!crew);
  function taskTeam(value: string, onChange: (crewId: string) => void, label: string) {
    return (
      <label>
        {label}
        <NativeSelect
          required
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setConfirmed(false);
          }}
        >
          <option value="">Choose one team</option>
          {crewOptions.map((crew) => (
            <option key={crew.id} value={crew.id}>
              {crew.name}
            </option>
          ))}
        </NativeSelect>
      </label>
    );
  }
  return (
    <form
      className="return-plan return-plan-workspace"
      onSubmit={submit}
      aria-label="Plan return visit"
    >
      <div className="return-plan-intro">
        <div className="return-plan-symbol">
          <CalendarClock aria-hidden="true" size={22} strokeWidth={1.75} />
        </div>
        <div className="tw:min-w-0">
          <p className="return-plan-kicker">Build the next visit</p>
          <h3>Plan a new follow-up visit</h3>
        </div>
      </div>
      <p className="return-plan-copy">
        Source report and recorded quantities stay unchanged. This creates a new visit for the same
        order, awaiting client confirmation. No tasks are copied from completed templates.
      </p>
      <p className="return-plan-revision">
        <ShieldCheck aria-hidden="true" size={16} />
        <span>
          Draft request revision {baseline.request.version}. A search result does not reserve time.
        </span>
      </p>
      <fieldset disabled={command.locked}>
        <legend>
          <UsersRound aria-hidden="true" size={17} strokeWidth={1.75} />
          Teams and duration
        </legend>
        <p className="return-plan-helper">
          Choose the teams that will attend together, then set the visit length.
        </p>
        {activeCrews.length === 0 && (
          <p className="return-plan-empty">No enabled teams are available to select.</p>
        )}
        <div className="return-grid return-plan-teams">
          {activeCrews.map((crew) => (
            <label className="checkbox-field" key={crew.id}>
              <input
                type="checkbox"
                checked={crewIds.includes(crew.id)}
                onChange={(e) => {
                  setCrewIds((current) =>
                    e.target.checked
                      ? [...current, crew.id]
                      : current.filter((id) => id !== crew.id),
                  );
                  changePlan();
                }}
              />
              {crew.name}
            </label>
          ))}
        </div>
        <label>
          <span className="tw:inline-flex tw:items-center tw:gap-2">
            <Clock3 aria-hidden="true" size={15} />
            Visit duration in minutes
          </span>
          <Input
            type="number"
            min={1}
            max={1440}
            required
            value={duration}
            onChange={(e) => {
              setDuration(e.target.value);
              changePlan();
            }}
          />
        </label>
      </fieldset>
      <fieldset disabled={command.locked}>
        <legend>
          <ListChecks aria-hidden="true" size={17} strokeWidth={1.75} />
          Unfinished carried work
        </legend>
        <p>
          Unselected unfinished work remains unresolved. Completing this attempt does not erase it;
          the request may need another plan.
        </p>
        {baseline.scopeCandidates.length === 0 && (
          <p className="empty-copy">
            No unfinished source tasks. Choose explicit new work or item targets.
          </p>
        )}
        {baseline.scopeCandidates.map((task) => (
          <div className="return-scope-row" key={task.sourceTaskId}>
            <label className="checkbox-field">
              <input
                type="checkbox"
                disabled={task.required}
                checked={carried[task.sourceTaskId]?.include ?? task.required}
                onChange={(e) => {
                  setCarried((current) => ({
                    ...current,
                    [task.sourceTaskId]: {
                      ...current[task.sourceTaskId]!,
                      include: e.target.checked,
                    },
                  }));
                  setConfirmed(false);
                }}
              />
              {task.name} · {task.required ? 'Required' : 'Optional'}
            </label>
            {task.description && <p className="return-text">{task.description}</p>}
            <p className="section-copy">
              Source task {task.sourceTaskId} · {task.resultStatus.toLowerCase()}.
            </p>
            {carried[task.sourceTaskId]?.include &&
              taskTeam(
                carried[task.sourceTaskId]!.crewId,
                (crewId) =>
                  setCarried((current) => ({
                    ...current,
                    [task.sourceTaskId]: { ...current[task.sourceTaskId]!, crewId },
                  })),
                `Team for ${task.name}`,
              )}
          </div>
        ))}
      </fieldset>
      <fieldset disabled={command.locked}>
        <legend>
          <ClipboardList aria-hidden="true" size={17} strokeWidth={1.75} />
          Explicit new work
        </legend>
        <p>
          Use for a new safety check or textual work. Explain why it is needed; old completed work
          is not reset.
        </p>
        {newTasks.length === 0 && (
          <p className="return-plan-empty">
            No additional tasks. Add one only when the follow-up needs new work.
          </p>
        )}
        {newTasks.map((task, index) => {
          const update = (patch: Partial<NewTaskDraft>) => {
            setNewTasks((current) =>
              current.map((row) => (row.key === task.key ? { ...row, ...patch } : row)),
            );
            setConfirmed(false);
          };
          return (
            <div className="return-scope-row" key={task.key}>
              <label>
                New task {index + 1} name
                <Input
                  required
                  maxLength={200}
                  value={task.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </label>
              <label>
                New task {index + 1} description
                <Textarea
                  maxLength={4000}
                  value={task.description}
                  onChange={(e) => update({ description: e.target.value })}
                />
              </label>
              {taskTeam(
                task.crewId,
                (crewId) => update({ crewId }),
                `Team for new task ${index + 1}`,
              )}
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={task.required}
                  onChange={(e) => update({ required: e.target.checked })}
                />
                Required new task
              </label>
              <div className="return-grid">
                <label>
                  New task {index + 1} severity
                  <NativeSelect
                    value={task.severity}
                    onChange={(e) =>
                      update({ severity: e.target.value as NewTaskDraft['severity'] })
                    }
                  >
                    <option>LOW</option>
                    <option>MEDIUM</option>
                    <option>HIGH</option>
                  </NativeSelect>
                </label>
                <label>
                  New task {index + 1} priority
                  <Input
                    type="number"
                    min={0}
                    max={9999}
                    required
                    value={task.priority}
                    onChange={(e) => update({ priority: Number(e.target.value) })}
                  />
                </label>
              </div>
              <label>
                Reason for new task {index + 1}
                <Textarea
                  required
                  maxLength={4000}
                  value={task.reason}
                  onChange={(e) => update({ reason: e.target.value })}
                />
              </label>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNewTasks((current) => current.filter((row) => row.key !== task.key));
                  setConfirmed(false);
                }}
              >
                <Trash2 aria-hidden="true" /> Remove new task {index + 1}
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          disabled={newTasks.length + baseline.scopeCandidates.length >= 100}
          onClick={() => {
            setNewTasks((current) => [
              ...current,
              {
                key: crypto.randomUUID(),
                crewId: '',
                name: '',
                description: '',
                required: true,
                severity: 'MEDIUM',
                priority: 0,
                reason: '',
              },
            ]);
            setConfirmed(false);
          }}
        >
          <Plus aria-hidden="true" /> Add explicit new task
        </Button>
      </fieldset>
      <fieldset disabled={command.locked}>
        <legend>
          <PackageCheck aria-hidden="true" size={17} strokeWidth={1.75} />
          Absolute accumulated item targets
        </legend>
        <p>
          These are order totals to reach, not quantities to add for each team. Unfulfilled targets
          from a failed attempt must stay in the next plan.
        </p>
        {baseline.items.length === 0 && (
          <p className="return-plan-empty">No item targets are available for this order.</p>
        )}
        {baseline.items.map((item) => {
          const draft = targets[item.id]!,
            minimum = requiredTargets.get(item.id);
          const update = (patch: Partial<TargetDraft>) => {
            setTargets((current) => ({
              ...current,
              [item.id]: { ...current[item.id]!, ...patch },
            }));
            setConfirmed(false);
          };
          return (
            <div className="return-scope-row" key={item.id}>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  disabled={!!minimum}
                  checked={draft.include}
                  onChange={(e) => update({ include: e.target.checked })}
                />
                Target: {item.description}
                {minimum ? ' · Required from failed attempt' : ''}
              </label>
              <p>
                Ordered {item.quantity} · delivered {item.deliveredQuantity} · assembled{' '}
                {item.assembledQuantity}.
              </p>
              {draft.include && (
                <div className="return-grid">
                  <label>
                    Delivery target for {item.description}
                    <Input
                      type="number"
                      required
                      min={Math.max(item.deliveredQuantity, minimum?.deliveredQuantity ?? 0)}
                      max={item.quantity}
                      value={draft.delivered}
                      onChange={(e) => update({ delivered: e.target.value })}
                    />
                  </label>
                  <label>
                    Assembly target for {item.description}
                    <Input
                      type="number"
                      required
                      min={Math.max(item.assembledQuantity, minimum?.assembledQuantity ?? 0)}
                      max={
                        item.requiresAssembly ? Math.min(item.quantity, Number(draft.delivered)) : 0
                      }
                      disabled={!item.requiresAssembly}
                      value={draft.assembled}
                      onChange={(e) => update({ assembled: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </fieldset>
      <fieldset disabled={command.locked}>
        <legend>
          <Search aria-hidden="true" size={17} strokeWidth={1.75} />
          Find available time
        </legend>
        <SlotFinder
          query={{
            context: 'RETURN_REQUEST',
            orderId: baseline.request.orderId,
            requestId: baseline.request.id,
            earliestLocal: `${businessToday()}T09:00`,
            durationMinutes: Number(duration),
            crewIds,
            alternativeCrews: false,
          }}
          disabled={
            command.locked ||
            !crewIds.length ||
            !Number.isInteger(Number(duration)) ||
            Number(duration) < 1
          }
          onSelect={(selected) => {
            setCandidate(selected);
            setCrewIds([...selected.crewIds]);
            setConfirmed(false);
          }}
        />
      </fieldset>
      <fieldset disabled={command.locked}>
        <legend>
          <CheckCheck aria-hidden="true" size={17} strokeWidth={1.75} />
          Reason and preview
        </legend>
        <label>
          Reason for return plan
          <Textarea
            required
            maxLength={4000}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setConfirmed(false);
            }}
          />
        </label>
        <label>
          Internal visit notes
          <Textarea maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {candidate ? (
          <div className="return-preview" aria-label="Return visit preview">
            <h4>
              <CalendarClock aria-hidden="true" size={18} /> New visit · same order
            </h4>
            <p>
              {displayRome(candidate.plannedStartAt)} – {displayRome(candidate.plannedEndAt)} ·{' '}
              {candidate.durationMinutes} minutes · Europe/Rome.
            </p>
            <p>Teams: {candidate.crews.map((crew) => crew.name).join(' + ')}.</p>
            <p className="return-text">Reason: {reason || 'Enter a reason before saving.'}</p>
            <p>
              Client confirmation will be required. The source visit and its report remain
              unchanged. Availability is checked again when you submit.
            </p>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Confirm this return visit preview
            </label>
          </div>
        ) : (
          <p className="empty-copy">
            Select a search result to preview; selecting alone does not plan a visit.
          </p>
        )}
      </fieldset>
      <Feedback error={localError ?? command.error} />
      {(conflict || stale) && (
        <div className="conflict-notice">
          <p>
            The request or availability changed. Your draft remains on revision{' '}
            {baseline.request.version}; Refresh does not change its expected version.
          </p>
          <div className="button-row">
            <Button
              type="button"
              variant="outline"
              disabled={command.locked}
              onClick={() => void onRefresh()}
            >
              <RotateCcw aria-hidden="true" /> Refresh current request
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={command.locked || detail.request.status !== 'OPEN'}
              onClick={reviewLatest}
            >
              Use latest request revision and review draft
            </Button>
          </div>
        </div>
      )}
      {command.unknown && (
        <div className="conflict-notice">
          <p>The outcome is unknown. Retry the same saved request before making another plan.</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void command.retry()}
            disabled={command.pending}
          >
            <RotateCcw aria-hidden="true" /> Retry same return plan
          </Button>
        </div>
      )}
      <Button
        type="submit"
        disabled={
          command.locked ||
          !candidate ||
          !confirmed ||
          stale ||
          conflict ||
          detail.request.status !== 'OPEN'
        }
      >
        <CheckCheck aria-hidden="true" />{' '}
        {command.pending ? 'Planning…' : 'Confirm and plan return visit'}
      </Button>
    </form>
  );
}
