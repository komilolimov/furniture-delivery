import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CrewAssignmentListResponse,
  CrewAssignmentSummary,
} from '@furniture-delivery/contracts';
import { apiRequest, ApiError } from '../lib/api-client';
import { crewAssignmentFixture } from '../test/execution-fixture';
import { CrewWorkList } from './crew-work-list';
vi.mock('../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const apiMock = vi.mocked(apiRequest);
const list = (
  assignments: CrewAssignmentSummary[] = [crewAssignmentFixture],
  overrides: Partial<CrewAssignmentListResponse> = {},
): CrewAssignmentListResponse => ({
  assignments,
  total: assignments.length,
  page: 1,
  pageSize: 10,
  businessDate: '2030-01-07',
  timeZone: 'Europe/Rome',
  ...overrides,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
beforeEach(() => {
  apiMock.mockReset();
});
describe('M5 team work views', () => {
  it('shows loading followed by the real empty view and bounds pagination', async () => {
    const pending = deferred<CrewAssignmentListResponse>();
    apiMock.mockReturnValueOnce(pending.promise);
    render(<CrewWorkList />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.getByRole('button', { name: 'Refresh work' })).toBeDisabled();
    await act(async () => pending.resolve(list([])));
    expect(
      screen.getByRole('heading', { name: 'No assignments in this view' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/0 assignments · Page 1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('renders own assignment routes, Rome planned time and a precise late-execution warning', async () => {
    apiMock.mockResolvedValue(
      list([
        {
          ...crewAssignmentFixture,
          execution: {
            ...crewAssignmentFixture.execution,
            status: 'ON_THE_WAY',
            version: 2,
            departedAt: '2030-01-07T08:00:00.000Z',
            maybeDelayed: true,
          },
        },
      ]),
    );
    render(<CrewWorkList />);
    const link = await screen.findByRole('link', { name: "Open my team's visit" });
    expect(link).toHaveAttribute('href', '/crew/assignments/' + crewAssignmentFixture.id);
    expect(screen.getByText(/09:00.*10:00/)).toBeInTheDocument();
    expect(screen.getByText(/Possibly delayed: no finish recorded/)).toBeInTheDocument();
    expect(screen.getByText(/On the way/)).toBeInTheDocument();
    expect(screen.getByText(/Europe\/Rome \(2030-01-07\)/)).toBeInTheDocument();
  });
  it('keeps server pagination/filter state explicit and resets the page on view or page-size changes', async () => {
    apiMock.mockImplementation(async (path) => {
      const query = new URL(path, 'http://fixture.invalid').searchParams,
        page = Number(query.get('page')),
        pageSize = Number(query.get('pageSize'));
      return list([{ ...crewAssignmentFixture, customerName: 'Fixture page ' + page }], {
        page,
        pageSize,
        total: 23,
      });
    });
    render(<CrewWorkList />);
    await screen.findByRole('link', { name: 'Fixture page 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('link', { name: 'Fixture page 2' });
    expect(apiMock.mock.calls.at(-1)![0]).toBe('/crew/assignments?view=today&page=2&pageSize=10');
    expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Assignments per page'), { target: { value: '25' } });
    await waitFor(() =>
      expect(apiMock.mock.calls.at(-1)![0]).toBe('/crew/assignments?view=today&page=1&pageSize=25'),
    );
    await screen.findByText(/23 assignments · Page 1/);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
    await waitFor(() =>
      expect(apiMock.mock.calls.at(-1)![0]).toBe(
        '/crew/assignments?view=completed&page=1&pageSize=25',
      ),
    );
    expect(screen.getByRole('button', { name: 'Completed' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('hides the old view immediately and ignores its late response after a different work view loads', async () => {
    const old = deferred<CrewAssignmentListResponse>(),
      upcoming = deferred<CrewAssignmentListResponse>();
    apiMock
      .mockResolvedValueOnce(list([{ ...crewAssignmentFixture, customerName: 'Today customer' }]))
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(upcoming.promise);
    render(<CrewWorkList />);
    await screen.findByRole('link', { name: 'Today customer' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh work' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Upcoming' }));
    expect(screen.queryByRole('link', { name: 'Today customer' })).not.toBeInTheDocument();
    expect(apiMock.mock.calls[1]![1]?.signal?.aborted).toBe(true);
    await act(async () =>
      upcoming.resolve(list([{ ...crewAssignmentFixture, customerName: 'Upcoming customer' }])),
    );
    await act(async () =>
      old.resolve(list([{ ...crewAssignmentFixture, customerName: 'Late today customer' }])),
    );
    expect(screen.getByRole('link', { name: 'Upcoming customer' })).toBeInTheDocument();
    expect(screen.queryByText('Late today customer')).not.toBeInTheDocument();
  });
  it('shows a failed read with Retry and clears protected cards after access is revoked', async () => {
    apiMock
      .mockRejectedValueOnce(new ApiError(503, 'API unavailable fixture'))
      .mockResolvedValueOnce(list())
      .mockRejectedValueOnce(new ApiError(403, 'Permission changed'));
    render(<CrewWorkList />);
    expect(await screen.findByRole('alert')).toHaveTextContent('API unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('link', { name: "Open my team's visit" });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh work' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Access denied'));
    expect(screen.queryByRole('link', { name: "Open my team's visit" })).not.toBeInTheDocument();
  });
});
