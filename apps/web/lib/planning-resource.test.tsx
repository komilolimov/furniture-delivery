import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarResponse } from '@furniture-delivery/contracts';
import { apiRequest, ApiError } from './api-client';
import { isCalendarResponse } from './planning-guards';
import { useOrderResource } from './use-order-resource';
import { appointmentFixture } from '../test/planning-fixture';

vi.mock('./api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api-client')>()),
  apiRequest: vi.fn(),
}));
const apiMock = vi.mocked(apiRequest);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const response = (customerName: string): CalendarResponse => ({
  from: '2030-01-06T23:00:00.000Z',
  to: '2030-01-13T23:00:00.000Z',
  timeZone: 'Europe/Rome',
  appointments: [{ ...appointmentFixture, customerName }],
});
function CalendarProbe({ path }: Readonly<{ path: string }>) {
  const resource = useOrderResource(path, isCalendarResponse);
  return (
    <>
      <span role="status">{resource.pending ? 'Loading calendar' : 'Loaded'}</span>
      {resource.error && <p role="alert">{resource.error}</p>}
      {resource.data?.appointments.map((appointment) => (
        <p key={appointment.id}>{appointment.customerName}</p>
      ))}
    </>
  );
}
beforeEach(() => {
  apiMock.mockReset();
});

describe('M4 bounded calendar request lifecycle', () => {
  it('aborts an older week and ignores its late response after the current week completes', async () => {
    const old = deferred<CalendarResponse>(),
      current = deferred<CalendarResponse>();
    apiMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { rerender } = render(
      <CalendarProbe path="/planning/calendar?from=2030-01-07&to=2030-01-14&allTeams=true&includeUnassigned=true" />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    const previousSignal = apiMock.mock.calls[0]![1]?.signal;
    rerender(
      <CalendarProbe path="/planning/calendar?from=2030-01-14&to=2030-01-21&allTeams=true&includeUnassigned=true" />,
    );
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(previousSignal?.aborted).toBe(true);
    await act(async () => current.resolve(response('Current week customer')));
    expect(screen.getByText('Current week customer')).toBeInTheDocument();
    await act(async () => old.resolve(response('Stale week customer')));
    expect(screen.queryByText('Stale week customer')).not.toBeInTheDocument();
    expect(screen.getByText('Current week customer')).toBeInTheDocument();
  });
  it('ignores a replaced team-filter request error instead of erasing the current selection', async () => {
    const old = deferred<CalendarResponse>();
    apiMock
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(response('Selected team customer'));
    const { rerender } = render(
      <CalendarProbe path="/planning/calendar?from=2030-01-07&to=2030-01-14&allTeams=true&includeUnassigned=true" />,
    );
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    rerender(
      <CalendarProbe path="/planning/calendar?from=2030-01-07&to=2030-01-14&allTeams=false&crewIds=selected&includeUnassigned=false" />,
    );
    await screen.findByText('Selected team customer');
    await act(async () => old.reject(new ApiError(503, 'Old range failed')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Selected team customer')).toBeInTheDocument();
  });
  it('rereads the server on planning mutations and focus rather than retaining an old calendar', async () => {
    apiMock.mockResolvedValue(response('Initial calendar'));
    render(
      <CalendarProbe path="/planning/calendar?from=2030-01-07&to=2030-01-14&allTeams=true&includeUnassigned=true" />,
    );
    await screen.findByText('Initial calendar');
    apiMock.mockResolvedValue(response('Refreshed calendar'));
    await act(async () => window.dispatchEvent(new Event('fd:orders-changed')));
    await screen.findByText('Refreshed calendar');
    await act(async () => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));
  });
});
