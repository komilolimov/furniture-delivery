import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { evidenceFixture, evidenceIssue, evidenceOrderId } from '../test/evidence-fixture';
import { orderFixture } from '../test/order-fixture';
import { realtimeUser } from '../test/realtime-fixture';
import { chooseSelectOption } from '../test/select-option';
import { useCurrentUser } from './session-provider';
import { IssuesList } from './issues-list';
vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
vi.mock('./session-provider', () => ({ useCurrentUser: vi.fn() }));
const api = vi.mocked(apiRequest);
const auth = vi.mocked(useCurrentUser);
const response = { issues: [evidenceIssue], total: 21, page: 1, pageSize: 20 };
beforeEach(() => {
  api.mockReset();
  auth.mockReturnValue(realtimeUser);
});
describe('Backoffice issue directory', () => {
  it('requests server status/type pagination and keeps exact order issue links', async () => {
    api.mockResolvedValue(response);
    render(<IssuesList initialStatus="OPEN" />);
    await screen.findByText(evidenceIssue.description);
    expect(api).toHaveBeenCalledWith('/issues?page=1&pageSize=20&status=OPEN', expect.anything());
    expect(screen.getByRole('link', { name: 'Open issue in order' })).toHaveAttribute(
      'href',
      `/backoffice/orders/${evidenceOrderId}#evidence-issue-${evidenceIssue.id}`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filter issues' }));
    await chooseSelectOption('Issue type', 'Damage');
    expect(api).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Apply issue filters' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/issues?page=1&pageSize=20&status=OPEN&type=DAMAGE',
        expect.anything(),
      ),
    );
    await screen.findByText(evidenceIssue.description);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/issues?page=2&pageSize=20&status=OPEN&type=DAMAGE',
        expect.anything(),
      ),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Filter issues' }));
    await chooseSelectOption('Per page', '50');
    fireEvent.click(screen.getByRole('button', { name: 'Apply issue filters' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/issues?page=1&pageSize=50&status=OPEN&type=DAMAGE',
        expect.anything(),
      ),
    );
  });
  it('keeps loading, errors and Retry distinct from a saved empty list', async () => {
    api
      .mockRejectedValueOnce(new ApiError(503, 'Issues unavailable'))
      .mockResolvedValueOnce({ issues: [], total: 0, page: 1, pageSize: 20 });
    render(<IssuesList />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(await screen.findByRole('alert')).toHaveTextContent('Issues unavailable');
    expect(screen.queryByText('No matching issues')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No matching issues')).toBeInTheDocument();
    expect(screen.getByText('Showing 0–0 of 0 issues')).toBeInTheDocument();
  });
  it('separates total matching counts from page-only statuses and avoids detail N+1', async () => {
    api.mockResolvedValue({
      ...response,
      total: 72,
      issues: [
        evidenceIssue,
        {
          ...evidenceIssue,
          id: 'resolved',
          description: 'Fixed issue',
          status: 'RESOLVED',
          visibility: 'BACKOFFICE_ONLY',
          reportedSource: 'CUSTOMER',
        },
      ],
    });
    const { container } = render(<IssuesList />);
    await screen.findByText('Fixed issue');
    const overview = screen.getByRole('region', { name: 'Issue overview' });
    expect(within(overview).getByText('72')).toBeInTheDocument();
    expect(within(overview).getAllByText('1')).toHaveLength(2);
    expect(within(overview).getByText('Open on this page')).toBeInTheDocument();
    expect(within(overview).getByText('Resolved on this page')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveClass('issues-directory-table');
    expect(screen.getByText('Backoffice only')).toBeInTheDocument();
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(10);
    expect(api).toHaveBeenCalledTimes(1);
  });
  it('blocks crew before any protected request', () => {
    auth.mockReturnValue({ ...realtimeUser, role: 'CREW_MEMBER', crewIds: ['crew-a'] });
    render(<IssuesList />);
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(api).not.toHaveBeenCalled();
  });
  it('opens canonical details only on demand and restores focus on close', async () => {
    api.mockImplementation(async (path) =>
      path.startsWith('/issues?')
        ? response
        : path.endsWith('/evidence')
          ? evidenceFixture
          : { order: { ...orderFixture, id: evidenceOrderId } },
    );
    render(<IssuesList />);
    const open = await screen.findByRole('button', {
      name: `View issue: ${evidenceIssue.description}`,
    });
    expect(api).toHaveBeenCalledTimes(1);
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', { name: 'Issue details' });
    await within(dialog).findByText('FD-000001');
    expect(api).toHaveBeenCalledWith(`/orders/${evidenceOrderId}/evidence`, expect.anything());
    expect(within(dialog).getByRole('link', { name: 'proof.png' })).toHaveAttribute(
      'href',
      evidenceFixture.attachments[0]!.contentUrl,
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(open).toHaveFocus());
    expect(api.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });
  it('removes the private list and open drawer after list access403', async () => {
    let denied = false;
    api.mockImplementation(async (path) => {
      if (path.startsWith('/issues?')) {
        if (denied) throw new ApiError(403, 'Denied');
        return response;
      }
      return path.endsWith('/evidence')
        ? evidenceFixture
        : { order: { ...orderFixture, id: evidenceOrderId } };
    });
    render(<IssuesList />);
    fireEvent.click(
      await screen.findByRole('button', { name: `View issue: ${evidenceIssue.description}` }),
    );
    await within(screen.getByRole('dialog')).findByText('Fixture customer');
    denied = true;
    await act(async () => {
      fireEvent.focus(window);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText(evidenceIssue.description)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
  });
  it('retains saved list data on a transient failure without marking an empty result', async () => {
    api
      .mockResolvedValueOnce(response)
      .mockRejectedValueOnce(new ApiError(503, 'Temporary failure'));
    render(<IssuesList />);
    await screen.findByText(evidenceIssue.description);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh issues' }));
    await screen.findByRole('alert');
    expect(screen.getByText(evidenceIssue.description)).toBeInTheDocument();
    expect(screen.queryByText('No matching issues')).not.toBeInTheDocument();
  });
  it('keeps authoritative resolved details open when the OPEN row disappears', async () => {
    let resolved = false;
    const saved = {
      ...evidenceIssue,
      status: 'RESOLVED',
      version: 2,
      resolution: 'Repaired and checked',
    };
    api.mockImplementation(async (path, options) => {
      if (options?.method === 'POST') {
        resolved = true;
        return { issue: saved };
      }
      if (path.startsWith('/issues?'))
        return { ...response, issues: resolved ? [] : [evidenceIssue], total: resolved ? 0 : 1 };
      if (path.endsWith('/evidence'))
        return { ...evidenceFixture, issues: [resolved ? saved : evidenceIssue] };
      return { order: { ...orderFixture, id: evidenceOrderId } };
    });
    render(<IssuesList initialStatus="OPEN" />);
    fireEvent.click(
      await screen.findByRole('button', { name: `View issue: ${evidenceIssue.description}` }),
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Resolve issue' }));
    const form = within(dialog).getByRole('form', { name: 'Resolve issue' });
    fireEvent.change(within(form).getByLabelText('Resolution'), {
      target: { value: 'Repaired and checked' },
    });
    fireEvent.submit(form);
    await within(dialog).findByText('Repaired and checked');
    await waitFor(() => expect(screen.getByText('No matching issues')).toBeInTheDocument());
    expect(within(dialog).getByText('Resolved')).toBeInTheDocument();
    expect(within(dialog).queryByText('Open')).not.toBeInTheDocument();
  });
});
