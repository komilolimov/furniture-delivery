'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type {
  AttachmentRecord,
  AttachmentResponse,
  EvidenceResponse,
  IssueRecord,
} from '@furniture-delivery/contracts';
import { apiRequest, ApiError, describeError } from '../lib/api-client';
import {
  isAttachmentResponse,
  isEvidenceResponse,
  isExecutionNoteResponse,
  isIssueResponse,
} from '../lib/evidence-guards';
import { useCommandAttempt } from '../lib/use-command-attempt';
import { ordersChanged, useOrderResource } from '../lib/use-order-resource';
import { displayRome } from '../lib/business-time';
import { Feedback } from './form-parts';
import {
  CheckCheck,
  Clock3,
  History,
  MessageSquarePlus,
  Package,
  Paperclip,
  RotateCcw,
  UserRound,
} from 'lucide-react';
import { Button, buttonVariants } from './ui/button';
import {
  IssueStatusBadge,
  IssueTypeIcon,
  issueTypeLabel,
  IssueVisibilityBadge,
} from './issue-presentation';
import './evidence.css';
import './issue-detail.css';

type EvidenceScope = { orderId: string } | { assignmentId: string };
type Item = Readonly<{ id: string; description: string; active?: boolean }>;
interface Props {
  scope: EvidenceScope;
  items: readonly Item[];
  canAppend?: boolean;
  onChanged?: () => void;
  onBusyChange?: (busy: boolean) => void;
}
const types = [
  'DAMAGE',
  'MISSING_PARTS',
  'WRONG_PRODUCT',
  'QUANTITY_MISMATCH',
  'ACCESS_PROBLEM',
  'CUSTOMER_UNAVAILABLE',
  'OTHER',
];
const label = (value: string) => value.replaceAll('_', ' ').toLowerCase();
const scopePath = (scope: EvidenceScope) =>
  'assignmentId' in scope ? `/crew/assignments/${scope.assignmentId}` : `/orders/${scope.orderId}`;
const field = (data: FormData, name: string) => String(data.get(name) ?? '').trim();
const optional = (data: FormData, name: string) => field(data, name) || undefined;
const upsert = <T extends { id: string; createdAt: string }>(
  records: readonly T[],
  value: T,
): T[] =>
  [...records.filter((record) => record.id !== value.id), value].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );

function ItemSelect({ items }: Readonly<{ items: readonly Item[] }>) {
  return (
    <label>
      Related item
      <select name="itemId" defaultValue="">
        <option value="">Whole order</option>
        {items
          .filter((item) => item.active !== false)
          .map((item) => (
            <option key={item.id} value={item.id}>
              {item.description}
            </option>
          ))}
      </select>
    </label>
  );
}
function Visibility({ crew }: Readonly<{ crew: boolean }>) {
  return crew ? (
    <p className="field-help">Shared with authorized teams working on this order.</p>
  ) : (
    <label>
      Visibility
      <select name="visibility" aria-label="Visibility" defaultValue="BACKOFFICE_ONLY">
        <option value="BACKOFFICE_ONLY">Backoffice only</option>
        <option value="CREW_VISIBLE">Visible to assigned teams</option>
      </select>
      <span className="field-help">
        Shared material must contain working information only. Files are not automatically checked
        for financial details.
      </span>
    </label>
  );
}

