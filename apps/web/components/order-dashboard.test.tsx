import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DashboardResponse } from '@furniture-delivery/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { OrderDashboard } from './order-dashboard';

vi.mock('../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const apiMock = vi.mocked(apiRequest);
const dashboard: DashboardResponse = {
  inboxCount: 8,
  plannedCount: 4,
  assignedCount: 9,
  inProgressCount: 3,
  partiallyCompletedCount: 6,
  requiresAttentionCount: 1,
  awaitingReviewCount: 6,
  completedCount: 3,
  openIssueCount: 7,
  returnVisitRequiredCount: 4,
  orderTotalCents: 100000,
  paidCents: 65050,
  balanceCents: 34950,
  currency: 'EUR',
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
beforeEach(() => apiMock.mockReset());

describe('dashboard charts from canonical all-order aggregates', () => {
  it('shows all eight stages and their filters without counting issues or return requests as orders', async () => {
    apiMock.mockResolvedValue(dashboard);
    render(<OrderDashboard />);

    const flow = await screen.findByRole('region', { name: 'Order flow' });
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(
      within(flow).getByRole('figure', { name: 'Order flow: 40 total orders' }),
    ).toBeInTheDocument();
    for (const [label, count, progress] of [
      ['Inbox', 8, 'INBOX'],
      ['Planned', 4, 'PLANNED'],
      ['Assigned', 9, 'ASSIGNED'],
      ['In progress', 3, 'IN_PROGRESS'],
      ['Partially completed', 6, 'PARTIALLY_COMPLETED'],
      ['Requires attention', 1, 'REQUIRES_ATTENTION'],
      ['Awaiting review', 6, 'AWAITING_REVIEW'],
      ['Completed', 3, 'COMPLETED'],
    ] as const) {
      expect(within(flow).getByRole('link', { name: `${label} ${count}` })).toHaveAttribute(
        'href',
        `/backoffice/orders?progress=${progress}`,
      );
    }
    expect(screen.getByRole('link', { name: 'Open issues 7' })).toHaveAttribute(
      'href',
      '/backoffice/issues?status=OPEN',
    );
    expect(screen.getByRole('link', { name: 'View return requests' })).toHaveAttribute(
      'href',
      '/backoffice/return-requests?status=',
    );
    expect(screen.queryByText('No orders yet')).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/dashboard', expect.anything());
  });

  it('compares recorded payments with order value and preserves the financial scope disclaimer', async () => {
    apiMock.mockResolvedValue(dashboard);
    render(<OrderDashboard />);

    const payment = await screen.findByRole('region', { name: 'Payment overview' });
    expect(
      within(payment).getByRole('img', { name: 'Recorded payments: 65% of order value' }),
    ).toBeInTheDocument();
    expect(within(payment).getByText('Order total')).toBeInTheDocument();
    expect(within(payment).getByText('Recorded payments')).toBeInTheDocument();
    expect(within(payment).getByText('Outstanding balance')).toBeInTheDocument();
    expect(within(payment).getByText('€1,000.00')).toBeInTheDocument();
    expect(within(payment).getByText('€650.50')).toBeInTheDocument();
    expect(within(payment).getByText('€349.50')).toBeInTheDocument();
    expect(screen.getByText(/All orders · EUR/)).toHaveTextContent('not accounting revenue');
    expect(screen.getByRole('link', { name: 'Create order' })).toHaveAttribute(
      'href',
      '/backoffice/orders/new',
    );
    expect(screen.getByRole('link', { name: 'View all orders' })).toHaveAttribute(
      'href',
      '/backoffice/orders',
    );
    expect(screen.getByRole('link', { name: 'Open planning calendar' })).toHaveAttribute(
      'href',
      '/backoffice/planning',
    );
  });

  it('renders genuine zero aggregates without inventing a payment percentage or invalid chart geometry', async () => {
    apiMock.mockResolvedValue({
      ...dashboard,
      inboxCount: 0,
      plannedCount: 0,
      assignedCount: 0,
      inProgressCount: 0,
      partiallyCompletedCount: 0,
      requiresAttentionCount: 0,
      awaitingReviewCount: 0,
      completedCount: 0,
      openIssueCount: 0,
      returnVisitRequiredCount: 0,
      orderTotalCents: 0,
      paidCents: 0,
      balanceCents: 0,
    } satisfies DashboardResponse);
    const { container } = render(<OrderDashboard />);

    expect(await screen.findByText('No orders yet')).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Order flow: 0 total orders' })).toBeInTheDocument();
    const comparison = screen.getByRole('img', { name: 'No order value to compare' });
    expect(comparison).toHaveTextContent('—');
    expect(comparison).not.toHaveTextContent('%');
    expect(
      within(screen.getByRole('region', { name: 'Payment overview' })).getAllByText('€0.00'),
    ).toHaveLength(3);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity|undefined%/);
  });

  it('keeps exact cents for safe integer aggregates near the JavaScript precision limit', async () => {
    apiMock.mockResolvedValue({
      ...dashboard,
      orderTotalCents: 9_007_199_254_740_991,
      paidCents: 9_007_199_254_740_987,
      balanceCents: 4,
    } satisfies DashboardResponse);
    const { container } = render(<OrderDashboard />);

    const payment = await screen.findByRole('region', { name: 'Payment overview' });
    expect(within(payment).getByText('€90,071,992,547,409.91')).toBeInTheDocument();
    expect(within(payment).getByText('€90,071,992,547,409.87')).toBeInTheDocument();
    expect(within(payment).getByText('€0.04')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('shows initial loading, a real API failure and a retry that rereads the aggregate endpoint', async () => {
    apiMock
      .mockRejectedValueOnce(new ApiError(503, 'Dashboard temporarily unavailable.'))
      .mockResolvedValueOnce(dashboard);
    render(<OrderDashboard />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(screen.queryByRole('region', { name: 'Order flow' })).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Dashboard temporarily unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Order flow' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock.mock.calls.every(([path]) => path === '/dashboard')).toBe(true);
  });

  it('retains the mounted panels and their current values while a background refresh is pending', async () => {
    const next = deferred<DashboardResponse>();
    apiMock.mockResolvedValueOnce(dashboard).mockReturnValueOnce(next.promise);
    render(<OrderDashboard />);

    const flow = await screen.findByRole('region', { name: 'Order flow' });
    const payment = screen.getByRole('region', { name: 'Payment overview' });
    fireEvent(window, new Event('fd:orders-changed'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('region', { name: 'Order flow' })).toBe(flow);
    expect(screen.getByRole('region', { name: 'Payment overview' })).toBe(payment);
    expect(within(payment).getByText('€650.50')).toBeInTheDocument();
    expect(within(flow).getByRole('link', { name: 'In progress 3' })).toBeInTheDocument();

    await act(async () => next.resolve({ ...dashboard, inProgressCount: 4 }));
    expect(screen.getByRole('figure', { name: 'Order flow: 41 total orders' })).toBeInTheDocument();
    expect(within(flow).getByRole('link', { name: 'In progress 4' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Payment overview' })).toBe(payment);
  });

  it('preserves the last aggregate on a temporary refresh failure and lets the user retry', async () => {
    const next = deferred<DashboardResponse>();
    apiMock
      .mockResolvedValueOnce(dashboard)
      .mockReturnValueOnce(next.promise)
      .mockResolvedValueOnce({ ...dashboard, completedCount: 4 });
    render(<OrderDashboard />);

    const flow = await screen.findByRole('region', { name: 'Order flow' });
    const payment = screen.getByRole('region', { name: 'Payment overview' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh dashboard' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    await act(async () => next.reject(new ApiError(503, 'Refresh temporarily unavailable.')));
    expect(screen.getByRole('alert')).toHaveTextContent('Refresh temporarily unavailable');
    expect(screen.getByRole('region', { name: 'Order flow' })).toBe(flow);
    expect(screen.getByRole('region', { name: 'Payment overview' })).toBe(payment);
    expect(within(payment).getByText('€650.50')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await within(flow).findByRole('link', { name: 'Completed 4' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403])(
    'clears retained financial data when a refresh reports lost access (%s)',
    async (status) => {
      apiMock
        .mockResolvedValueOnce(dashboard)
        .mockRejectedValueOnce(new ApiError(status, 'Dashboard access ended.'));
      render(<OrderDashboard />);

      await screen.findByRole('region', { name: 'Payment overview' });
      fireEvent.click(screen.getByRole('button', { name: 'Refresh dashboard' }));
      await screen.findByRole('alert');
      expect(screen.queryByRole('region', { name: 'Payment overview' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Order flow' })).not.toBeInTheDocument();
      expect(screen.queryByText('€650.50')).not.toBeInTheDocument();
      expect(screen.queryByText('€349.50')).not.toBeInTheDocument();
    },
  );
});
