import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { crewAssignmentFixture } from '../test/execution-fixture';
import { CrewWorkList } from './crew-work-list';
vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const api = vi.mocked(apiRequest);
const data = {
  assignments: [crewAssignmentFixture],
  total: 23,
  page: 1,
  pageSize: 10,
  businessDate: '2030-01-07',
  timeZone: 'Europe/Rome',
};
beforeEach(() => {
  api.mockReset();
});
describe('Crew mobile work cards', () => {
  it('shows the server view total, team and planned window without detail N+1 or administrative requests', async () => {
    api.mockResolvedValue({
      ...data,
      assignments: [{ ...crewAssignmentFixture, confirmationStatus: 'NEEDS_CONFIRMATION' }],
    });
    const { container } = render(<CrewWorkList />);
    await screen.findByRole('link', { name: crewAssignmentFixture.customerName });
    const view = screen.getByRole('region', { name: 'Current work view' });
    expect(within(view).getByText('23 visits in this view')).toBeInTheDocument();
    expect(screen.getByText(crewAssignmentFixture.crewName)).toBeInTheDocument();
    expect(screen.getByText('Planned visit · Europe/Rome')).toBeInTheDocument();
    expect(screen.getByText('Needs client confirmation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: "Open my team's visit" })).toHaveAttribute(
      'href',
      `/crew/assignments/${crewAssignmentFixture.id}`,
    );
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(10);
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]![0]).toBe('/crew/assignments?view=today&page=1&pageSize=10');
    expect(
      screen.queryByText(/payments|outstanding balance|internal notes/i),
    ).not.toBeInTheDocument();
  });
  it('retains saved work after a transient read failure and clears it when assignment access is lost', async () => {
    let status = 200;
    api.mockImplementation(async () => {
      if (status !== 200) throw new ApiError(status, 'Work unavailable');
      return data;
    });
    render(<CrewWorkList />);
    await screen.findByRole('link', { name: crewAssignmentFixture.customerName });
    status = 503;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh work' }));
    await screen.findByRole('alert');
    expect(
      screen.getByRole('link', { name: crewAssignmentFixture.customerName }),
    ).toBeInTheDocument();
    expect(screen.queryByText('No assignments in this view')).not.toBeInTheDocument();
    status = 404;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: crewAssignmentFixture.customerName }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(crewAssignmentFixture.crewName)).not.toBeInTheDocument();
    expect(screen.queryByText('23 visits in this view')).not.toBeInTheDocument();
  });
});
