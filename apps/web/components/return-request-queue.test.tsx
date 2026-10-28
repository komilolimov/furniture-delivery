import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { plannedReturnDetailFixture, returnDetailFixture } from '../test/return-fixture';
import { realtimeUser } from '../test/realtime-fixture';
import { chooseSelectOption } from '../test/select-option';
import { useCurrentUser } from './session-provider';
import { ReturnRequestQueue } from './return-request-queue';
vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
vi.mock('./session-provider', () => ({ useCurrentUser: vi.fn() }));
const api = vi.mocked(apiRequest);
const auth = vi.mocked(useCurrentUser);
const entry = {
  request: returnDetailFixture.request,
  orderNumber: 'FD-000001',
  customerName: 'Fixture customer',
  currentAppointmentId: null,
  readyToResolve: false,
};
const response = { requests: [entry], total: 72, page: 1, pageSize: 20 };
beforeEach(() => {
  api.mockReset();
  auth.mockReturnValue(realtimeUser);
});
describe('Return request directory', () => {
  it('separates the server total, page-only planning count and explicit ready-to-review flag', async () => {
    api.mockResolvedValue({
      ...response,
      requests: [
        entry,
        {
          ...entry,
          request: plannedReturnDetailFixture.request,
          customerName: 'Follow-up customer',
          currentAppointmentId: plannedReturnDetailFixture.currentAppointment!.id,
          readyToResolve: true,
        },
      ],
    });
    const { container } = render(<ReturnRequestQueue initialStatus="" />);
    await screen.findByRole('link', { name: 'FD-000001 · Fixture customer' });
    const overview = screen.getByRole('region', { name: 'Return request overview' });
    expect(within(overview).getByText('72')).toBeInTheDocument();
    expect(within(overview).getAllByText('1')).toHaveLength(2);
    expect(screen.getByText('Need remains open')).toBeInTheDocument();
    expect(screen.getByText('Ready for review')).toBeInTheDocument();
    expect(screen.queryByText('Need resolved')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveClass('return-queue-table');
    expect(screen.getByRole('link', { name: 'Current follow-up' })).toHaveAttribute(
      'href',
      `/backoffice/planning/orders/${entry.request.orderId}/appointments/${plannedReturnDetailFixture.currentAppointment!.id}`,
    );
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(10);
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]![0]).toBe('/backoffice/return-requests?page=1&pageSize=20');
  });
  it('shows a resolved need separately from a planned visit without deriving closure locally', async () => {
    api.mockResolvedValue({
      ...response,
      total: 1,
      requests: [
        {
          ...entry,
          request: { ...entry.request, status: 'RESOLVED', version: 4 },
          readyToResolve: false,
          currentAppointmentId: 'covering-visit',
        },
      ],
    });
    render(<ReturnRequestQueue initialStatus="RESOLVED" />);
    await screen.findByText('Need resolved');
    expect(
      within(screen.getByRole('region', { name: 'Return request directory' })).getByText(
        'Resolved',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Ready for review')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Covering visit' })).toHaveAttribute(
      'href',
      `/backoffice/planning/orders/${entry.request.orderId}/appointments/covering-visit`,
    );
    expect(api).toHaveBeenCalledWith(
      '/backoffice/return-requests?page=1&pageSize=20&status=RESOLVED',
      expect.anything(),
    );
  });
  it('denies crew before requesting backoffice records', () => {
    auth.mockReturnValue({ ...realtimeUser, role: 'CREW_MEMBER', crewIds: ['crew'] });
    render(<ReturnRequestQueue />);
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(api).not.toHaveBeenCalled();
  });
  it('keeps saved records on a transient failure and clears them after access loss', async () => {
    let status = 200;
    api.mockImplementation(async () => {
      if (status !== 200) throw new ApiError(status, 'Requests unavailable');
      return response;
    });
    render(<ReturnRequestQueue />);
    await screen.findByRole('link', { name: 'FD-000001 · Fixture customer' });
    status = 503;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh requests' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('link', { name: 'FD-000001 · Fixture customer' })).toBeInTheDocument();
    expect(screen.queryByText('No matching return requests')).not.toBeInTheDocument();
    status = 403;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'FD-000001 · Fixture customer' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.queryByText('Missing cabinet hinge')).not.toBeInTheDocument();
  });
  it('applies status and page size only explicitly and resets pagination on changes', async () => {
    api.mockResolvedValue(response);
    render(<ReturnRequestQueue />);
    await screen.findByRole('link', { name: 'FD-000001 · Fixture customer' });
    fireEvent.click(screen.getByRole('button', { name: 'Next requests' }));
    await waitFor(() =>
      expect(api).toHaveBeenLastCalledWith(
        '/backoffice/return-requests?page=2&pageSize=20&status=OPEN',
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filter return requests' }));
    await chooseSelectOption('Request status', 'Planned · need still open');
    await chooseSelectOption('Per page', '50');
    expect(api).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Apply request filters' }));
    await waitFor(() =>
      expect(api).toHaveBeenLastCalledWith(
        '/backoffice/return-requests?page=1&pageSize=50&status=PLANNED',
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear request filters' }));
    await waitFor(() =>
      expect(api).toHaveBeenLastCalledWith(
        '/backoffice/return-requests?page=1&pageSize=50',
        expect.anything(),
      ),
    );
  });
  it('refreshes on focus without changing the selected server filter or creating a mutation', async () => {
    api.mockResolvedValue(response);
    render(<ReturnRequestQueue initialStatus="PLANNED" />);
    await screen.findByRole('link', { name: 'FD-000001 · Fixture customer' });
    await act(async () => {
      fireEvent.focus(window);
    });
    expect(api).toHaveBeenCalledTimes(2);
    expect(
      api.mock.calls.every(
        ([path, options]) =>
          path === '/backoffice/return-requests?page=1&pageSize=20&status=PLANNED' &&
          !options?.method,
      ),
    ).toBe(true);
  });
});
