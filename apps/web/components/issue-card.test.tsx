import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../lib/api-client';
import {
  evidenceAssignmentId,
  evidenceFile,
  evidenceIssue,
  evidenceItems,
  evidenceOrderId,
} from '../test/evidence-fixture';
import { IssueCard } from './evidence-panel';

vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const api = vi.mocked(apiRequest);
const refresh = vi.fn();
const onLock = vi.fn();
const props = {
  issue: evidenceIssue,
  items: evidenceItems,
  files: [evidenceFile],
  base: `/orders/${evidenceOrderId}`,
  crew: false,
  canAppend: true,
  refresh,
  onLock,
};
beforeEach(() => {
  api.mockReset();
  refresh.mockReset();
  onLock.mockReset();
});

describe('Issue detail presentation', () => {
  it('renders real status, visibility, related items and history with decorative icons', () => {
    const { container } = render(<IssueCard {...props} />);
    expect(screen.getByRole('heading', { name: 'Damage' })).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Crew visible')).toBeInTheDocument();
    expect(screen.getByText(evidenceIssue.description)).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Related items' })).getByText('Oak table'),
    ).toBeInTheDocument();
    expect(screen.getByText('Issue timeline (1)')).toBeInTheDocument();
    expect(screen.getByText('Issue reported')).toBeInTheDocument();
    expect(container.querySelector(`#evidence-issue-${evidenceIssue.id}`)).toBeInTheDocument();
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(5);
    expect(api).not.toHaveBeenCalled();
  });

  it('opens only active protected file content in a standalone detail and preserves unavailable metadata', () => {
    const withdrawn = {
      ...evidenceFile,
      id: 'withdrawn',
      displayName: 'Old proof',
      withdrawnAt: evidenceIssue.createdAt,
    };
    render(
      <IssueCard
        {...props}
        issue={{
          ...evidenceIssue,
          itemIds: ['historical-item'],
          attachmentIds: [evidenceFile.id, withdrawn.id, 'historical'],
        }}
        files={[evidenceFile, withdrawn]}
        attachmentLinkMode="content"
      />,
    );
    const files = screen.getByRole('region', { name: 'Related files' });
    expect(within(files).getByRole('link', { name: 'proof.png' })).toHaveAttribute(
      'href',
      evidenceFile.contentUrl,
    );
    expect(within(files).getAllByRole('link')).toHaveLength(1);
    expect(within(files).getByText('Old proof · Withdrawn')).toBeInTheDocument();
    expect(within(files).getByText('Historical attachment · Unavailable')).toBeInTheDocument();
    expect(screen.getByText('historical-item')).toBeInTheDocument();
  });

  it('keeps the resolution draft and original version through an incoming issue refresh', async () => {
    api.mockResolvedValue({ issue: { ...evidenceIssue, status: 'RESOLVED', version: 3 } });
    const { rerender } = render(<IssueCard {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve issue' }));
    const form = screen.getByRole('form', { name: 'Resolve issue' });
    fireEvent.change(within(form).getByLabelText('Resolution'), {
      target: { value: 'Inspected and repaired' },
    });
    rerender(<IssueCard {...props} issue={{ ...evidenceIssue, version: 2 }} />);
    expect(within(form).getByLabelText('Resolution')).toHaveValue('Inspected and repaired');
    fireEvent.submit(form);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith(
      `${props.base}/issues/${evidenceIssue.id}/resolve`,
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          expectedVersion: 1,
          reason: 'Inspected and repaired',
          operationKey: expect.any(String),
        }),
      }),
    );
    expect(api.mock.calls).toHaveLength(1);
  });

  it('keeps crew read-only controls and crew note route separate from backoffice resolution', async () => {
    api.mockResolvedValue({ issue: evidenceIssue });
    const { rerender } = render(<IssueCard {...props} crew canAppend={false} />);
    expect(screen.queryByRole('button', { name: 'Resolve issue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen issue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add issue note' })).not.toBeInTheDocument();
    rerender(<IssueCard {...props} crew base={`/crew/assignments/${evidenceAssignmentId}`} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add issue note' }));
    const form = screen.getByRole('form', { name: 'Add issue note' });
    fireEvent.change(within(form).getByLabelText('Issue note'), {
      target: { value: 'Fitting inspected' },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith(
      `/crew/assignments/${evidenceAssignmentId}/issues/${evidenceIssue.id}/notes`,
      expect.objectContaining({
        body: { text: 'Fitting inspected', operationKey: expect.any(String) },
      }),
    );
  });
});
