'use client';

import type {
  AcceptanceDocumentRecord,
  BackofficeAcceptanceResponse,
  CrewAcceptanceDocumentRecord,
  CrewAcceptanceResponse,
  CrewAcceptanceSlotRecord,
  PrepareAcceptanceCommand,
  SignAcceptanceCommand,
} from '@furniture-delivery/contracts';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { apiRequest, ApiError, describeError } from '../lib/api-client';
import {
  isAcceptanceResponse,
  isBackofficeAcceptanceResponse,
  isCrewAcceptanceResponse,
} from '../lib/acceptance-guards';
import { formatWorkTime } from '../lib/execution-labels';
import { useCommandAttempt } from '../lib/use-command-attempt';
import { useSignatureAttempt } from '../lib/use-signature-attempt';
import { ordersChanged, useOrderResource } from '../lib/use-order-resource';
import { AcceptanceSnapshotPreview } from './acceptance-snapshot';
import { Feedback, ResourceNotice } from './form-parts';
import { SignatureCanvas, type SignatureCanvasHandle } from './signature-canvas';
import './acceptance.css';

type AcceptanceResponse = BackofficeAcceptanceResponse | CrewAcceptanceResponse;
type Document = AcceptanceDocumentRecord | CrewAcceptanceDocumentRecord;
type Editor =
  | { kind: 'sign' | 'absence' | 'review'; document: Document; slot: CrewAcceptanceSlotRecord }
  | { kind: 'invalidate'; document: Document };
const slotLabels: Record<string, string> = {
  MISSING: 'Confirmation missing',
  SIGNED: 'Signed',
  PENDING_REVIEW: 'Absence recorded · dispatcher review pending',
  EXCEPTION_APPROVED: 'Absence reviewed and approved · no signature',
  EXCEPTION_REJECTED: 'Absence rejected · confirmation unresolved',
};
const label = (status: string) => slotLabels[status] ?? status;
const actionPath = (snapshotId: string, slotId: string, action: string) =>
  `/acceptance/${encodeURIComponent(snapshotId)}/slots/${encodeURIComponent(slotId)}/${action}`;

function CustomerModal({
  children,
  onClose,
  locked,
}: Readonly<{ children: ReactNode; onClose: () => void; locked: boolean }>) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="signature-modal"
      aria-modal="true"
      aria-label="Customer acknowledgement"
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
    >
      <h2>Customer acknowledgement</h2>
      <p>
        Please read the recorded visit result before drawing. Your name and relationship are
        declared information; this test application does not verify your identity.
      </p>
      {children}
      <button type="button" className="secondary-button" disabled={locked} onClick={onClose}>
        Back to staff view
      </button>
    </dialog>
  );
}

