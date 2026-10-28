import type { ReturnRequestDetail, ReturnRequestResponse } from '@furniture-delivery/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { planningCrews } from '../test/planning-fixture';
import { plannedReturnDetailFixture, returnDetailFixture } from '../test/return-fixture';
import { deferred, realtimeUser } from '../test/realtime-fixture';
import { useCurrentUser } from './session-provider';
import { ReturnRequestDetailScreen, ReturnRequestPanel } from './return-request-panel';
vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
vi.mock('./session-provider', () => ({ useCurrentUser: vi.fn() }));
const api = vi.mocked(apiRequest);
const auth = vi.mocked(useCurrentUser);
const refresh = vi.fn(async () => undefined);
const panelProps = () => ({ crews: planningCrews, onSaved: vi.fn(), onRefresh: refresh });
const requestPath = `/backoffice/return-requests/${returnDetailFixture.request.id}`;
const focusRefresh = () =>
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
beforeEach(() => {
  api.mockReset();
  auth.mockReturnValue(realtimeUser);
  refresh.mockClear();
});

describe('Return request detail workspace', () => {
  it('does not issue backoffice detail or team requests for crew', () => {
    auth.mockReturnValue({ ...realtimeUser, role: 'CREW_MEMBER', crewIds: ['crew-a'] });
    render(<ReturnRequestDetailScreen requestId={returnDetailFixture.request.id} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(api).not.toHaveBeenCalled();
  });
  it('shows loading and API error separately, then retries the canonical detail', async () => {
    let gets = 0;
    api.mockImplementation(async (path) => {
      if (path === '/crews') return { crews: planningCrews };
      gets++;
      if (gets === 1) throw new ApiError(503, 'Return detail temporarily unavailable');
      return { request: returnDetailFixture };
    });
    render(<ReturnRequestDetailScreen requestId={returnDetailFixture.request.id} />);
    expect(
      screen.getAllByRole('status').some((status) => status.textContent?.includes('Loading')),
    ).toBe(true);
    expect(screen.queryByRole('region', { name: 'Return request detail' })).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Return detail temporarily unavailable',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { name: 'Return visit request' });
    expect(api).toHaveBeenCalledWith(requestPath, expect.anything());
    expect(api).toHaveBeenCalledWith('/crews', expect.anything());
    expect(screen.getByRole('link', { name: 'Open original order' })).toHaveAttribute(
      'href',
      `/backoffice/orders/${returnDetailFixture.request.orderId}`,
    );
  });
  it('keeps server readiness separate from quantities and preserves the original snapshot', () => {
    const detail = {
      ...plannedReturnDetailFixture,
      items: plannedReturnDetailFixture.items.map((item) => ({
        ...item,
        deliveredQuantity: item.quantity,
        assembledQuantity: item.quantity,
      })),
    };
    const { container } = render(<ReturnRequestPanel detail={detail} {...panelProps()} />);
    expect(screen.getByText('Need remains open')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resolve return need' })).toBeDisabled();
    expect(
      screen.getByText('Every team must complete the follow-up before resolving it.'),
    ).toBeInTheDocument();
    const live = screen.getByRole('region', { name: 'Current accumulated quantities' });
    expect(within(live).getAllByText('2 / 2')).toHaveLength(2);
    const report = screen.getByRole('region', { name: 'Immutable source report' });
    expect(within(report).getByText('Delivered one cabinet; hinge missing')).toBeInTheDocument();
    expect(
      within(report).getByText(/delivered 1\/2; assembled 0\/2 · frozen accumulated snapshot/),
    ).toBeInTheDocument();
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(10);
    expect(api).not.toHaveBeenCalled();
  });
  it('retains the planning draft and captured request revision after a failed refresh and section navigation', async () => {
    let unavailable = false;
    api.mockImplementation(async (path) => {
      if (path === '/crews') return { crews: planningCrews };
      if (unavailable) throw new ApiError(503, 'Temporary return detail failure');
      return { request: returnDetailFixture };
    });
    render(<ReturnRequestDetailScreen requestId={returnDetailFixture.request.id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Plan remaining work' }));
    const reason = screen.getByLabelText('Reason for return plan');
    fireEvent.change(reason, { target: { value: 'Keep my return plan draft' } });
    const navigation = screen.getByRole('navigation', { name: 'Return request sections' });
    expect(within(navigation).getByRole('link', { name: 'Attempt history' })).toHaveAttribute(
      'href',
      `#return-${returnDetailFixture.request.id}-history`,
    );
    fireEvent.click(within(navigation).getByRole('link', { name: 'Attempt history' }));
    expect(screen.getByLabelText('Reason for return plan')).toBe(reason);
    unavailable = true;
    focusRefresh();
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Reason for return plan')).toBe(reason);
    expect(reason).toHaveValue('Keep my return plan draft');
    expect(screen.getByText(/Draft request revision 2/)).toBeInTheDocument();
    expect(api.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true);
  });
  it('clears the saved detail and private plan on lost detail access', async () => {
    let denied = false;
    api.mockImplementation(async (path) => {
      if (path === '/crews') return { crews: planningCrews };
      if (denied) throw new ApiError(403, 'Detail access revoked');
      return { request: returnDetailFixture };
    });
    render(<ReturnRequestDetailScreen requestId={returnDetailFixture.request.id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Plan remaining work' }));
    fireEvent.change(screen.getByLabelText('Reason for return plan'), {
      target: { value: 'Private return draft' },
    });
    denied = true;
    focusRefresh();
    await screen.findByRole('alert');
    expect(screen.queryByRole('region', { name: 'Return request detail' })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Private return draft')).not.toBeInTheDocument();
    expect(screen.queryByText(returnDetailFixture.request.reason)).not.toBeInTheDocument();
  });
  it('starts clean for another request and ignores its predecessor late response', async () => {
    const previous = deferred<ReturnRequestResponse>();
    const nextId = '60000000-0000-4000-8000-000000000009';
    const next: ReturnRequestDetail = {
      ...returnDetailFixture,
      request: { ...returnDetailFixture.request, id: nextId, reason: 'Next request only' },
    };
    api.mockImplementation(async (path) => {
      if (path === '/crews') return { crews: planningCrews };
      if (path === requestPath) return previous.promise;
      return { request: next };
    });
    const view = render(<ReturnRequestDetailScreen requestId={returnDetailFixture.request.id} />);
    view.rerender(<ReturnRequestDetailScreen requestId={nextId} />);
    await screen.findByText('Next request only');
    await act(async () => previous.resolve({ request: returnDetailFixture }));
    expect(screen.getByText('Next request only')).toBeInTheDocument();
    expect(screen.queryByText(returnDetailFixture.request.reason)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Plan remaining work' }));
    fireEvent.change(screen.getByLabelText('Reason for return plan'), {
      target: { value: 'Other request private draft' },
    });
    view.rerender(<ReturnRequestDetailScreen requestId={returnDetailFixture.request.id} />);
    await screen.findByText(returnDetailFixture.request.reason);
    expect(screen.queryByDisplayValue('Other request private draft')).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Plan return visit' })).not.toBeInTheDocument();
  });
  it('keeps a review reason and captured version through same-request refresh without rebasing', async () => {
    let current = plannedReturnDetailFixture;
    api.mockImplementation(async (path) =>
      path === '/crews' ? { crews: planningCrews } : { request: current },
    );
    render(<ReturnRequestDetailScreen requestId={returnDetailFixture.request.id} />);
    const explanation = await screen.findByLabelText('Resolution explanation');
    fireEvent.change(explanation, { target: { value: 'My retained review explanation' } });
    current = {
      ...plannedReturnDetailFixture,
      request: { ...plannedReturnDetailFixture.request, version: 4 },
    };
    focusRefresh();
    await screen.findByText('The request changed. The review text and revision 3 are retained.');
    expect(screen.getByLabelText('Resolution explanation')).toBe(explanation);
    expect(explanation).toHaveValue('My retained review explanation');
    expect(screen.getByRole('button', { name: 'Resolve return need' })).toBeDisabled();
    expect(api.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Review latest request revision' }));
    await waitFor(() =>
      expect(screen.getByText('Dispatcher review · revision 4')).toBeInTheDocument(),
    );
    expect(explanation).toHaveValue('My retained review explanation');
  });
});
