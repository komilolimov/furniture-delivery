'use client';
import { useState } from 'react';
import Link from 'next/link';
import type {
  CompleteOrderCommand,
  CompletionBlocker,
  CompletionHistoryResponse,
  CompletionOperationResponse,
  CompletionReadinessRecord,
  CompletionReadinessResponse,
  ReopenOrderCommand,
} from '@furniture-delivery/contracts';
import { apiRequest, ApiError } from '../lib/api-client';
import { displayRome } from '../lib/business-time';
import {
  isCompletionHistoryResponse,
  isCompletionOperationResponse,
  isCompletionReadinessResponse,
} from '../lib/completion-guards';
import { useCommandAttempt } from '../lib/use-command-attempt';
import { ordersChanged, useOrderResource } from '../lib/use-order-resource';
import { Feedback, ResourceNotice } from './form-parts';
import './completion.css';
type Draft = { kind: 'complete' | 'reopen'; readiness: CompletionReadinessRecord };
function blockerHref(orderId: string, blocker: CompletionBlocker): string | null {
  if (blocker.issueId) return `/backoffice/orders/${orderId}#evidence-issue-${blocker.issueId}`;
  if (blocker.requestId) return `/backoffice/return-requests/${blocker.requestId}`;
  if (blocker.appointmentId)
    return `/backoffice/planning/orders/${orderId}/appointments/${blocker.appointmentId}`;
  return null;
}
function ClosureDraft({
  draft,
  live,
  onSaved,
  onReload,
  onDiscard,
  onAccessLost,
}: {
  draft: Draft;
  live: CompletionReadinessRecord;
  onSaved: (response: CompletionOperationResponse) => void;
  onReload: () => void;
  onDiscard: () => void;
  onAccessLost: () => void;
}) {
  const [reason, setReason] = useState(''),
    [reviewed, setReviewed] = useState(false),
    [conflicted, setConflicted] = useState(false);
  const command = useCommandAttempt<
    CompleteOrderCommand | ReopenOrderCommand,
    CompletionOperationResponse
  >({
    send: async (body) => {
      try {
        return await apiRequest(`/orders/${draft.readiness.orderId}/${draft.kind}`, {
          method: 'POST',
          body,
          validate: isCompletionOperationResponse,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) setConflicted(true);
        throw error;
      }
    },
    onSaved,
    onAccessLost,
  });
  const changed =
    live.orderId !== draft.readiness.orderId ||
    live.orderVersion !== draft.readiness.orderVersion ||
    live.currentCompletion?.id !== draft.readiness.currentCompletion?.id;
  const label = draft.kind === 'complete' ? 'Complete order' : 'Reopen order';
  return (
    <form
      className="closure-draft"
      aria-label={`${label} preview`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!reviewed || changed || conflicted || command.locked || !reason.trim()) return;
        const base = {
          operationKey: crypto.randomUUID(),
          expectedVersion: draft.readiness.orderVersion,
          reason: reason.trim(),
        };
        void command.submit(
          draft.kind === 'complete'
            ? base
            : { ...base, expectedCompletionId: draft.readiness.currentCompletion!.id },
        );
      }}
    >
      <h3>{label}: explicit decision</h3>
      <p>
        Draft order revision {draft.readiness.orderVersion}.{' '}
        {draft.kind === 'complete'
          ? `${draft.readiness.snapshotIds.length} visit documents, ${draft.readiness.signatureIds.length} signatures and ${draft.readiness.exceptionIds.length} reviewed exceptions form this decision.`
          : `Current completion ${draft.readiness.currentCompletion!.id} will become historical.`}
      </p>
      <p>
        {draft.kind === 'complete'
          ? 'This records final operational closure. Payment remains independent; an outstanding balance is retained.'
          : 'Reopening preserves all signatures, finish reports, quantities and previous completion records. It does not start work or plan another visit.'}
      </p>
      {(changed || conflicted) && (
        <p className="conflict-notice">
          Current readiness changed or the server rejected this preview. Your draft and original
          revision remain unchanged. Refresh current readiness, then discard this preview and review
          a new one.
        </p>
      )}
      <fieldset disabled={command.locked}>
        <label>
          {label} reason
          <textarea
            required
            maxLength={4000}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            required
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />
          I reviewed this {draft.kind === 'complete' ? 'closure' : 'reopening'} decision and its
          consequences
        </label>
      </fieldset>
      <Feedback error={command.error} />
      {command.error && (
        <button
          type="button"
          className="secondary-button"
          disabled={command.pending}
          onClick={onReload}
        >
          Read current closure conditions
        </button>
      )}
      {command.unknown && (
        <>
          <p role="status">
            The outcome is unknown. Retry sends the original operation key, revision and reason. The
            current server state is shown separately.
          </p>
          <button
            type="button"
            className="primary-button"
            disabled={command.pending}
            onClick={() => void command.retry()}
          >
            Retry original closure request
          </button>
        </>
      )}
      <div className="button-row">
        <button
          className="primary-button"
          disabled={!reviewed || changed || conflicted || command.locked}
        >
          {command.pending
            ? 'Saving decision…'
            : `Confirm ${draft.kind === 'complete' ? 'completion' : 'reopening'}`}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={command.locked}
          onClick={onDiscard}
        >
          Discard closure preview
        </button>
      </div>
    </form>
  );
}
export function CompletionPanel({
  orderId,
  onChanged,
}: Readonly<{ orderId: string; onChanged?: () => void }>) {
  return <CompletionBody key={orderId} orderId={orderId} onChanged={onChanged} />;
}
function CompletionBody({
  orderId,
  onChanged,
}: Readonly<{ orderId: string; onChanged?: () => void }>) {
  const resource = useOrderResource<CompletionReadinessResponse>(
    `/orders/${orderId}/completion-readiness`,
    isCompletionReadinessResponse,
    { retainDataOnRefresh: true },
  );
  const history = useOrderResource<CompletionHistoryResponse>(
    `/orders/${orderId}/completion-history`,
    isCompletionHistoryResponse,
    { retainDataOnRefresh: true },
  );
  const [draft, setDraft] = useState<Draft | null>(null),
    [operation, setOperation] = useState<string | null>(null);
  const readiness = resource.data?.readiness;
  const refresh = () => {
    void resource.refresh();
    void history.refresh();
  };
  const saved = (response: CompletionOperationResponse) => {
    resource.setData({ readiness: response.readiness });
    setDraft(null);
    setOperation(response.receipt?.id ?? 'confirmed');
    ordersChanged();
    void history.refresh();
    onChanged?.();
  };
  return (
    <section
      id="order-completion"
      className="content-card completion-panel"
      aria-label="Final order closure"
    >
      <div className="card-line">
        <h2>Final order closure</h2>
        <button
          type="button"
          className="secondary-button"
          disabled={resource.pending}
          onClick={refresh}
        >
          Refresh closure conditions
        </button>
      </div>
      <p className="section-copy">
        Work, acknowledgements and payments remain separate. Finishing one team, signing a document
        or paying the balance never automatically closes this order.
      </p>
      <ResourceNotice
        pending={resource.pending}
        error={resource.error}
        retry={() => void resource.refresh()}
      />
      {operation && (
        <p className="form-success" role="status">
          The server confirmed operation {operation}. Current order state is shown below.
        </p>
      )}
      {readiness && (
        <>
          <dl className="closure-readiness">
            <div>
              <dt>Physical work</dt>
              <dd>{readiness.physicalReady ? 'Ready' : 'Needs work or review'}</dd>
            </div>
            <div>
              <dt>Visit acknowledgements</dt>
              <dd>{readiness.confirmationsReady ? 'Ready' : 'Missing or awaiting review'}</dd>
            </div>
            <div>
              <dt>Current order state</dt>
              <dd>
                {readiness.currentCompletion ? 'COMPLETED' : 'Open'} · revision{' '}
                {readiness.orderVersion}
              </dd>
            </div>
          </dl>
          {readiness.currentCompletion && (
            <p>
              Closed {displayRome(readiness.currentCompletion.createdAt)} by{' '}
              {readiness.currentCompletion.actorId}. Reason: {readiness.currentCompletion.reason}
            </p>
          )}
          {readiness.blockers.length > 0 && (
            <>
              <h3>Closure conditions to review</h3>
              <ul>
                {readiness.blockers.map((blocker, index) => {
                  const href = blockerHref(orderId, blocker);
                  return (
                    <li key={`${blocker.code}:${index}`}>
                      <strong>{blocker.code.replaceAll('_', ' ')}:</strong> {blocker.message}
                      {href && (
                        <>
                          {' '}
                          <Link href={href}>Review related record</Link>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {!draft && (
            <div className="button-row">
              <button
                type="button"
                className="primary-button"
                disabled={!readiness.canComplete || resource.pending}
                onClick={() => {
                  setDraft({ kind: 'complete', readiness: structuredClone(readiness) });
                  setOperation(null);
                }}
              >
                Review completion
              </button>
              {readiness.currentCompletion && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={resource.pending}
                  onClick={() => {
                    setDraft({ kind: 'reopen', readiness: structuredClone(readiness) });
                    setOperation(null);
                  }}
                >
                  Review reopening
                </button>
              )}
            </div>
          )}
          {draft && (
            <ClosureDraft
              draft={draft}
              live={readiness}
              onSaved={saved}
              onReload={refresh}
              onDiscard={() => setDraft(null)}
              onAccessLost={() => {
                setDraft(null);
                refresh();
              }}
            />
          )}
        </>
      )}
      <details>
        <summary>Completion and reopening history</summary>
        <ResourceNotice
          pending={history.pending}
          error={history.error}
          retry={() => void history.refresh()}
        />
        {history.data && (
          <>
            {!history.data.completions.length && <p>No final completion recorded.</p>}
            <ol>
              {history.data.completions.map((record) => (
                <li key={record.id}>
                  <strong>
                    {(readiness
                      ? (readiness.currentCompletion?.id ?? null)
                      : history.data!.currentCompletionId) === record.id
                      ? 'Current completion'
                      : 'Historical completion'}
                  </strong>{' '}
                  · {displayRome(record.createdAt)} · author {record.actorId}
                  <p>{record.reason}</p>
                  <p className="section-copy">
                    Decision revision {record.readiness.orderVersion} ·{' '}
                    {record.readiness.snapshotIds.length} visit documents ·{' '}
                    {record.readiness.signatureIds.length} signatures ·{' '}
                    {record.readiness.exceptionIds.length} approved exceptions ·{' '}
                    {record.readiness.coverageRequestIds.length} resolved return requests.
                  </p>
                </li>
              ))}
            </ol>
            <ol>
              {history.data.reopenEvents.map((event) => (
                <li key={event.id}>
                  <strong>Reopened</strong> · {displayRome(event.createdAt)} · author{' '}
                  {event.actorId}
                  <p>{event.reason}</p>
                  <p className="section-copy">
                    Previous completion {event.completionId} · source {event.source.toLowerCase()}
                    {event.sourceId ? ` ${event.sourceId}` : ''}.
                  </p>
                </li>
              ))}
            </ol>
          </>
        )}
      </details>
    </section>
  );
}