function SignatureEditor({
  document,
  slot,
  ownAssignmentId,
  currentAllowed,
  onSaved,
  onAccessLost,
  onRefresh,
  onBusy,
}: Readonly<{
  document: Document;
  slot: CrewAcceptanceSlotRecord;
  ownAssignmentId?: string;
  currentAllowed: boolean;
  onSaved: (response: AcceptanceResponse) => void;
  onAccessLost: () => void;
  onRefresh: () => void;
  onBusy: (busy: boolean) => void;
}>) {
  const canvas = useRef<SignatureCanvasHandle>(null);
  const [hasInk, setHasInk] = useState(false),
    [png, setPng] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null),
    [previewBusy, setPreviewBusy] = useState(false);
  const [name, setName] = useState(''),
    [relation, setRelation] = useState(''),
    [consent, setConsent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const attempt = useSignatureAttempt<AcceptanceResponse>({
    onSaved,
    onAccessLost,
    validate: isAcceptanceResponse,
  });
  useEffect(() => {
    if (!png) return;
    const url = URL.createObjectURL(png);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [png]);
  useEffect(() => {
    onBusy(attempt.pending || attempt.unknown);
    return () => onBusy(false);
  }, [attempt.pending, attempt.unknown, onBusy]);
  async function preview() {
    setLocalError(null);
    setPreviewBusy(true);
    try {
      const image = await canvas.current?.exportPng();
      if (!image) {
        setLocalError(
          'Draw a nonempty signature before previewing. If drawing is unavailable, record an absence.',
        );
        return;
      }
      setPng(image);
      setConsent(false);
    } catch {
      setLocalError(
        'The drawing could not be prepared on this device. Record an absence if drawing is unavailable.',
      );
    } finally {
      setPreviewBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    if (!png || !consent || !currentAllowed || (slot.kind === 'CUSTOMER' && !name.trim())) {
      setLocalError(
        'Read the result, enter the customer name when requested, preview the drawing and explicitly acknowledge it.',
      );
      return;
    }
    const metadata: SignAcceptanceCommand = {
      operationKey: crypto.randomUUID(),
      expectedVersion: document.snapshot.version,
      consent: true,
      ...(slot.kind === 'CUSTOMER'
        ? {
            customerName: name.trim(),
            ...(relation.trim() ? { customerRelation: relation.trim() } : {}),
          }
        : {}),
    };
    void attempt.submit(actionPath(document.snapshot.id, slot.id, 'sign'), metadata, png);
  }
  return (
    <form
      className="acceptance-editor"
      aria-label={slot.kind === 'CUSTOMER' ? 'Customer signature' : 'Team signature'}
      onSubmit={submit}
    >
      <AcceptanceSnapshotPreview
        snapshot={document.snapshot}
        ownAssignmentId={slot.kind === 'CREW' ? ownAssignmentId : undefined}
      />
      <p>
        {slot.kind === 'CREW'
          ? 'You confirm only your team’s part. Your account name is recorded by the server.'
          : 'A typed name alone is not a signature. The customer may decline or be unable to sign.'}
      </p>
      <fieldset disabled={attempt.locked || !currentAllowed}>
        <legend>Signature for document revision {document.snapshot.version}</legend>
        {slot.kind === 'CUSTOMER' && (
          <>
            <label>
              Customer or representative name
              <input
                required
                maxLength={200}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setConsent(false);
                }}
              />
            </label>
            <label>
              Relationship to customer (optional)
              <input
                maxLength={200}
                value={relation}
                onChange={(e) => {
                  setRelation(e.target.value);
                  setConsent(false);
                }}
              />
            </label>
          </>
        )}
        <SignatureCanvas
          ref={canvas}
          disabled={attempt.locked || previewBusy || !currentAllowed}
          onChange={(ink) => {
            setHasInk(ink);
            setPng(null);
            setPreviewUrl(null);
            setConsent(false);
          }}
        />
        <button
          type="button"
          className="secondary-button"
          disabled={!hasInk || previewBusy}
          onClick={() => void preview()}
        >
          {previewBusy ? 'Preparing preview…' : 'Preview drawing'}
        </button>
        {previewUrl && (
          <img
            className="signature-preview"
            src={previewUrl}
            alt="Your unsaved signature preview"
          />
        )}
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={consent}
            disabled={!png}
            onChange={(e) => setConsent(e.target.checked)}
          />
          {slot.kind === 'CREW'
            ? 'I acknowledge my team’s recorded part in this result'
            : 'I have read and acknowledge this recorded visit result'}
        </label>
        <button
          className="primary-button"
          disabled={!png || !consent || attempt.locked || !currentAllowed}
        >
          {attempt.pending ? 'Saving signature…' : 'Save this signature'}
        </button>
      </fieldset>
      <Feedback error={localError ?? attempt.error} />
      {(!currentAllowed || attempt.conflict) && (
        <div className="conflict-notice">
          <p>
            The document or confirmation changed. This drawing stays tied to revision{' '}
            {document.snapshot.version}; it will not be attached to another revision.
          </p>
          <button type="button" className="secondary-button" onClick={onRefresh}>
            Read current acknowledgement
          </button>
        </div>
      )}
      {attempt.unknown && (
        <div className="conflict-notice">
          <p>Result unknown. Retry the same PNG, key and document before another signature.</p>
          <button
            type="button"
            className="secondary-button"
            disabled={attempt.pending}
            onClick={() => void attempt.retry()}
          >
            Retry same signature
          </button>
        </div>
      )}
    </form>
  );
}

