import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import type { AttachmentResponse, EvidenceResponse } from '@furniture-delivery/contracts';
import {
  emptyEvidence,
  evidenceAssignmentId,
  evidenceFile,
  evidenceFixture,
  evidenceIssue,
  evidenceItems,
  evidenceNote,
  evidenceOrderId,
} from '../test/evidence-fixture';
import { EvidencePanel } from './evidence-panel';
vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const api = vi.mocked(apiRequest);
const props = { scope: { orderId: evidenceOrderId }, items: evidenceItems };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};
const mutations = () => api.mock.calls.filter(([, options]) => options?.method === 'POST');
beforeEach(() => {
  api.mockReset();
});
describe('M5 evidence UI', () => {
  it('renders loading, saved empty state and readonly crew availability without a mutation form', async () => {
    const loaded = deferred<EvidenceResponse>();
    api.mockReturnValue(loaded.promise);
    render(
      <EvidencePanel
        scope={{ assignmentId: evidenceAssignmentId }}
        items={evidenceItems}
        canAppend={false}
      />,
    );
    expect(screen.getByText('Loading evidence…')).toBeInTheDocument();
    await act(async () => loaded.resolve(emptyEvidence));
    expect(screen.getByText('No execution notes yet.')).toBeInTheDocument();
    expect(screen.getByText('No issues reported.')).toBeInTheDocument();
    expect(screen.getByText('No files uploaded yet.')).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByText(/become available after departure/)).toBeInTheDocument();
  });
  it('keeps saved history and note draft visible during a failed background refresh', async () => {
    api.mockResolvedValue(evidenceFixture);
    render(<EvidencePanel {...props} />);
    await screen.findByText(evidenceNote.text);
    const input = screen.getByLabelText('Execution note');
    fireEvent.change(input, { target: { value: 'Unsent multiline\nnote' } });
    api.mockImplementation(async () => {
      throw new ApiError(503, 'API unavailable');
    });
    await act(async () => {
      fireEvent.focus(window);
    });
    await screen.findByRole('button', { name: 'Retry evidence' });
    expect(screen.getByText(evidenceNote.text)).toBeInTheDocument();
    expect(input).toHaveValue('Unsent multiline\nnote');
  });
  it('preserves one append-only note command and key across an unknown outcome and Retry', async () => {
    let posts = 0;
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') {
        posts++;
        if (posts === 1) throw new ApiError(0, 'Network lost');
        return { note: evidenceNote };
      }
      return emptyEvidence;
    });
    render(<EvidencePanel {...props} />);
    const input = await screen.findByLabelText('Execution note');
    fireEvent.change(input, { target: { value: 'Original note' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Add execution note' }));
    await screen.findByRole('button', { name: 'Retry same request' });
    expect(input).toHaveValue('Original note');
    expect(input).toBeDisabled();
    const original = mutations()[0]![1]?.body;
    fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
    await waitFor(() => expect(mutations()).toHaveLength(2));
    expect(mutations()[1]![1]?.body).toEqual(original);
    expect(mutations()[0]![0]).toBe('/orders/' + evidenceOrderId + '/notes');
    await waitFor(() => expect(input).not.toBeDisabled());
  });
  it('keeps an issue resolution draft and its pinned version after 409 until explicitly adopting a reviewed revision', async () => {
    let posts = 0,
      current = evidenceFixture;
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') {
        posts++;
        if (posts === 1) {
          current = { ...evidenceFixture, issues: [{ ...evidenceIssue, version: 2 }] };
          throw new ApiError(409, 'This issue changed.');
        }
        return { issue: { ...evidenceIssue, version: 3, status: 'RESOLVED' } };
      }
      return current;
    });
    render(<EvidencePanel {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve issue' }));
    const form = screen.getByRole('form', { name: 'Resolve issue' }),
      reason = within(form).getByLabelText('Resolution');
    fireEvent.change(reason, { target: { value: 'Inspected and fixed' } });
    fireEvent.submit(form);
    await screen.findByText('This issue changed.');
    expect(reason).toHaveValue('Inspected and fixed');
    expect(mutations()[0]![1]?.body).toMatchObject({ expectedVersion: 1 });
    fireEvent.click(within(form).getByRole('button', { name: 'Review current issue' }));
    await screen.findByRole('button', { name: 'Use reviewed revision for a new request' });
    expect(reason).toHaveValue('Inspected and fixed');
    fireEvent.click(
      screen.getByRole('button', { name: 'Use reviewed revision for a new request' }),
    );
    fireEvent.submit(form);
    await waitFor(() => expect(mutations()).toHaveLength(2));
    expect(mutations()[1]![1]?.body).toMatchObject({
      expectedVersion: 2,
      reason: 'Inspected and fixed',
    });
    expect((mutations()[1]![1]?.body as { operationKey: string }).operationKey).not.toBe(
      (mutations()[0]![1]?.body as { operationKey: string }).operationKey,
    );
  });
  it('uses crew routes and sends multi-item issue evidence without client authority fields', async () => {
    api.mockImplementation(async (_path, options) =>
      options?.method === 'POST' ? { issue: evidenceIssue } : evidenceFixture,
    );
    render(<EvidencePanel scope={{ assignmentId: evidenceAssignmentId }} items={evidenceItems} />);
    const form = await screen.findByRole('form', { name: 'Report issue' });
    fireEvent.change(within(form).getByLabelText('Issue description'), {
      target: { value: 'Two affected products' },
    });
    fireEvent.click(within(form).getByLabelText('Oak table'));
    fireEvent.click(within(form).getByLabelText('Chairs'));
    fireEvent.click(within(form).getByLabelText('proof.png'));
    fireEvent.click(
      within(form).getByLabelText('I understand this issue may reopen the completed order'),
    );
    fireEvent.submit(form);
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]![0]).toBe('/crew/assignments/' + evidenceAssignmentId + '/issues');
    expect(mutations()[0]![1]?.body).toMatchObject({
      itemIds: evidenceItems.map((item) => item.id),
      attachmentIds: [evidenceFile.id],
    });
    expect(mutations()[0]![1]?.body).not.toHaveProperty('visibility');
    expect(mutations()[0]![1]?.body).not.toHaveProperty('actorId');
    expect(screen.queryByRole('button', { name: 'Resolve issue' })).not.toBeInTheDocument();
  });
  it('requires an unchecked issue acknowledgement even on a stale page and keeps it out of the API authority payload', async () => {
    api.mockImplementation(async (_path, options) =>
      options?.method === 'POST' ? { issue: evidenceIssue } : emptyEvidence,
    );
    render(<EvidencePanel scope={{ assignmentId: evidenceAssignmentId }} items={evidenceItems} />);
    const form = await screen.findByRole('form', { name: 'Report issue' });
    const acknowledgement = within(form).getByLabelText(
      'I understand this issue may reopen the completed order',
    );
    expect(acknowledgement).not.toBeChecked();
    fireEvent.change(within(form).getByLabelText('Issue description'), {
      target: { value: 'Damage noticed after prior closure' },
    });
    fireEvent.submit(form);
    expect(mutations()).toHaveLength(0);
    expect(within(form).getByRole('alert')).toHaveTextContent(
      'Confirm that reporting or reopening this issue may reopen',
    );
    fireEvent.click(acknowledgement);
    fireEvent.submit(form);
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]![1]?.body).not.toHaveProperty('reopenAcknowledged');
    expect(mutations()[0]![1]?.body).not.toHaveProperty('currentCompletionId');
  });
  it('requires explicit reopen consequences for an issue while retaining its captured revision', async () => {
    let current: EvidenceResponse = {
      ...evidenceFixture,
      issues: [{ ...evidenceIssue, status: 'RESOLVED', version: 4, orderCompleted: true }],
    };
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') {
        const issue = { ...evidenceIssue, status: 'OPEN' as const, version: 5 };
        current = { ...current, issues: [issue] };
        return { issue };
      }
      return current;
    });
    render(<EvidencePanel {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen issue' }));
    const form = screen.getByRole('form', { name: 'Reopen issue' });
    fireEvent.change(within(form).getByLabelText('Reason for reopening'), {
      target: { value: 'The repair needs another inspection' },
    });
    fireEvent.submit(form);
    expect(mutations()).toHaveLength(0);
    expect(
      within(form).getByText(
        /Previous signatures, physical results and completion history are preserved/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      within(form).getByLabelText('I understand this issue may reopen the completed order'),
    );
    fireEvent.submit(form);
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]![0]).toContain('/reopen');
    expect(mutations()[0]![1]?.body).toMatchObject({
      expectedVersion: 4,
      reason: 'The repair needs another inspection',
    });
  });
  it('uploads sequentially and retries the frozen original File and metadata for only the uncertain file', async () => {
    const first = deferred<AttachmentResponse>();
    let posts = 0;
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') {
        posts++;
        if (posts === 1) return first.promise;
        if (posts === 2) throw new ApiError(0, 'Upload response lost');
        return { attachment: { ...evidenceFile, id: 'second' } };
      }
      return emptyEvidence;
    });
    render(<EvidencePanel scope={{ assignmentId: evidenceAssignmentId }} items={evidenceItems} />);
    const input = await screen.findByLabelText('Attachment files'),
      a = new File(['first bytes'], 'first.png', { type: 'image/png' }),
      b = new File(['second bytes'], 'second.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [a, b] } });
    fireEvent.change(screen.getByLabelText('Proof type'), { target: { value: 'DELIVERY' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Upload attachments' }));
    expect(mutations()).toHaveLength(1);
    await act(async () => first.resolve({ attachment: evidenceFile }));
    await screen.findByText(/Upload result is unknown/);
    expect(mutations()).toHaveLength(2);
    expect(input).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Choose different files' }),
    ).not.toBeInTheDocument();
    const original = mutations()[1]![1]?.body as FormData;
    expect(original.get('file')).toBe(b);
    expect(original.get('proofType')).toBe('DELIVERY');
    fireEvent.click(screen.getByRole('button', { name: 'Retry same upload' }));
    await screen.findByText('All 2 files are saved.');
    expect(mutations()).toHaveLength(3);
    const retried = mutations()[2]![1]?.body as FormData;
    expect(retried.get('file')).toBe(b);
    expect(retried.get('operationKey')).toBe(original.get('operationKey'));
    expect(retried.get('proofType')).toBe(original.get('proofType'));
    expect(mutations()[2]![1]?.timeoutMs).toBe(30000);
  });
  it('allows a different selection after a definite size rejection and gives a file-chooser camera hint only to crew', async () => {
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') throw new ApiError(413, 'Image too large');
      return emptyEvidence;
    });
    render(<EvidencePanel scope={{ assignmentId: evidenceAssignmentId }} items={evidenceItems} />);
    const input = await screen.findByLabelText('Attachment files');
    expect(input).toHaveAttribute('capture', 'environment');
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    fireEvent.change(input, { target: { files: [new File(['large'], 'oversized.png')] } });
    fireEvent.change(screen.getByLabelText('Proof type'), { target: { value: 'DAMAGE' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Upload attachments' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Choose different files' }));
    expect(input).not.toBeDisabled();
    expect(screen.queryByText('Image too large')).not.toBeInTheDocument();
  });
  it('ignores a late upload result after the assignment scope changes', async () => {
    const pending = deferred<AttachmentResponse>(),
      changed = vi.fn();
    api.mockImplementation(async (_path, options) =>
      options?.method === 'POST' ? pending.promise : emptyEvidence,
    );
    const view = render(
      <EvidencePanel
        scope={{ assignmentId: evidenceAssignmentId }}
        items={evidenceItems}
        onChanged={changed}
      />,
    );
    const input = await screen.findByLabelText('Attachment files');
    fireEvent.change(input, { target: { files: [new File(['bytes'], 'old.png')] } });
    fireEvent.change(screen.getByLabelText('Proof type'), { target: { value: 'OTHER' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Upload attachments' }));
    view.rerender(
      <EvidencePanel
        scope={{ assignmentId: 'new-assignment' }}
        items={evidenceItems}
        onChanged={changed}
      />,
    );
    await screen.findByLabelText('Attachment files');
    await act(async () => pending.resolve({ attachment: evidenceFile }));
    expect(changed).not.toHaveBeenCalled();
    expect(screen.queryByText('All 1 files are saved.')).not.toBeInTheDocument();
  });
  it('applies confirmed withdrawal metadata immediately even when every following refresh fails', async () => {
    let withdrawn = false;
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') {
        withdrawn = true;
        return {
          attachment: {
            ...evidenceFile,
            withdrawnAt: '2030-01-07T10:00:00.000Z',
            withdrawReason: 'Fixture withdrawal',
          },
        };
      }
      if (withdrawn) throw new ApiError(503, 'Refresh unavailable');
      return { ...emptyEvidence, attachments: [evidenceFile] };
    });
    render(<EvidencePanel {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw file' }));
    fireEvent.change(screen.getByLabelText('Withdrawal reason'), {
      target: { value: 'Fixture withdrawal' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Withdraw attachment' }));
    await screen.findByText('Withdrawn. Content is no longer available.');
    await screen.findByRole('button', { name: 'Retry evidence' });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View protected image' })).not.toBeInTheDocument();
    expect(mutations()[0]![1]?.body).toMatchObject({ reason: 'Fixture withdrawal' });
  });
  it('shows withdrawn metadata without a preview and keeps PDFs as download links', async () => {
    const pdf = {
      ...evidenceFile,
      id: 'pdf',
      kind: 'PDF' as const,
      contentType: 'application/pdf' as const,
      displayName: 'instructions.pdf',
      thumbnailUrl: null,
      width: null,
      height: null,
    };
    api.mockResolvedValue({
      ...emptyEvidence,
      attachments: [{ ...evidenceFile, withdrawnAt: '2030-01-07T10:00:00.000Z' }, pdf],
    });
    render(<EvidencePanel {...props} />);
    await screen.findByRole('link', { name: 'Download PDF attachment' });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download PDF attachment' })).toHaveAttribute(
      'href',
      pdf.contentUrl,
    );
    expect(document.querySelector('iframe,object,embed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw file' }));
    expect(screen.getByLabelText('Withdrawal reason')).toBeRequired();
  });
});