interface CommandFormProps {
  title: string;
  path: string;
  validate: (value: unknown) => boolean;
  values: (data: FormData) => Record<string, unknown>;
  children: ReactNode;
  onSaved: (result?: unknown) => void;
  onLock: (id: string, locked: boolean) => void;
  submitLabel: string;
  onCancel?: () => void;
  requiresReopenAcknowledgement?: boolean;
}
function CommandForm({
  title,
  path,
  validate,
  values,
  children,
  onSaved,
  onLock,
  submitLabel,
  onCancel,
  requiresReopenAcknowledgement = false,
}: CommandFormProps) {
  const id = useId(),
    form = useRef<HTMLFormElement>(null),
    [success, setSuccess] = useState<string | null>(null),
    [confirmationError, setConfirmationError] = useState<string | null>(null);
  const command = useCommandAttempt<Record<string, unknown>, unknown>({
    send: (body) =>
      apiRequest(path, { method: 'POST', body, validate: (v): v is unknown => validate(v) }),
    onSaved: (result) => {
      form.current?.reset();
      setSuccess('Saved. This request was confirmed by the server.');
      onSaved(result);
    },
  });
  useEffect(() => {
    onLock(id, command.locked);
    return () => onLock(id, false);
  }, [id, command.locked, onLock]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (command.locked) return;
    setSuccess(null);
    setConfirmationError(null);
    const data = new FormData(event.currentTarget);
    if (requiresReopenAcknowledgement && data.get('reopenAcknowledged') !== 'on') {
      setConfirmationError(
        'Confirm that reporting or reopening this issue may reopen the completed order.',
      );
      return;
    }
    void command.submit({
      operationKey: crypto.randomUUID(),
      ...values(data),
    });
  }
  return (
    <form ref={form} className="evidence-form" onSubmit={submit} aria-label={title}>
      <h4>{title}</h4>
      <fieldset disabled={command.locked}>
        {children}
        {requiresReopenAcknowledgement && (
          <>
            <p className="conflict-notice">
              If this order is currently completed, reporting or reopening this issue also reopens
              the order. Previous signatures, physical results and completion history are preserved.
              Resolving the issue later does not close the order automatically.
            </p>
            <label className="checkbox-field">
              <input type="checkbox" name="reopenAcknowledged" required />I understand this issue
              may reopen the completed order
            </label>
          </>
        )}
      </fieldset>
      <Feedback error={confirmationError ?? command.error} success={success} />
      {command.unknown && (
        <p role="status">
          The result is unknown. Your original text, request key and destination are retained. Retry
          confirms that same request.
        </p>
      )}
      <div className="form-actions">
        <button disabled={command.pending || command.unknown} type="submit">
          {command.pending ? 'Saving…' : submitLabel}
        </button>
        {command.unknown && (
          <button type="button" disabled={command.pending} onClick={() => void command.retry()}>
            Retry same request
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            className="secondary-button"
            disabled={command.locked}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function IssueCard({
  issue,
  base,
  crew,
  canAppend,
  refresh,
  onLock,
  items,
  files,
  attachmentLinkMode = 'anchor',
}: Readonly<{
  issue: IssueRecord;
  items: readonly Item[];
  files: readonly AttachmentRecord[];
  base: string;
  crew: boolean;
  canAppend: boolean;
  refresh: (result?: unknown) => void;
  onLock: (id: string, locked: boolean) => void;
  attachmentLinkMode?: 'anchor' | 'content';
}>) {
  const [editing, setEditing] = useState<{
      mode: 'resolve' | 'reopen' | 'note';
      snapshot: IssueRecord;
    } | null>(null),
    [version, setVersion] = useState(issue.version),
    [reviewed, setReviewed] = useState<number | null>(null),
    [reviewError, setReviewError] = useState<string | null>(null);
  async function review() {
    setReviewError(null);
    try {
      const response = await apiRequest<EvidenceResponse>(base + '/evidence', {
        validate: isEvidenceResponse,
      });
      const current = response.issues.find((entry) => entry.id === issue.id);
      if (!current) throw new Error('Issue no longer available.');
      setReviewed(current.version);
      refresh();
    } catch (error) {
      setReviewError(describeError(error));
    }
  }
  function edit(mode: 'resolve' | 'reopen' | 'note') {
    setEditing({ mode, snapshot: issue });
    setVersion(issue.version);
    setReviewed(null);
    setReviewError(null);
  }
  return (
    <article
      className="evidence-issue issue-detail tw:rounded-2xl tw:border tw:border-solid tw:border-[#dfe6d8] tw:bg-[#fffefa] tw:p-5 tw:text-[#18372e] tw:max-[600px]:p-4"
      id={`evidence-issue-${issue.id}`}
    >
      <div className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-3">
        <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-3">
          <span className="tw:flex tw:size-11 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-xl tw:border tw:border-solid tw:border-[#e4deca] tw:bg-[#f9f2e2] tw:text-[#92703a]">
            <IssueTypeIcon type={issue.type} className="tw:size-5" />
          </span>
          <div className="tw:min-w-0">
            <p className="tw:m-0 tw:text-[10px] tw:font-semibold tw:tracking-[1.4px] tw:text-[#74806d] tw:uppercase">
              Reported issue
            </p>
            <h4 className="tw:m-0 tw:text-base tw:leading-relaxed tw:font-semibold">
              {issueTypeLabel(issue.type)}
            </h4>
          </div>
        </div>
        <div className="tw:flex tw:flex-wrap tw:gap-2">
          <IssueStatusBadge status={issue.status} />
          <IssueVisibilityBadge visibility={issue.visibility} />
        </div>
      </div>
      <p className="evidence-text tw:my-5 tw:text-sm tw:leading-7">{issue.description}</p>
      <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#e5eadf] tw:bg-[#f6f8f1] tw:p-3 tw:max-[420px]:grid-cols-1">
        <div className="tw:flex tw:min-w-0 tw:items-start tw:gap-2.5">
          <UserRound
            aria-hidden="true"
            size={16}
            className="tw:mt-0.5 tw:size-4 tw:shrink-0 tw:text-[#738269]"
          />
          <div className="tw:min-w-0">
            <p className="tw:m-0 tw:text-[10px] tw:font-semibold tw:text-[#73806b]">Reported by</p>
            <p className="tw:m-0 tw:text-xs tw:leading-6">
              {issue.reportedSource === 'CUSTOMER' ? 'Customer' : 'Crew'}
            </p>
          </div>
        </div>
        <div className="tw:flex tw:min-w-0 tw:items-start tw:gap-2.5">
          <Clock3
            aria-hidden="true"
            size={16}
            className="tw:mt-0.5 tw:size-4 tw:shrink-0 tw:text-[#738269]"
          />
          <div className="tw:min-w-0">
            <p className="tw:m-0 tw:text-[10px] tw:font-semibold tw:text-[#73806b]">
              Reported at · Europe/Rome
            </p>
            <p className="tw:m-0 tw:text-xs tw:leading-6 tw:wrap-anywhere">
              {displayRome(issue.createdAt)}
            </p>
          </div>
        </div>
      </div>
      <p className="tw:mt-3 tw:mb-0 tw:text-[10px] tw:leading-relaxed tw:text-[#7b8573]">
        Updated {displayRome(issue.updatedAt)} · revision {issue.version}
      </p>
      {issue.itemIds.length > 0 && (
        <section aria-label="Related items" className="tw:mt-5 tw:min-w-0">
          <h5 className="tw:m-0 tw:mb-2 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-semibold">
            <Package
              aria-hidden="true"
              size={15}
              className="tw:size-[15px] tw:shrink-0 tw:text-[#738269]"
            />
            Related items{' '}
            <span className="tw:font-normal tw:text-[#74806d]">({issue.itemIds.length})</span>
          </h5>
          <ul className="tw:m-0 tw:grid tw:list-none tw:gap-2 tw:p-0">
            {issue.itemIds.map((id) => (
              <li
                key={id}
                className="tw:rounded-lg tw:border tw:border-solid tw:border-[#e4e9dc] tw:px-3 tw:py-2 tw:text-xs tw:leading-relaxed tw:wrap-anywhere"
              >
                {items.find((item) => item.id === id)?.description ?? id}
              </li>
            ))}
          </ul>
        </section>
      )}
      {issue.attachmentIds.length > 0 && (
        <section aria-label="Related files" className="tw:mt-5 tw:min-w-0">
          <h5 className="tw:m-0 tw:mb-2 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-semibold">
            <Paperclip
              aria-hidden="true"
              size={15}
              className="tw:size-[15px] tw:shrink-0 tw:text-[#738269]"
            />
            Related files{' '}
            <span className="tw:font-normal tw:text-[#74806d]">({issue.attachmentIds.length})</span>
          </h5>
          <ul className="tw:m-0 tw:grid tw:list-none tw:gap-2 tw:p-0">
            {issue.attachmentIds.map((id) => {
              const file = files.find((entry) => entry.id === id);
              return (
                <li key={id} className="tw:min-w-0">
                  {attachmentLinkMode === 'content' && (!file || file.withdrawnAt) ? (
                    <span className="tw:block tw:rounded-lg tw:bg-[#f3f4ee] tw:px-3 tw:py-2.5 tw:text-xs tw:text-[#74806d] tw:wrap-anywhere">
                      {file?.displayName ?? 'Historical attachment'} ·{' '}
                      {file?.withdrawnAt ? 'Withdrawn' : 'Unavailable'}
                    </span>
                  ) : (
                    <a
                      href={
                        attachmentLinkMode === 'content' ? file!.contentUrl : `#evidence-file-${id}`
                      }
                      target={attachmentLinkMode === 'content' ? '_blank' : undefined}
                      rel={attachmentLinkMode === 'content' ? 'noreferrer' : undefined}
                      className={buttonVariants({
                        variant: 'outline',
                        size: 'sm',
                        className: 'tw:w-full tw:justify-start tw:font-medium tw:wrap-anywhere',
                      })}
                    >
                      <Paperclip aria-hidden="true" />
                      {file?.displayName ?? 'Historical attachment'}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {issue.resolution && (
        <section
          aria-label="Saved resolution"
          className="tw:mt-5 tw:rounded-xl tw:border tw:border-solid tw:border-[#d9e6d2] tw:bg-[#edf5e7] tw:p-4"
        >
          <h5 className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-semibold tw:text-[#3f6346]">
            <CheckCheck aria-hidden="true" size={16} className="tw:size-4 tw:shrink-0" />
            Resolution
          </h5>
          <p className="evidence-text tw:mb-0 tw:text-xs tw:leading-6">{issue.resolution}</p>
          {issue.resolvedAt && (
            <p className="tw:mb-0 tw:text-[10px] tw:leading-relaxed tw:text-[#65765c]">
              Resolved {displayRome(issue.resolvedAt)}
            </p>
          )}
        </section>
      )}
      <details className="tw:mt-5 tw:rounded-xl tw:border tw:border-solid tw:border-[#e2e8da] tw:bg-white">
        <summary className="tw:min-h-11 tw:cursor-pointer tw:px-4 tw:py-3 tw:text-xs tw:font-semibold tw:focus-visible:outline-3 tw:focus-visible:outline-solid tw:focus-visible:outline-[#91b88e] tw:focus-visible:outline-offset-2">
          <span className="tw:ml-1 tw:inline-flex tw:items-center tw:gap-2">
            <History
              aria-hidden="true"
              size={15}
              className="tw:size-[15px] tw:shrink-0 tw:text-[#738269]"
            />
            Issue timeline ({issue.events.length})
          </span>
        </summary>
        <ol className="evidence-timeline tw:m-0 tw:gap-4 tw:pr-4 tw:pb-4 tw:pl-8">
          {issue.events.map((event) => (
            <li key={event.id} className="tw:pl-1 tw:text-xs tw:leading-relaxed tw:text-[#61705b]">
              <strong className="tw:font-semibold tw:text-[#345140]">{label(event.kind)}</strong> ·{' '}
              {displayRome(event.createdAt)}
              <p className="evidence-text tw:my-1 tw:leading-6 tw:text-[#18372e]">{event.text}</p>
              <span className="tw:text-[10px] tw:wrap-anywhere">Author {event.actorId}</span>
            </li>
          ))}
        </ol>
      </details>
      {!editing && (
        <div className="tw:mt-5 tw:flex tw:flex-wrap tw:gap-2 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e4e9dc] tw:pt-4">
          {canAppend && (
            <Button variant="outline" onClick={() => edit('note')}>
              <MessageSquarePlus aria-hidden="true" />
              Add issue note
            </Button>
          )}
          {!crew && (
            <Button
              variant={issue.status === 'OPEN' ? 'default' : 'outline'}
              onClick={() => edit(issue.status === 'OPEN' ? 'resolve' : 'reopen')}
            >
              {issue.status === 'OPEN' ? (
                <CheckCheck aria-hidden="true" />
              ) : (
                <RotateCcw aria-hidden="true" />
              )}
              {issue.status === 'OPEN' ? 'Resolve issue' : 'Reopen issue'}
            </Button>
          )}
        </div>
      )}
      {editing && (
        <CommandForm
          key={editing.mode}
          title={
            editing.mode === 'note'
              ? 'Add issue note'
              : editing.mode === 'resolve'
                ? 'Resolve issue'
                : 'Reopen issue'
          }
          path={`${base}/issues/${issue.id}/${editing.mode === 'note' ? 'notes' : editing.mode}`}
          validate={isIssueResponse}
          submitLabel={
            editing.mode === 'note'
              ? 'Save issue note'
              : editing.mode === 'resolve'
                ? 'Resolve issue'
                : 'Reopen issue'
          }
          onLock={onLock}
          requiresReopenAcknowledgement={editing.mode === 'reopen'}
          onSaved={(result) => {
            setEditing(null);
            refresh(result);
          }}
          onCancel={() => setEditing(null)}
          values={(data) =>
            editing.mode === 'note'
              ? { text: field(data, 'text') }
              : { expectedVersion: version, reason: field(data, 'reason') }
          }
        >
          <label>
            {editing.mode === 'note'
              ? 'Issue note'
              : editing.mode === 'resolve'
                ? 'Resolution'
                : 'Reason for reopening'}
            <textarea
              name={editing.mode === 'note' ? 'text' : 'reason'}
              required
              maxLength={4000}
              rows={3}
            />
          </label>
          {editing.mode !== 'note' && (
            <>
              <p className="field-help">
                This draft uses revision {version}. A conflict preserves your text; review the
                current issue before explicitly starting a request with a newer revision.
              </p>
              <button type="button" className="secondary-button" onClick={() => void review()}>
                Review current issue
              </button>
              {reviewed !== null && (
                <>
                  <p role="status">
                    Current revision {reviewed} has been read. Review its saved state above.
                  </p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setVersion(reviewed);
                      setReviewed(null);
                    }}
                  >
                    Use reviewed revision for a new request
                  </button>
                </>
              )}
              <Feedback error={reviewError} />
            </>
          )}
        </CommandForm>
      )}
    </article>
  );
}

interface UploadEntry {
  file: File;
  metadata: Readonly<Record<string, string>>;
}
interface UploadAttempt {
  entries: readonly UploadEntry[];
  index: number;
  unknown: boolean;
  withdrawn: number;
}
function UploadForm({
  base,
  crew,
  items,
  data,
  onSaved,
  onLock,
}: Readonly<{
  base: string;
  crew: boolean;
  items: readonly Item[];
  data: EvidenceResponse;
  onSaved: (result?: unknown) => void;
  onLock: (id: string, locked: boolean) => void;
}>) {
  const id = useId(),
    form = useRef<HTMLFormElement>(null),
    attempt = useRef<UploadAttempt | null>(null),
    selection = useRef<readonly File[]>([]),
    busy = useRef(false),
    alive = useRef(true);
  const [pending, setPending] = useState(false),
    [unknown, setUnknown] = useState(false),
    [retained, setRetained] = useState(false),
    [error, setError] = useState<string | null>(null),
    [status, setStatus] = useState<string | null>(null),
    [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onLock(id, pending || unknown);
    return () => onLock(id, false);
  }, [id, pending, unknown, onLock]);
  async function run(current: UploadAttempt) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      while (current.index < current.entries.length) {
        const entry = current.entries[current.index]!;
        setStatus(
          `Uploading ${current.index + 1} of ${current.entries.length}: ${entry.file.name}`,
        );
        const body = new FormData();
        for (const [key, value] of Object.entries(entry.metadata)) body.append(key, value);
        body.append('file', entry.file);
        try {
          const response = await apiRequest<AttachmentResponse>(base + '/attachments', {
            method: 'POST',
            body,
            timeoutMs: 30_000,
            validate: isAttachmentResponse,
          });
          if (!alive.current || attempt.current !== current) return;
          current.index++;
          if (response.attachment.withdrawnAt) current.withdrawn++;
          current.unknown = false;
          setUnknown(false);
          setStatus(
            response.attachment.withdrawnAt
              ? 'This request was already saved and its file has since been withdrawn.'
              : `${current.index} of ${current.entries.length} files saved.`,
          );
          onSaved(response);
        } catch (failure) {
          if (!alive.current || attempt.current !== current) return;
          current.unknown =
            !(failure instanceof ApiError) || failure.status === 0 || failure.status >= 500;
          setUnknown(current.unknown);
          setError(describeError(failure));
          return;
        }
      }
      if (alive.current && attempt.current === current) {
        attempt.current = null;
        setRetained(false);
        form.current?.reset();
        selection.current = [];
        setStatus(
          current.withdrawn
            ? `Requests confirmed. ${current.withdrawn} withdrawn files remain unavailable.`
            : `All ${current.entries.length} files are saved.`,
        );
      }
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || attempt.current) return;
    const values = new FormData(event.currentTarget);
    const selected = [...selection.current];
    if (!selected.length) {
      setError('Choose at least one file.');
      return;
    }
    const metadata: Record<string, string> = {};
    for (const name of ['itemId', 'issueId', 'proofType', ...(crew ? [] : ['visibility'])]) {
      const value = field(values, name);
      if (value) metadata[name] = value;
    }
    const entries = selected.map((file) =>
      Object.freeze({
        file,
        metadata: Object.freeze({ ...metadata, operationKey: crypto.randomUUID() }),
      }),
    );
    const current: UploadAttempt = { entries, index: 0, unknown: false, withdrawn: 0 };
    attempt.current = current;
    setRetained(true);
    setNames(selected.map((file) => file.name));
    void run(current);
  }
  return (
    <form ref={form} onSubmit={submit} className="evidence-form" aria-label="Upload attachments">
      <h4>{crew ? 'Add work photos' : 'Upload photos or documents'}</h4>
      <fieldset disabled={pending || retained}>
        <label>
          Attachment files
          <input
            name="file"
            type="file"
            multiple
            required
            accept={
              crew
                ? 'image/jpeg,image/png,image/webp'
                : 'image/jpeg,image/png,image/webp,application/pdf'
            }
            capture={crew ? 'environment' : undefined}
            onChange={(event) => {
              selection.current = Array.from(event.currentTarget.files ?? []);
            }}
          />
        </label>
        <p className="field-help">
          Choose files from your device. Files upload one at a time. Images up to{' '}
          {Math.floor(data.limits.imageMaxBytes / 1048576)} MiB;{' '}
          {crew
            ? 'JPEG, PNG or WebP.'
            : `PDF up to ${Math.floor(data.limits.pdfMaxBytes / 1048576)} MiB.`}{' '}
          HEIC is not supported.
        </p>
        <ItemSelect items={items} />
        <label>
          Related issue
          <select name="issueId" defaultValue="">
            <option value="">No issue</option>
            {data.issues.map((issue) => (
              <option key={issue.id} value={issue.id}>
                {label(issue.type)} — {issue.description.slice(0, 80)}
                {issue.visibility === 'BACKOFFICE_ONLY' ? ' (backoffice only)' : ''}
              </option>
            ))}
          </select>
        </label>
        {crew && (
          <label>
            Proof type
            <select name="proofType" required defaultValue="">
              <option value="" disabled>
                Choose proof type
              </option>
              {['DELIVERY', 'ASSEMBLY', 'DAMAGE', 'MISSING_PARTS', 'OTHER'].map((type) => (
                <option key={type} value={type}>
                  {label(type)}
                </option>
              ))}
            </select>
          </label>
        )}
        <Visibility crew={crew} />
      </fieldset>
      {retained && <p className="evidence-text field-help">Retained files: {names.join(', ')}</p>}
      <Feedback error={error} />
      {status && (
        <p role="status" className="evidence-text">
          {status}
        </p>
      )}
      {unknown && (
        <p role="alert">
          Upload result is unknown. The original File, metadata and request key remain in this open
          page. Retry the same upload; do not choose a replacement.
        </p>
      )}
      <div className="form-actions">
        <button type="submit" disabled={pending || retained}>
          Upload files
        </button>
        {retained && (
          <button
            type="button"
            disabled={pending}
            onClick={() => attempt.current && void run(attempt.current)}
          >
            Retry same upload
          </button>
        )}
        {retained && !unknown && !pending && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              attempt.current = null;
              setRetained(false);
              setNames([]);
              setError(null);
              setStatus(null);
            }}
          >
            Choose different files
          </button>
        )}
      </div>
    </form>
  );
}

function FileCard({
  file,
  base,
  crew,
  refresh,
  onLock,
}: Readonly<{
  file: AttachmentRecord;
  base: string;
  crew: boolean;
  refresh: (result?: unknown) => void;
  onLock: (id: string, locked: boolean) => void;
}>) {
  const [withdraw, setWithdraw] = useState(false);
  return (
    <article className="evidence-file" id={`evidence-file-${file.id}`}>
      {file.kind === 'IMAGE' && !file.withdrawnAt && file.thumbnailUrl && (
        <a href={file.contentUrl} target="_blank" rel="noreferrer">
          <img src={file.thumbnailUrl} alt={file.displayName} loading="lazy" />
        </a>
      )}
      <p className="evidence-text">
        <strong>{file.displayName}</strong>
      </p>
      <p className="field-help">
        {file.kind} · {Math.ceil(file.sizeBytes / 1024)} KiB · {displayRome(file.createdAt)} ·{' '}
        {file.visibility === 'BACKOFFICE_ONLY' ? 'Backoffice only' : 'Shared'}
        {file.proofType && ` · ${label(file.proofType)}`}
      </p>
      {file.withdrawnAt ? (
        <p role="status">Withdrawn. Content is no longer available.</p>
      ) : (
        <a href={file.contentUrl} target="_blank" rel="noreferrer">
          {file.kind === 'PDF' ? 'Download PDF attachment' : 'View protected image'}
        </a>
      )}
      {!crew && !file.withdrawnAt && !withdraw && (
        <button type="button" className="secondary-button" onClick={() => setWithdraw(true)}>
          Withdraw file
        </button>
      )}
      {withdraw && (
        <CommandForm
          title="Withdraw attachment"
          path={`${base}/attachments/${file.id}/withdraw`}
          validate={isAttachmentResponse}
          submitLabel="Withdraw file"
          onSaved={(result) => {
            setWithdraw(false);
            refresh(result);
          }}
          onCancel={() => setWithdraw(false)}
          onLock={onLock}
          values={(data) => ({ reason: field(data, 'reason') })}
        >
          <label>
            Withdrawal reason
            <textarea name="reason" required maxLength={4000} rows={3} />
          </label>
          <p className="field-help">
            This retains metadata and report references and blocks further content downloads.
          </p>
        </CommandForm>
      )}
    </article>
  );
}

function EvidenceBody({ scope, items, canAppend = true, onChanged, onBusyChange }: Props) {
  const base = scopePath(scope),
    crew = 'assignmentId' in scope,
    resource = useOrderResource<EvidenceResponse>(base + '/evidence', isEvidenceResponse, {
      retainDataOnRefresh: true,
    }),
    [locks, setLocks] = useState<ReadonlySet<string>>(new Set());
  const onLock = useCallback(
    (id: string, locked: boolean) =>
      setLocks((current) => {
        if (current.has(id) === locked) return current;
        const next = new Set(current);
        if (locked) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  useEffect(() => {
    onBusyChange?.(locks.size > 0);
  }, [locks, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const changed = (result?: unknown) => {
    if (isExecutionNoteResponse(result))
      resource.setData((current) =>
        current ? { ...current, notes: upsert(current.notes, result.note) } : current,
      );
    else if (isIssueResponse(result))
      resource.setData((current) =>
        current ? { ...current, issues: upsert(current.issues, result.issue) } : current,
      );
    else if (isAttachmentResponse(result))
      resource.setData((current) =>
        current
          ? { ...current, attachments: upsert(current.attachments, result.attachment) }
          : current,
      );
    ordersChanged();
    void resource.refresh();
    onChanged?.();
  };
  const data = resource.data;
  return (
    <section className="evidence-panel" aria-label="Notes, issues and protected files">
      <div className="evidence-heading">
        <h3>Notes, issues and files</h3>
        <button type="button" className="secondary-button" onClick={() => void resource.refresh()}>
          Refresh evidence
        </button>
      </div>
      {resource.pending && (
        <p role="status">{data ? 'Refreshing saved evidence…' : 'Loading evidence…'}</p>
      )}
      {resource.error && (
        <div>
          <Feedback error={resource.error} />
          <button
            type="button"
            className="secondary-button"
            onClick={() => void resource.refresh()}
          >
            Retry evidence
          </button>
        </div>
      )}
      {data && (
        <>
          <p className="field-help">
            Saved history shared across authorized visits of this order. Refresh to see changes from
            other devices. File quota: {data.limits.orderMaxFiles} active files /{' '}
            {Math.floor(data.limits.orderMaxBytes / 1048576)} MiB per order.
          </p>
          <section aria-label="Execution notes">
            <h4>Execution notes</h4>
            {!data.notes.length && <p>No execution notes yet.</p>}
            <ol className="evidence-note-list">
              {data.notes.map((note) => (
                <li key={note.id}>
                  <p className="evidence-text">{note.text}</p>
                  <span className="field-help">
                    {displayRome(note.createdAt)} · Author {note.authorId} ·{' '}
                    {note.visibility === 'BACKOFFICE_ONLY' ? 'Backoffice only' : 'Shared'}
                    {note.assignmentId ? ' · Recorded for a team visit' : ''}
                  </span>
                </li>
              ))}
            </ol>
            {canAppend && (
              <CommandForm
                title="Add execution note"
                path={base + '/notes'}
                validate={isExecutionNoteResponse}
                submitLabel="Save execution note"
                onSaved={changed}
                onLock={onLock}
                values={(values) => ({
                  text: field(values, 'text'),
                  itemId: optional(values, 'itemId'),
                  ...(!crew ? { visibility: field(values, 'visibility') } : {}),
                })}
              >
                <label>
                  Execution note
                  <textarea name="text" required maxLength={4000} rows={3} />
                </label>
                <ItemSelect items={items} />
                <Visibility crew={crew} />
                <p className="field-help">
                  Notes are permanent additions. Correct an earlier note by writing a new one.
                </p>
              </CommandForm>
            )}
          </section>
          <section aria-label="Order issues">
            <h4>Issues</h4>
            {!data.issues.length && <p>No issues reported.</p>}
            <div className="evidence-issues">
              {data.issues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  items={items}
                  files={data.attachments}
                  base={base}
                  crew={crew}
                  canAppend={canAppend}
                  refresh={changed}
                  onLock={onLock}
                />
              ))}
            </div>
            {canAppend && (
              <CommandForm
                title="Report issue"
                path={base + '/issues'}
                validate={isIssueResponse}
                submitLabel="Report issue"
                requiresReopenAcknowledgement
                onSaved={changed}
                onLock={onLock}
                values={(values) => ({
                  type: field(values, 'type'),
                  description: field(values, 'description'),
                  reportedSource: field(values, 'reportedSource'),
                  itemIds: values.getAll('itemIds').map(String),
                  attachmentIds: values.getAll('attachmentIds').map(String),
                  notes: optional(values, 'notes'),
                  ...(!crew ? { visibility: field(values, 'visibility') } : {}),
                })}
              >
                <label>
                  Issue type
                  <select name="type" defaultValue="DAMAGE">
                    {types.map((type) => (
                      <option key={type} value={type}>
                        {label(type)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Issue description
                  <textarea name="description" required maxLength={4000} rows={3} />
                </label>
                <label>
                  Reported source
                  <select name="reportedSource" defaultValue="CREW">
                    <option value="CREW">Observed by a team</option>
                    <option value="CUSTOMER">Reported by the customer</option>
                  </select>
                </label>
                <fieldset className="evidence-options">
                  <legend>Related items (optional)</legend>
                  {items
                    .filter((item) => item.active !== false)
                    .map((item) => (
                      <label key={item.id} className="checkbox-field">
                        <input type="checkbox" name="itemIds" value={item.id} />
                        {item.description}
                      </label>
                    ))}
                </fieldset>
                <fieldset className="evidence-options">
                  <legend>Existing photos or documents (optional)</legend>
                  {data.attachments
                    .filter(
                      (file) => !file.withdrawnAt && (!crew || file.visibility === 'CREW_VISIBLE'),
                    )
                    .map((file) => (
                      <label key={file.id} className="checkbox-field">
                        <input type="checkbox" name="attachmentIds" value={file.id} />
                        {file.displayName}{' '}
                        {file.visibility === 'BACKOFFICE_ONLY' ? '(backoffice only)' : ''}
                      </label>
                    ))}
                </fieldset>
                <label>
                  Initial issue note (optional)
                  <textarea name="notes" maxLength={4000} rows={2} />
                </label>
                <Visibility crew={crew} />
              </CommandForm>
            )}
          </section>
          <section aria-label="Protected files">
            <h4>Photos and documents</h4>
            {!data.attachments.length && <p>No files uploaded yet.</p>}
            <div className="evidence-gallery">
              {data.attachments.map((file) => (
                <FileCard
                  key={file.id}
                  file={file}
                  base={base}
                  crew={crew}
                  refresh={changed}
                  onLock={onLock}
                />
              ))}
            </div>
            {canAppend && (
              <UploadForm
                base={base}
                crew={crew}
                items={items}
                data={data}
                onSaved={changed}
                onLock={onLock}
              />
            )}
          </section>
          {!canAppend && (
            <p>Execution notes, issues and photos become available after departure.</p>
          )}
        </>
      )}
    </section>
  );
}

/** A scope change unmounts request state so a late old-assignment result cannot update another card. */
export function EvidencePanel(props: Props) {
  return <EvidenceBody key={scopePath(props.scope)} {...props} />;
}
