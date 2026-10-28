import type { EvidenceResponse, IssueRecord } from '@furniture-delivery/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import {
  emptyEvidence,
  evidenceFile,
  evidenceFixture,
  evidenceIssue,
  evidenceItems,
  evidenceOrderId,
} from '../test/evidence-fixture';
import { orderFixture } from '../test/order-fixture';
import { IssueDetail } from './issue-detail';

vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));

const api = vi.mocked(apiRequest);
const order = {
  ...orderFixture,
  id: evidenceOrderId,
  items: evidenceItems.map((item) => ({
    ...orderFixture.items[0]!,
    ...item,
    orderId: evidenceOrderId,
  })),
};
const properties = () => ({
  issueId: evidenceIssue.id,
  orderId: evidenceOrderId,
  returnFocus: null,
  onClosed: vi.fn(),
  onChanged: vi.fn(),
});
const mutations = () => api.mock.calls.filter(([, options]) => options?.method === 'POST');
const refocus = () =>
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  api.mockReset();
});

describe('Issue detail workspace', () => {
  it('loads canonical protected order evidence and opens linked material through its authorized URL', async () => {
    api.mockImplementation(async (path) =>
      path.endsWith('/evidence') ? evidenceFixture : { order },
    );
    render(<IssueDetail {...properties()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Issue details' });
    expect(await within(dialog).findByText(evidenceIssue.description)).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith(`/orders/${evidenceOrderId}/evidence`, expect.anything());
    expect(api).toHaveBeenCalledWith(`/orders/${evidenceOrderId}`, expect.anything());
    expect(within(dialog).getByText(order.customerName)).toBeInTheDocument();
    expect(within(dialog).getByText('Oak table')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /proof.png/ })).toHaveAttribute(
      'href',
      evidenceFile.contentUrl,
    );
    expect(within(dialog).getByRole('link', { name: 'Open full order' })).toHaveAttribute(
      'href',
      `/backoffice/orders/${evidenceOrderId}#evidence-issue-${evidenceIssue.id}`,
    );
    expect(mutations()).toHaveLength(0);
  });

  it('retains the same resolution draft and captured revision through 503 and a newer saved issue', async () => {
    let current: EvidenceResponse = evidenceFixture;
    let unavailable = false;
    api.mockImplementation(async (path, options) => {
      if (options?.method === 'POST')
        return { issue: { ...evidenceIssue, status: 'RESOLVED', version: 3 } };
      if (path.endsWith('/evidence')) {
        if (unavailable) throw new ApiError(503, 'Evidence temporarily unavailable');
        return current;
      }
      return { order };
    });
    render(<IssueDetail {...properties()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve issue' }));
    const form = screen.getByRole('form', { name: 'Resolve issue' });
    const reason = within(form).getByLabelText('Resolution');
    fireEvent.change(reason, { target: { value: 'Original inspection draft' } });
    unavailable = true;
    refocus();
    expect(await screen.findByRole('alert')).toHaveTextContent('Evidence temporarily unavailable');
    expect(screen.getByLabelText('Resolution')).toBe(reason);
    expect(reason).toHaveValue('Original inspection draft');
    unavailable = false;
    current = { ...evidenceFixture, issues: [{ ...evidenceIssue, version: 2 }] };
    refocus();
    await screen.findByText(/revision 2/);
    expect(screen.getByLabelText('Resolution')).toBe(reason);
    expect(reason).toHaveValue('Original inspection draft');
    fireEvent.submit(form);
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]![1]?.body).toMatchObject({
      expectedVersion: 1,
      reason: 'Original inspection draft',
    });
  });

  it('blocks closing during pending and unknown commands and retries the frozen original request', async () => {
    const waiting = deferred();
    const props = properties();
    let current: EvidenceResponse = evidenceFixture;
    let posts = 0;
    api.mockImplementation(async (path, options) => {
      if (options?.method === 'POST') {
        posts++;
        if (posts === 1) return waiting.promise;
        const issue: IssueRecord = {
          ...evidenceIssue,
          status: 'RESOLVED',
          version: 2,
          resolution: 'Saved controlled resolution',
        };
        current = { ...evidenceFixture, issues: [issue] };
        return { issue };
      }
      return path.endsWith('/evidence') ? current : { order };
    });
    render(<IssueDetail {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve issue' }));
    const form = screen.getByRole('form', { name: 'Resolve issue' });
    fireEvent.change(within(form).getByLabelText('Resolution'), {
      target: { value: 'Saved controlled resolution' },
    });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close issue details' })).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: 'Close details' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Open full order' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Continue in order' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(props.onClosed).not.toHaveBeenCalled();
    await act(async () => waiting.reject(new ApiError(503, 'Result not confirmed')));
    const retry = await screen.findByRole('button', { name: 'Retry same request' });
    expect(screen.getByRole('button', { name: 'Close issue details' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Open full order' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Continue in order' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(props.onClosed).not.toHaveBeenCalled();
    fireEvent.click(retry);
    await waitFor(() => expect(mutations()).toHaveLength(2));
    expect(mutations()[1]![0]).toBe(mutations()[0]![0]);
    expect(mutations()[1]![1]?.body).toEqual(mutations()[0]![1]?.body);
    await screen.findByText('Saved controlled resolution');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close details' })).toBeEnabled(),
    );
    expect(props.onChanged).toHaveBeenCalledTimes(1);
  });

  it.each(['evidence', 'order'])(
    'clears private detail and its form when %s access is lost',
    async (target) => {
      let accessLost = false;
      api.mockImplementation(async (path) => {
        const isEvidence = path.endsWith('/evidence');
        if (accessLost && (target === 'evidence' ? isEvidence : !isEvidence))
          throw new ApiError(403, 'Access no longer allowed');
        return isEvidence ? evidenceFixture : { order };
      });
      render(<IssueDetail {...properties()} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Resolve issue' }));
      fireEvent.change(screen.getByLabelText('Resolution'), {
        target: { value: 'Private unsaved text' },
      });
      accessLost = true;
      refocus();
      await screen.findByRole('alert');
      expect(screen.queryByText(evidenceIssue.description)).not.toBeInTheDocument();
      expect(screen.queryByText(order.customerName)).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue('Private unsaved text')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /proof.png/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Continue in order' })).not.toBeInTheDocument();
    },
  );

  it('shows unavailable rather than falling back to a missing issue from its original selection', async () => {
    api.mockImplementation(async (path) =>
      path.endsWith('/evidence') ? emptyEvidence : { order },
    );
    render(<IssueDetail {...properties()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This issue is no longer available in the order.',
    );
    expect(screen.queryByText(evidenceIssue.description)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve issue' })).not.toBeInTheDocument();
    expect(mutations()).toHaveLength(0);
  });

  it('starts a clean editor for another selected issue from the same order', async () => {
    const other = { ...evidenceIssue, id: 'other-issue', description: 'Different saved problem' };
    api.mockImplementation(async (path) =>
      path.endsWith('/evidence')
        ? { ...evidenceFixture, issues: [evidenceIssue, other] }
        : { order },
    );
    const props = properties();
    const view = render(<IssueDetail {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve issue' }));
    fireEvent.change(screen.getByLabelText('Resolution'), {
      target: { value: 'First issue draft' },
    });
    view.rerender(<IssueDetail {...props} issueId={other.id} />);
    await screen.findByText(other.description);
    expect(screen.queryByDisplayValue('First issue draft')).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Resolve issue' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve issue' }));
    expect(screen.getByLabelText('Resolution')).toHaveValue('');
  });

  it('ignores an old order request that completes after the selected order changes', async () => {
    const oldEvidence = deferred();
    const newOrderId = 'new-order';
    const nextIssue = {
      ...evidenceIssue,
      id: 'next-issue',
      orderId: newOrderId,
      description: 'Only the new problem',
    };
    api.mockImplementation(async (path) => {
      if (path === `/orders/${evidenceOrderId}/evidence`) return oldEvidence.promise;
      if (path === `/orders/${newOrderId}/evidence`)
        return { ...emptyEvidence, issues: [nextIssue] };
      return { order: { ...order, id: path.split('/').at(-1) } };
    });
    const props = properties();
    const view = render(<IssueDetail {...props} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading issue details');
    view.rerender(<IssueDetail {...props} issueId={nextIssue.id} orderId={newOrderId} />);
    await screen.findByText(nextIssue.description);
    await act(async () => oldEvidence.resolve(evidenceFixture));
    expect(screen.getByText(nextIssue.description)).toBeInTheDocument();
    expect(screen.queryByText(evidenceIssue.description)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open full order' })).toHaveAttribute(
      'href',
      `/backoffice/orders/${newOrderId}#evidence-issue-${nextIssue.id}`,
    );
  });
});
