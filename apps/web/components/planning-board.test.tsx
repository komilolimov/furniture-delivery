import type { ReactNode } from 'react';
import type { CalendarResponse } from '@furniture-delivery/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { appointmentFixture, planningCrews } from '../test/planning-fixture';
import { PlanningBoard, planningTeamColor } from './planning-board';
import { settle } from '../test/realtime-fixture';
import { chooseSelectOption } from '../test/select-option';

type MockEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  url: string;
  color: string;
};
type MockCalendarProps = {
  events: MockEvent[];
  timeZone: string;
  initialView: string;
  initialDate: string;
  editable: boolean;
  selectable: boolean;
  eventContent: (info: { event: MockEvent }) => ReactNode;
  eventClick: (info: { event: MockEvent; jsEvent: { preventDefault: () => void } }) => void;
};
const mocks = vi.hoisted(() => ({
  mounts: vi.fn(),
  unmounts: vi.fn(),
  renders: vi.fn(),
  changeView: vi.fn(),
  gotoDate: vi.fn(),
}));
vi.mock('../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
vi.mock('@fullcalendar/react', async () => {
  const { forwardRef, useEffect, useImperativeHandle, useMemo, useState } = await import('react');
  return {
    default: forwardRef(function MockCalendar(props: MockCalendarProps, ref) {
      const [view, setView] = useState(props.initialView);
      const [date, setDate] = useState(props.initialDate);
      const api = useMemo(
        () => ({
          changeView(next: string, selected?: string) {
            mocks.changeView(next, selected);
            setView(next);
            if (selected) setDate(selected);
          },
          gotoDate(selected: string) {
            mocks.gotoDate(selected);
            setDate(selected);
          },
        }),
        [],
      );
      useImperativeHandle(ref, () => ({ getApi: () => api }), [api]);
      useEffect(() => {
        mocks.mounts();
        return () => {
          mocks.unmounts();
        };
      }, []);
      mocks.renders();
      return (
        <div
          data-testid="calendar"
          data-zone={props.timeZone}
          data-view={view}
          data-date={date}
          data-editable={String(props.editable)}
          data-selectable={String(props.selectable)}
        >
          {props.events.map((event) => (
            <button
              type="button"
              data-color={event.color}
              key={event.id}
              aria-label={`Open calendar event ${event.id}`}
              onClick={() => props.eventClick({ event, jsEvent: { preventDefault: vi.fn() } })}
            >
              {props.eventContent({ event })}
            </button>
          ))}
        </div>
      );
    }),
  };
});
vi.mock('@fullcalendar/react/timegrid', () => ({ default: {} }));
vi.mock('@fullcalendar/react/daygrid', () => ({ default: {} }));
vi.mock('@fullcalendar/react/list', () => ({ default: {} }));
vi.mock('@fullcalendar/react/themes/monarch', () => ({ default: {} }));
const apiMock = vi.mocked(apiRequest);
const calendar: CalendarResponse = {
  from: '2030-01-06T23:00:00.000Z',
  to: '2030-01-13T23:00:00.000Z',
  timeZone: 'Europe/Rome',
  appointments: [appointmentFixture],
};
const emptyRisks = {
  timeZone: 'Europe/Rome',
  dataAsOf: '2030-01-07T08:00:00.000Z',
  from: '2030-01-07',
  to: '2030-01-14',
  risks: [],
};
function respond<T>(path: string): Promise<T> {
  return Promise.resolve(
    (path === '/crews'
      ? { crews: planningCrews }
      : path.startsWith('/planning/risks?')
        ? {
            timeZone: 'Europe/Rome',
            dataAsOf: '2030-01-07T08:00:00.000Z',
            from: '2030-01-07',
            to: '2030-01-14',
            risks: [],
          }
        : calendar) as T,
  );
}
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};
beforeEach(() => {
  apiMock.mockReset();
  mocks.mounts.mockReset();
  mocks.unmounts.mockReset();
  mocks.renders.mockReset();
  mocks.changeView.mockReset();
  mocks.gotoDate.mockReset();
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('M4 calendar board', () => {
  it('rolls an active Today filter at Rome midnight but preserves a manually chosen date in another device timezone', async () => {
    const previousZone = process.env.TZ;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-07T22:59:00.000Z'));
    process.env.TZ = 'Asia/Tokyo';
    try {
      apiMock.mockImplementation(respond);
      render(<PlanningBoard />);
      await act(async () => settle());
      expect(screen.getByLabelText('Planning date')).toHaveValue('2030-01-07');
      vi.setSystemTime(new Date('2030-01-07T23:01:00.000Z'));
      await act(async () => {
        window.dispatchEvent(new Event('fd:clock-sync'));
        await settle();
      });
      expect(screen.getByLabelText('Planning date')).toHaveValue('2030-01-08');
      fireEvent.change(screen.getByLabelText('Planning date'), { target: { value: '2030-01-11' } });
      vi.setSystemTime(new Date('2030-01-08T23:01:00.000Z'));
      await act(async () => {
        window.dispatchEvent(new Event('fd:clock-sync'));
        await settle();
      });
      expect(screen.getByLabelText('Planning date')).toHaveValue('2030-01-11');
      fireEvent.click(screen.getByRole('button', { name: /^Today$/ }));
      expect(screen.getByLabelText('Planning date')).toHaveValue('2030-01-09');
    } finally {
      if (previousZone === undefined) delete process.env.TZ;
      else process.env.TZ = previousZone;
      vi.useRealTimers();
    }
  });
  it('renders a multi-team visit once and opens its real-data preview with team names and a full-visit link', async () => {
    apiMock.mockImplementation(respond);
    render(<PlanningBoard />);
    await screen.findByRole('button', { name: `Open calendar event ${appointmentFixture.id}` });
    const rendered = screen.getByTestId('calendar');
    expect(rendered).toHaveAttribute('data-zone', 'Europe/Rome');
    expect(rendered).toHaveAttribute('data-view', 'timeGridWeek');
    expect(rendered).toHaveAttribute('data-editable', 'false');
    expect(rendered).toHaveAttribute('data-selectable', 'false');
    const events = within(rendered).getAllByRole('button');
    expect(events).toHaveLength(1);
    expect(events[0]).toHaveTextContent('Aurora + Birch');
    expect(events[0]).toHaveTextContent('Needs confirmation');
    expect(events[0]).toHaveTextContent('09:00–10:00');
    expect(events[0]).toHaveAttribute('data-color', planningTeamColor(planningCrews[0]!.id));
    events[0]!.focus();
    fireEvent.click(events[0]!);
    const preview = await screen.findByRole('dialog', { name: 'Visit preview' });
    expect(
      within(preview).getByRole('heading', { name: appointmentFixture.customerName }),
    ).toBeInTheDocument();
    expect(within(preview).getByText('Aurora')).toBeInTheDocument();
    expect(within(preview).getByText('Birch')).toBeInTheDocument();
    expect(within(preview).getByRole('link', { name: 'Open full visit' })).toHaveAttribute(
      'href',
      `/backoffice/planning/orders/${appointmentFixture.orderId}/appointments/${appointmentFixture.id}`,
    );
    fireEvent.click(within(preview).getByRole('button', { name: 'Close preview' }));
    await waitFor(() => expect(events[0]).toHaveFocus());
  });
  it('uses List initially on a phone while keeping Day and Week available', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    apiMock.mockImplementation(respond);
    render(<PlanningBoard />);
    await screen.findByRole('button', { name: `Open calendar event ${appointmentFixture.id}` });
    expect(screen.getByTestId('calendar')).toHaveAttribute('data-view', 'listWeek');
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    await waitFor(() =>
      expect(screen.getByTestId('calendar')).toHaveAttribute('data-view', 'timeGridDay'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    await waitFor(() =>
      expect(screen.getByTestId('calendar')).toHaveAttribute('data-view', 'timeGridWeek'),
    );
  });
  it('keeps All teams, explicit selected teams and Unassigned as separate server filters, including inactive teams', async () => {
    apiMock.mockImplementation(respond);
    render(<PlanningBoard />);
    await screen.findByRole('button', { name: `Open calendar event ${appointmentFixture.id}` });
    fireEvent.click(screen.getByRole('button', { name: 'Teams & filters' }));
    const inactive = await screen.findByLabelText('Filter team Inactive Team');
    expect(inactive).toBeDisabled();
    expect(screen.getByLabelText('Include unassigned')).toBeChecked();
    fireEvent.click(screen.getByLabelText('All teams'));
    fireEvent.click(screen.getByLabelText('Include unassigned'));
    fireEvent.click(screen.getByLabelText('Filter team Aurora'));
    fireEvent.click(screen.getByLabelText('Filter team Birch'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => {
      const path = apiMock.mock.calls
        .filter(([path]) => path.startsWith('/planning/calendar?'))
        .at(-1)![0];
      const query = new URLSearchParams(path.split('?')[1]);
      expect(query.get('allTeams')).toBe('false');
      expect(query.get('includeUnassigned')).toBe('false');
      expect(query.get('crewIds')?.split(',')).toEqual([
        planningCrews[0]!.id,
        planningCrews[1]!.id,
      ]);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Teams & filters' }));
    expect(screen.getByLabelText('Filter team Inactive Team')).toBeEnabled();
    fireEvent.click(screen.getByLabelText('All teams'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => {
      const path = apiMock.mock.calls
        .filter(([path]) => path.startsWith('/planning/calendar?'))
        .at(-1)![0];
      const query = new URLSearchParams(path.split('?')[1]);
      expect(query.get('allTeams')).toBe('true');
      expect(query.get('crewIds')).toBe('');
      expect(query.get('includeUnassigned')).toBe('false');
    });
  });
  it('keeps a planning-date input event when another control rerenders and requests the new Rome week', async () => {
    apiMock.mockImplementation(respond);
    render(<PlanningBoard />);
    await screen.findByRole('button', { name: `Open calendar event ${appointmentFixture.id}` });
    fireEvent.input(screen.getByLabelText('Planning date'), { target: { value: '2030-01-07' } });
    fireEvent.click(screen.getByRole('button', { name: 'Teams & filters' }));
    fireEvent.click(screen.getByLabelText('Include unassigned'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(screen.getByLabelText('Planning date')).toHaveValue('2030-01-07');
    await waitFor(() => {
      const path = apiMock.mock.calls
        .filter(([path]) => path.startsWith('/planning/calendar?'))
        .at(-1)![0];
      const query = new URLSearchParams(path.split('?')[1]);
      expect(query.get('from')).toBe('2030-01-07');
      expect(query.get('to')).toBe('2030-01-14');
      expect(query.get('includeUnassigned')).toBe('false');
    });
  });

  it('shows loading, server error, Retry and the explicit empty range', async () => {
    let calls = 0;
    apiMock.mockImplementation(<T,>(path: string) => {
      if (path === '/crews') return Promise.resolve({ crews: planningCrews } as T);
      if (path.startsWith('/planning/risks?')) return Promise.resolve(emptyRisks as T);
      calls++;
      return calls === 1
        ? Promise.reject(new ApiError(503, 'Calendar unavailable'))
        : Promise.resolve({ ...calendar, appointments: [] } as T);
    });
    render(<PlanningBoard />);
    expect(
      screen.getAllByRole('status').some((node) => /Loading/.test(node.textContent ?? '')),
    ).toBe(true);
    await screen.findByText('Calendar unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('heading', { name: 'No visits in this range' }),
    ).toBeInTheDocument();
  });
  it('ignores an earlier week response after navigating to a newer period', async () => {
    const old = deferred<CalendarResponse>(),
      current = deferred<CalendarResponse>();
    let calls = 0;
    apiMock.mockImplementation(<T,>(path: string) => {
      if (path === '/crews') return Promise.resolve({ crews: planningCrews } as T);
      if (path.startsWith('/planning/risks?')) return Promise.resolve(emptyRisks as T);
      calls++;
      return (calls === 1 ? old.promise : current.promise) as Promise<T>;
    });
    render(<PlanningBoard />);
    await waitFor(() =>
      expect(
        apiMock.mock.calls.filter(([path]) => path.startsWith('/planning/calendar?')),
      ).toHaveLength(1),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    await waitFor(() =>
      expect(
        apiMock.mock.calls.filter(([path]) => path.startsWith('/planning/calendar?')),
      ).toHaveLength(2),
    );
    await act(async () =>
      current.resolve({
        ...calendar,
        appointments: [{ ...appointmentFixture, customerName: 'Current period customer' }],
      }),
    );
    expect(await screen.findByTestId('calendar')).toHaveTextContent('Current period customer');
    await act(async () =>
      old.resolve({
        ...calendar,
        appointments: [{ ...appointmentFixture, customerName: 'Obsolete period customer' }],
      }),
    );
    expect(screen.getByTestId('calendar')).toHaveTextContent('Current period customer');
    expect(screen.getByTestId('calendar')).not.toHaveTextContent('Obsolete period customer');
  });
});

describe('M5 calendar execution indicators', () => {
  it('keeps one multi-team event and shows server work/issue/return and actual-time indicators', async () => {
    const appointment = {
      ...appointmentFixture,
      execution: {
        ...appointmentFixture.execution,
        orderProgress: 'IN_PROGRESS' as const,
        activeCount: 1,
        openIssueCount: 3,
        returnVisitRequired: true,
        maybeDelayed: true,
      },
      assignments: appointmentFixture.assignments.map((assignment, index) => ({
        ...assignment,
        execution:
          index === 0
            ? {
                ...assignment.execution,
                status: 'IN_PROGRESS' as const,
                departedAt: '2030-01-07T07:00:00Z',
                arrivedAt: '2030-01-07T07:30:00Z',
                actualStartAt: '2030-01-07T08:00:00Z',
                maybeDelayed: true,
              }
            : assignment.execution,
      })),
    };
    apiMock.mockImplementation(
      <T,>(path: string): Promise<T> =>
        Promise.resolve(
          (path === '/crews'
            ? { crews: planningCrews }
            : path.startsWith('/planning/risks?')
              ? emptyRisks
              : { ...calendar, appointments: [appointment] }) as T,
        ),
    );
    render(<PlanningBoard />);
    await screen.findByRole('button', { name: `Open calendar event ${appointmentFixture.id}` });
    const rendered = screen.getByTestId('calendar');
    const events = within(rendered).getAllByRole('button');
    expect(events).toHaveLength(1);
    expect(events[0]).toHaveTextContent('In progress');
    expect(events[0]).toHaveTextContent('1 active');
    expect(events[0]).toHaveTextContent('3 issues');
    expect(events[0]).toHaveTextContent('Return required');
    expect(events[0]).toHaveTextContent('Possibly delayed');
    fireEvent.click(events[0]!);
    const preview = await screen.findByRole('dialog', { name: 'Visit preview' });
    const team = within(preview).getByText('Aurora').closest('li')!;
    expect(within(team).getByText('Work in progress')).toBeInTheDocument();
    expect(within(team).getByText('Departed').nextElementSibling).toHaveTextContent('08:00');
    expect(within(team).getByText('Actual start').nextElementSibling).toHaveTextContent('09:00');
    expect(within(team).getByText('Actual end').nextElementSibling).toHaveTextContent(
      'Not recorded',
    );
  });
});

describe('Planning workspace navigation and update boundaries', () => {
  it('uses one disclosure icon and expands the complete visit list without refetching or rerendering the calendar', async () => {
    apiMock.mockImplementation(respond);
    render(<PlanningBoard />);
    await screen.findByRole('button', { name: `Open calendar event ${appointmentFixture.id}` });
    const summary = screen.getByText('Complete visit list (1)');
    const details = summary.closest('details')!;
    const icon = summary.querySelector('svg')!;
    const calls = apiMock.mock.calls.length;
    const renders = mocks.renders.mock.calls.length;

    expect(summary.querySelectorAll('svg')).toHaveLength(1);
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(details).not.toHaveAttribute('open');
    expect(within(details).queryByRole('link', { name: 'Open visit' })).not.toBeInTheDocument();

    fireEvent.click(summary);
    expect(await within(details).findByRole('link', { name: 'Open visit' })).toHaveAttribute(
      'href',
      `/backoffice/planning/orders/${appointmentFixture.orderId}/appointments/${appointmentFixture.id}`,
    );
    expect(details).toHaveAttribute('open');
    expect(summary.querySelectorAll('svg')).toHaveLength(1);
    expect(summary.querySelector('svg')).toBe(icon);
    fireEvent.click(summary);
    await waitFor(() => expect(details).not.toHaveAttribute('open'));
    await waitFor(() =>
      expect(within(details).queryByRole('link', { name: 'Open visit' })).not.toBeInTheDocument(),
    );
    expect(apiMock).toHaveBeenCalledTimes(calls);
    expect(mocks.renders).toHaveBeenCalledTimes(renders);
  });

  it('keeps the same calendar mounted through refresh, pending navigation and view changes', async () => {
    const refreshed = deferred<CalendarResponse>(),
      next = deferred<CalendarResponse>();
    let calendarCalls = 0;
    apiMock.mockImplementation(<T,>(path: string) => {
      if (!path.startsWith('/planning/calendar?')) return respond<T>(path);
      calendarCalls++;
      if (calendarCalls === 1) return Promise.resolve(calendar as T);
      return (calendarCalls === 2 ? refreshed.promise : next.promise) as Promise<T>;
    });
    render(<PlanningBoard />);
    await screen.findByRole('button', { name: `Open calendar event ${appointmentFixture.id}` });
    const instance = screen.getByTestId('calendar');
    expect(mocks.mounts).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh schedule' }));
    await waitFor(() => expect(calendarCalls).toBe(2));
    expect(screen.getByTestId('calendar')).toBe(instance);
    expect(screen.getByRole('region', { name: 'Visit calendar workspace' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(
      within(instance).getByRole('button', {
        name: `Open calendar event ${appointmentFixture.id}`,
      }),
    ).toBeInTheDocument();
    expect(mocks.unmounts).not.toHaveBeenCalled();
    await act(async () =>
      refreshed.resolve({
        ...calendar,
        appointments: [{ ...appointmentFixture, customerName: 'Refreshed range customer' }],
      }),
    );
    expect(instance).toHaveTextContent('Refreshed range customer');

    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    await waitFor(() => expect(calendarCalls).toBe(3));
    expect(screen.getByTestId('calendar')).toBe(instance);
    expect(
      within(instance).queryByRole('button', {
        name: `Open calendar event ${appointmentFixture.id}`,
      }),
    ).not.toBeInTheDocument();
    expect(mocks.gotoDate).toHaveBeenCalledTimes(1);
    expect(mocks.unmounts).not.toHaveBeenCalled();
    await act(async () => next.resolve(calendar));
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(screen.getByTestId('calendar')).toBe(instance);
    expect(instance).toHaveAttribute('data-view', 'dayGridMonth');
    expect(mocks.changeView).toHaveBeenCalledWith('dayGridMonth', expect.any(String));
    expect(mocks.mounts).toHaveBeenCalledTimes(1);
    expect(mocks.unmounts).not.toHaveBeenCalled();
  });

  it('does not call the API or rerender the calendar while typing search or editing unapplied filters', async () => {
    apiMock.mockImplementation(respond);
    render(<PlanningBoard />);
    await screen.findByRole('button', { name: `Open calendar event ${appointmentFixture.id}` });
    const calls = apiMock.mock.calls.length;
    const renders = mocks.renders.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Previous picker month' }));
    expect(apiMock).toHaveBeenCalledTimes(calls);
    expect(mocks.renders).toHaveBeenCalledTimes(renders);
    fireEvent.change(screen.getByLabelText('Search this range'), {
      target: { value: 'Unsent customer query' },
    });
    expect(apiMock).toHaveBeenCalledTimes(calls);
    expect(mocks.renders).toHaveBeenCalledTimes(renders);
    fireEvent.click(screen.getByRole('button', { name: 'Teams & filters' }));
    const dialog = await screen.findByRole('dialog', { name: 'Planning filters' });
    fireEvent.click(within(dialog).getByLabelText('All teams'));
    fireEvent.click(within(dialog).getByLabelText('Filter team Aurora'));
    fireEvent.change(within(dialog).getByLabelText('Find teams'), { target: { value: 'Birch' } });
    expect(apiMock).toHaveBeenCalledTimes(calls);
    expect(mocks.renders).toHaveBeenCalledTimes(renders);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close planning filters' }));
    expect(screen.getByLabelText('Search this range')).toHaveValue('Unsent customer query');
    expect(apiMock).toHaveBeenCalledTimes(calls);
    expect(mocks.renders).toHaveBeenCalledTimes(renders);
    fireEvent.click(screen.getByRole('button', { name: 'Teams & filters' }));
    expect(screen.getByLabelText('All teams')).toBeChecked();
    expect(screen.getByLabelText('Filter team Aurora')).not.toBeChecked();
  });

  it('keeps the calendar render and request stable when choosing another day inside the visible week', async () => {
    apiMock.mockImplementation(respond);
    render(<PlanningBoard />);
    await screen.findByRole('button', { name: `Open calendar event ${appointmentFixture.id}` });
    fireEvent.change(screen.getByLabelText('Planning date'), { target: { value: '2030-01-07' } });
    await waitFor(() => {
      const path = apiMock.mock.calls
        .filter(([path]) => path.startsWith('/planning/calendar?'))
        .at(-1)![0];
      expect(new URLSearchParams(path.split('?')[1]).get('from')).toBe('2030-01-07');
    });
    await screen.findByRole('button', { name: `Open calendar event ${appointmentFixture.id}` });
    const calls = apiMock.mock.calls.length;
    const renders = mocks.renders.mock.calls.length;
    const navigations = mocks.gotoDate.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Planning date'), { target: { value: '2030-01-08' } });
    await act(async () => settle());
    expect(screen.getByLabelText('Planning date')).toHaveValue('2030-01-08');
    expect(apiMock).toHaveBeenCalledTimes(calls);
    expect(mocks.renders).toHaveBeenCalledTimes(renders);
    expect(mocks.gotoDate).toHaveBeenCalledTimes(navigations);
    expect(mocks.mounts).toHaveBeenCalledTimes(1);
  });

  it('applies search and local status filters to the complete fetched range without new REST requests', async () => {
    apiMock.mockImplementation(respond);
    render(<PlanningBoard />);
    await screen.findByRole('button', { name: `Open calendar event ${appointmentFixture.id}` });
    const paths = apiMock.mock.calls.map(([path]) => path);
    fireEvent.change(screen.getByLabelText('Search this range'), {
      target: { value: 'No such fixture customer' },
    });
    fireEvent.submit(screen.getByRole('search', { name: 'Search current planning range' }));
    expect(await screen.findByRole('heading', { name: 'No matching visits' })).toBeInTheDocument();
    expect(within(screen.getByTestId('calendar')).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 0 of 1 visits/)).toBeInTheDocument();
    expect(apiMock.mock.calls.map(([path]) => path)).toEqual(paths);
    fireEvent.click(screen.getByRole('button', { name: 'Clear visit search' }));
    expect(
      within(screen.getByTestId('calendar')).getByRole('button', {
        name: `Open calendar event ${appointmentFixture.id}`,
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Teams & filters' }));
    await chooseSelectOption('Confirmation', 'Confirmed');
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(await screen.findByRole('heading', { name: 'No matching visits' })).toBeInTheDocument();
    expect(apiMock.mock.calls.map(([path]) => path)).toEqual(paths);
    fireEvent.click(screen.getByRole('button', { name: 'Remove confirmation filter' }));
    expect(
      within(screen.getByTestId('calendar')).getByRole('button', {
        name: `Open calendar event ${appointmentFixture.id}`,
      }),
    ).toBeInTheDocument();
    expect(apiMock.mock.calls.map(([path]) => path)).toEqual(paths);
  });

  it('requests all six Monday-first month rows and moves to the next month without remounting', async () => {
    apiMock.mockImplementation(respond);
    render(<PlanningBoard />);
    await screen.findByRole('button', { name: `Open calendar event ${appointmentFixture.id}` });
    fireEvent.change(screen.getByLabelText('Planning date'), { target: { value: '2030-01-07' } });
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    await waitFor(() => {
      const path = apiMock.mock.calls
        .filter(([path]) => path.startsWith('/planning/calendar?'))
        .at(-1)![0];
      const query = new URLSearchParams(path.split('?')[1]);
      expect(query.get('from')).toBe('2029-12-31');
      expect(query.get('to')).toBe('2030-02-11');
    });
    expect(screen.getByTestId('calendar')).toHaveAttribute('data-view', 'dayGridMonth');
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    await waitFor(() => {
      const path = apiMock.mock.calls
        .filter(([path]) => path.startsWith('/planning/calendar?'))
        .at(-1)![0];
      const query = new URLSearchParams(path.split('?')[1]);
      expect(query.get('from')).toBe('2030-01-28');
      expect(query.get('to')).toBe('2030-03-11');
    });
    expect(screen.getByLabelText('Planning date')).toHaveValue('2030-02-07');
    expect(mocks.mounts).toHaveBeenCalledTimes(1);
    expect(mocks.unmounts).not.toHaveBeenCalled();
  });

  it('clears calendar events and the opened preview when access is revoked during refresh', async () => {
    apiMock.mockImplementation(respond);
    render(<PlanningBoard />);
    const event = await screen.findByRole('button', {
      name: `Open calendar event ${appointmentFixture.id}`,
    });
    fireEvent.click(event);
    await screen.findByRole('dialog', { name: 'Visit preview' });
    apiMock.mockImplementation(<T,>(path: string) =>
      path.startsWith('/planning/calendar?')
        ? Promise.reject(new ApiError(403, 'Access revoked'))
        : respond<T>(path),
    );
    await act(async () => {
      window.dispatchEvent(new Event('fd:planning-changed'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.queryByRole('dialog', { name: 'Visit preview' })).not.toBeInTheDocument();
    expect(within(screen.getByTestId('calendar')).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByTestId('calendar')).not.toHaveTextContent(appointmentFixture.customerName);
    expect(mocks.mounts).toHaveBeenCalledTimes(1);
  });
});