function FactEditor({
  editor,
  currentAllowed,
  onSaved,
  onRefresh,
  onAccessLost,
  onBusy,
}: Readonly<{
  editor: Exclude<Editor, { kind: 'sign' }>;
  currentAllowed: boolean;
  onSaved: (value: AcceptanceResponse) => void;
  onRefresh: () => void;
  onAccessLost: () => void;
  onBusy: (busy: boolean) => void;
}>) {
  const [reason, setReason] = useState(''),
    [kind, setKind] = useState('ABSENT'),
    [decision, setDecision] = useState('APPROVED');
  const [confirm, setConfirm] = useState(false),
    [conflict, setConflict] = useState(false);
  const snapshot = editor.document.snapshot;
  const path =
    editor.kind === 'invalidate'
      ? `/acceptance/${snapshot.id}/invalidate`
      : actionPath(snapshot.id, editor.slot.id, editor.kind);
  const command = useCommandAttempt<Record<string, unknown>, AcceptanceResponse>({
    send: async (body) => {
      try {
        return await apiRequest(path, { method: 'POST', body, validate: isAcceptanceResponse });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) setConflict(true);
        throw error;
      }
    },
    onSaved,
    onAccessLost,
  });
  useEffect(() => {
    onBusy(command.locked);
    return () => onBusy(false);
  }, [command.locked, onBusy]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentAllowed || conflict || !confirm) return;
    void command.submit({
      operationKey: crypto.randomUUID(),
      expectedVersion: snapshot.version,
      reason: reason.trim(),
      ...(editor.kind === 'absence' ? { kind } : editor.kind === 'review' ? { decision } : {}),
    });
  }
  return (
    <form
      className="acceptance-editor"
      onSubmit={submit}
      aria-label={
        editor.kind === 'absence'
          ? 'Record missing signature'
          : editor.kind === 'review'
            ? 'Review signature absence'
            : 'Invalidate visit document'
      }
    >
      <h4>
        {editor.kind === 'absence'
          ? 'Record refusal, absence or inability to sign'
          : editor.kind === 'review'
            ? 'Review this one missing confirmation'
            : 'Invalidate this document'}
      </h4>
      <p>
        {editor.kind === 'invalidate'
          ? 'Old documents and images remain historical. A new revision needs new confirmations. If the order is closed, this action also reopens it.'
          : editor.kind === 'review'
            ? 'Approval records review of an absence, not a signature. It applies only to this requirement and cannot bypass incomplete work or open issues.'
            : 'No drawing means no signed confirmation. The dispatcher reviews this particular absence separately.'}
      </p>
      <fieldset disabled={command.locked || !currentAllowed}>
        <legend>Document revision {snapshot.version}</legend>
        {editor.kind === 'absence' && (
          <label>
            Absence type
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setConfirm(false);
              }}
            >
              <option value="ABSENT">Signer absent</option>
              <option value="REFUSED">Signer refused</option>
              <option value="UNABLE_TO_SIGN">Unable to sign</option>
            </select>
          </label>
        )}
        {editor.kind === 'review' && (
          <label>
            Exception decision
            <select
              value={decision}
              onChange={(e) => {
                setDecision(e.target.value);
                setConfirm(false);
              }}
            >
              <option value="APPROVED">Approve this absence</option>
              <option value="REJECTED">Reject this absence</option>
            </select>
          </label>
        )}
        <label>
          Explanation
          <textarea
            required
            maxLength={4000}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setConfirm(false);
            }}
          />
        </label>
        <label className="checkbox-field">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          Confirm this explicit action for this document and requirement
        </label>
        <button
          className="primary-button"
          disabled={command.locked || !confirm || conflict || !currentAllowed}
        >
          {command.pending
            ? 'Saving…'
            : editor.kind === 'absence'
              ? 'Save absence for review'
              : editor.kind === 'review'
                ? 'Save exception decision'
                : 'Invalidate document and preserve history'}
        </button>
      </fieldset>
      <Feedback error={command.error} />
      {(conflict || !currentAllowed) && (
        <div className="conflict-notice">
          <p>The document changed. Your explanation and original revision are retained.</p>
          <button type="button" className="secondary-button" onClick={onRefresh}>
            Read current acknowledgement
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
          Retry same acknowledgement action
        </button>
      )}
    </form>
  );
}

function SignatureImage({
  snapshotId,
  signatureId,
}: Readonly<{ snapshotId: string; signatureId: string }>) {
  const [url, setUrl] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState(false);
  const currentUrl = useRef<string | null>(null),
    request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    },
    [],
  );
  async function open() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/acceptance/${encodeURIComponent(snapshotId)}/signatures/${encodeURIComponent(signatureId)}/content`,
        {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        },
      );
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          window.dispatchEvent(
            new Event(response.status === 401 ? 'fd:session-expired' : 'fd:permissions-changed'),
          );
        throw new ApiError(
          response.status,
          'The signature image is unavailable for your current access.',
        );
      }
      if (response.headers.get('content-type')?.split(';')[0] !== 'image/png')
        throw new ApiError(0, 'The service returned an invalid signature image.');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
      currentUrl.current = URL.createObjectURL(blob);
      setUrl(currentUrl.current);
    } catch (failure) {
      if (!controller.signal.aborted) setError(describeError(failure));
    } finally {
      if (request.current === controller) setPending(false);
    }
  }
  return (
    <div>
      <button
        type="button"
        className="secondary-button"
        disabled={pending}
        onClick={() => void open()}
      >
        {pending
          ? 'Reading signature…'
          : url
            ? 'Reload protected signature image'
            : 'Open protected signature image'}
      </button>
      {url && <img src={url} className="signature-preview" alt="Recorded signature" />}
      <Feedback error={error} />
    </div>
  );
}

type AcceptancePanelProps = Readonly<{
  scope: { assignmentId: string } | { orderId: string; appointmentId: string };
  onChanged?: () => void;
}>;
export function VisitAcceptancePanel(props: AcceptancePanelProps) {
  const identity =
    'assignmentId' in props.scope
      ? `crew:${props.scope.assignmentId}`
      : `office:${props.scope.orderId}:${props.scope.appointmentId}`;
  return <AcceptanceWork key={identity} {...props} />;
}
function AcceptanceWork({ scope, onChanged }: AcceptancePanelProps) {
  const crew = 'assignmentId' in scope;
  const path = crew
    ? `/crew/assignments/${scope.assignmentId}/acceptance`
    : `/orders/${scope.orderId}/appointments/${scope.appointmentId}/acceptance`;
  const validate = crew ? isCrewAcceptanceResponse : isBackofficeAcceptanceResponse;
  const resource = useOrderResource<AcceptanceResponse>(path, validate, {
    retainDataOnRefresh: true,
  });
  const [editor, setEditor] = useState<Editor | null>(null),
    [busy, setBusy] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  const body = resource.data?.acceptance,
    current = body?.current;
  const ownAssignmentId = body && 'ownAssignmentId' in body ? body.ownAssignmentId : undefined;
  function lost() {
    setEditor(null);
    setBusy(false);
    setAccessLost(true);
    resource.setData(null);
  }
  useEffect(() => {
    const clear = () => {
      setEditor(null);
      setBusy(false);
      setAccessLost(true);
      resource.setData(null);
    };
    window.addEventListener('fd:session-expired', clear);
    window.addEventListener('fd:permissions-changed', clear);
    return () => {
      window.removeEventListener('fd:session-expired', clear);
      window.removeEventListener('fd:permissions-changed', clear);
    };
  }, [resource.setData]);
  function saved(response: AcceptanceResponse) {
    setEditor(null);
    setBusy(false);
    resource.setData(response);
    ordersChanged();
    onChanged?.();
  }
  const prepare = useCommandAttempt<PrepareAcceptanceCommand, AcceptanceResponse>({
    send: (body) => apiRequest<AcceptanceResponse>(path, { method: 'POST', body, validate }),
    onSaved: saved,
    onAccessLost: lost,
  });
  const latestSlot =
    editor && 'slot' in editor
      ? current?.slots.find((slot) => slot.id === editor.slot.id)
      : undefined;
  const validDocument =
    !!editor &&
    current?.snapshot.id === editor.document.snapshot.id &&
    !current.snapshot.invalidatedAt;
  const allowed =
    validDocument &&
    (editor?.kind === 'invalidate'
      ? !crew
      : editor?.kind === 'sign'
        ? latestSlot?.maySign
        : editor?.kind === 'absence'
          ? latestSlot?.mayReportAbsence
          : latestSlot && 'mayReview' in latestSlot && latestSlot.mayReview === true);
  const editorBody =
    editor?.kind === 'sign' ? (
      <SignatureEditor
        document={editor.document}
        slot={editor.slot}
        ownAssignmentId={ownAssignmentId}
        currentAllowed={!!allowed}
        onSaved={saved}
        onAccessLost={lost}
        onRefresh={() => void resource.refresh()}
        onBusy={setBusy}
      />
    ) : editor ? (
      <FactEditor
        editor={editor}
        currentAllowed={!!allowed}
        onSaved={saved}
        onAccessLost={lost}
        onRefresh={() => void resource.refresh()}
        onBusy={setBusy}
      />
    ) : null;
  function documentView(document: Document, historical = false) {
    return (
      <div key={document.snapshot.id}>
        <AcceptanceSnapshotPreview snapshot={document.snapshot} ownAssignmentId={ownAssignmentId} />
        <div className="return-request-list">
          {document.slots.map((slot) => (
            <article className="acceptance-slot" key={slot.id}>
              <h4>
                {slot.kind === 'CUSTOMER'
                  ? 'Customer / representative'
                  : `${document.snapshot.payload.teams.find((team) => team.assignmentId === slot.assignmentId)?.crewName ?? 'Team'} representative`}
              </h4>
              <p>{label(slot.status)}</p>
              {slot.confirmation?.method === 'SIGNED' && (
                <p>
                  {slot.confirmation.signerName}
                  {slot.confirmation.signerRelation
                    ? ` · ${slot.confirmation.signerRelation}`
                    : ''}{' '}
                  · recorded {formatWorkTime(slot.confirmation.recordedAt)}.
                </p>
              )}
              {slot.confirmation?.method === 'ABSENCE' && (
                <p>
                  {slot.confirmation.absenceKind}: {slot.confirmation.absenceReason}
                </p>
              )}
              {slot.exception && (
                <p>
                  Dispatcher {slot.exception.decision.toLowerCase()}: {slot.exception.reason} ·{' '}
                  {formatWorkTime(slot.exception.reviewedAt)}.
                </p>
              )}
              {slot.canReadImage && slot.confirmation?.method === 'SIGNED' && (
                <SignatureImage
                  snapshotId={document.snapshot.id}
                  signatureId={slot.confirmation.id}
                />
              )}
              {!historical && (
                <div className="button-row">
                  {slot.maySign && (
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy || !!editor || prepare.locked}
                      onClick={() =>
                        setEditor({
                          kind: 'sign',
                          document: structuredClone(document),
                          slot: structuredClone(slot),
                        })
                      }
                    >
                      {slot.kind === 'CUSTOMER'
                        ? 'Open customer signing mode'
                        : 'Sign my team’s result'}
                    </button>
                  )}
                  {slot.mayReportAbsence && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || !!editor || prepare.locked}
                      onClick={() =>
                        setEditor({
                          kind: 'absence',
                          document: structuredClone(document),
                          slot: structuredClone(slot),
                        })
                      }
                    >
                      Record missing {slot.kind === 'CUSTOMER' ? 'customer' : 'team'} signature
                    </button>
                  )}
                  {!crew && 'mayReview' in slot && slot.mayReview && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || !!editor || prepare.locked}
                      onClick={() =>
                        setEditor({
                          kind: 'review',
                          document: structuredClone(document),
                          slot: structuredClone(slot),
                        })
                      }
                    >
                      Review this absence
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    );
  }
  const customerMode = editor?.kind === 'sign' && editor.slot.kind === 'CUSTOMER';
  return (
    <section className="content-card acceptance-panel" aria-label="Visit acknowledgement">
      <div className="card-line">
        <div>
          <h2>Visit acknowledgement</h2>
          <p>
            Signature capture in this test application confirms a recorded result. It is not
            identity verification or a certified signature service.
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={resource.pending || busy}
          onClick={() => {
            setAccessLost(false);
            void resource.refresh();
          }}
        >
          Refresh acknowledgement
        </button>
      </div>
      <ResourceNotice
        pending={resource.pending}
        error={resource.error}
        retry={() => void resource.refresh()}
      />
      {accessLost && (
        <p className="form-error" role="alert">
          Sensitive drafts and previews were cleared because access changed.
        </p>
      )}
      {body && (
        <>
          {!current && (
            <>
              <p>
                {body.preparationBlockedReason ??
                  'No current recorded visit result has been prepared.'}
              </p>
              <button
                type="button"
                className="primary-button"
                disabled={!body.canPrepare || prepare.locked}
                onClick={() => void prepare.submit({ operationKey: crypto.randomUUID() })}
              >
                {prepare.pending ? 'Preparing…' : 'Prepare recorded visit result'}
              </button>
            </>
          )}
          <Feedback error={prepare.error} />
          {prepare.unknown && (
            <button
              type="button"
              className="secondary-button"
              disabled={prepare.pending}
              onClick={() => void prepare.retry()}
            >
              Retry same preparation
            </button>
          )}
          {current && documentView(current)}
          {current && !crew && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !!editor}
              onClick={() => setEditor({ kind: 'invalidate', document: structuredClone(current) })}
            >
              Invalidate recorded document with reason
            </button>
          )}
          {editor && !customerMode && (
            <>
              <div>{editorBody}</div>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                Close acknowledgement editor
              </button>
            </>
          )}
          {editor && customerMode && (
            <CustomerModal locked={busy} onClose={() => setEditor(null)}>
              {editorBody}
            </CustomerModal>
          )}
          {body.history
            .filter((document) => document.snapshot.id !== current?.snapshot.id)
            .map((document) => (
              <details className="acceptance-history" key={document.snapshot.id}>
                <summary>
                  Historical document revision {document.snapshot.version} ·{' '}
                  {document.snapshot.invalidatedAt ? 'invalidated' : 'recorded'}
                </summary>
                {documentView(document, true)}
              </details>
            ))}
          <p className="section-copy">
            Acknowledgement does not change tasks, quantities, issues or return needs. Final order
            closure is a separate dispatcher decision.
          </p>
        </>
      )}
    </section>
  );
}
