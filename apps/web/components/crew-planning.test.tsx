import type { CrewAvailabilityResponse } from '@furniture-delivery/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { appointmentFixture, fixtureActorId, planningCrews } from '../test/planning-fixture';
import { CrewPlanningEditor } from './crew-planning-editor';

vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const api = vi.mocked(apiRequest);
const crewId = planningCrews[0]!.id;
const availability = (): CrewAvailabilityResponse => ({
  config: {
    crewId,
    weeklyWindows: [
      { weekday: 1, startTime: '08:00', endTime: '12:00' },
      { weekday: 1, startTime: '13:00', endTime: '18:00' },
    ],
    travelBufferMinutes: 30,
    version: 1,
    updatedBy: null,
    createdAt: '2030-01-07T08:00:00Z',
    updatedAt: '2030-01-07T08:00:00Z',
  },
  unavailability: [],
  affectedAppointments: [],
});
beforeEach(() => {
  api.mockReset();
});

describe('crew planning configuration', () => {
  it('loads real data and saves a weekend split window with its loaded revision', async () => {
    const initial = availability();
    let result = initial;
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'PATCH') {
        result = {
          ...initial,
          config: { ...initial.config, ...(options.body as object), version: 2 },
        };
        return result;
      }
      return result;
    });
    render(<CrewPlanningEditor crewId={crewId} />);
    await screen.findByLabelText('Window 1 weekday');
    fireEvent.change(screen.getByLabelText('Window 1 weekday'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Window 2 weekday'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Default travel buffer (minutes)'), {
      target: { value: '0' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Working configuration' }));
    await screen.findByText(
      'Working configuration saved. Existing visits and their buffer snapshots were preserved.',
    );
    expect(api).toHaveBeenCalledWith(
      `/crews/${crewId}/planning`,
      expect.objectContaining({
        method: 'PATCH',
        body: {
          expectedVersion: 1,
          weeklyWindows: [
            { weekday: 6, startTime: '08:00', endTime: '12:00' },
            { weekday: 6, startTime: '13:00', endTime: '18:00' },
          ],
          travelBufferMinutes: 0,
        },
      }),
    );
    expect(screen.getByLabelText('Window 1 weekday')).toHaveValue('6');
  });
  it('keeps drafts and their original revision on 409 and focus, then explicitly reloads', async () => {
    const initial = availability(),
      latest = { ...initial, config: { ...initial.config, version: 3, travelBufferMinutes: 45 } };
    let gets = 0;
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'PATCH')
        throw new ApiError(409, 'The working configuration changed.');
      gets++;
      return gets === 1 ? initial : latest;
    });
    render(<CrewPlanningEditor crewId={crewId} />);
    await screen.findByLabelText('Default travel buffer (minutes)');
    fireEvent.change(screen.getByLabelText('Default travel buffer (minutes)'), {
      target: { value: '15' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Working configuration' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Default travel buffer (minutes)')).toHaveValue(15);
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(gets).toBe(2));
    expect(screen.getByLabelText('Default travel buffer (minutes)')).toHaveValue(15);
    fireEvent.submit(screen.getByRole('form', { name: 'Working configuration' }));
    await waitFor(() =>
      expect(api.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(2),
    );
    expect(
      api.mock.calls.filter(([, options]) => options?.method === 'PATCH')[1]?.[1]?.body,
    ).toMatchObject({ expectedVersion: 1, travelBufferMinutes: 15 });
    fireEvent.click(screen.getByRole('button', { name: 'Discard working-hours draft and reload' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Default travel buffer (minutes)')).toHaveValue(45),
    );
  });
  it('rejects overlapping windows locally and prevents a double submit during a pending save', async () => {
    let finish: ((value: CrewAvailabilityResponse) => void) | undefined;
    const initial = availability();
    api.mockImplementation(async (_path, options) =>
      options?.method === 'PATCH'
        ? new Promise<CrewAvailabilityResponse>((resolve) => {
            finish = resolve;
          })
        : initial,
    );
    render(<CrewPlanningEditor crewId={crewId} />);
    await screen.findByLabelText('Window 2 start');
    fireEvent.input(screen.getByLabelText('Window 2 start'), { target: { value: '11:59' } });
    const form = screen.getByRole('form', { name: 'Working configuration' });
    fireEvent.submit(form);
    await screen.findByText('Monday working windows overlap. Use separate windows for a break.');
    expect(api.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(0);
    fireEvent.input(screen.getByLabelText('Window 2 start'), { target: { value: '13:00' } });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(api.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1);
    await act(async () => {
      finish?.(initial);
    });
    await screen.findByText(
      'Working configuration saved. Existing visits and their buffer snapshots were preserved.',
    );
  });
  it('records absence with Rome inputs, keeps errors and shows affected visits without deleting them', async () => {
    const initial = availability();
    const interval = {
      id: 'absence-1',
      crewId,
      startAt: '2030-01-07T08:00:00Z',
      endAt: '2030-01-07T11:00:00Z',
      reason: 'Fictional absence',
      active: true,
      createdBy: fixtureActorId,
      updatedBy: fixtureActorId,
      createdAt: '2030-01-07T08:00:00Z',
      updatedAt: '2030-01-07T08:00:00Z',
    };
    const affected = {
      ...appointmentFixture,
      needsAttention: true,
      attention: [
        {
          crewId,
          code: 'UNAVAILABLE' as const,
          message: 'The team has a recorded unavailability interval.',
        },
      ],
    };
    let current = initial,
      attempted = false;
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') {
        if (!attempted) {
          attempted = true;
          throw new ApiError(400, 'This local time does not exist.');
        }
        current = { ...initial, unavailability: [interval], affectedAppointments: [affected] };
      }
      return current;
    });
    render(<CrewPlanningEditor crewId={crewId} />);
    await screen.findByText('No unavailability recorded.');
    fireEvent.click(screen.getByText('Record new unavailability'));
    const form = screen.getByRole('form', { name: 'Add unavailability' });
    fireEvent.change(within(form).getByLabelText('Local start (Europe/Rome)'), {
      target: { value: '2030-01-07T09:00' },
    });
    fireEvent.change(within(form).getByLabelText('Local end (Europe/Rome)'), {
      target: { value: '2030-01-07T12:00' },
    });
    fireEvent.change(within(form).getByLabelText('Unavailability reason'), {
      target: { value: 'Fictional absence' },
    });
    fireEvent.submit(form);
    await screen.findByText('This local time does not exist.');
    expect(within(form).getByLabelText('Unavailability reason')).toHaveValue('Fictional absence');
    fireEvent.submit(form);
    await screen.findByText('Unavailability recorded. Review affected appointments below.');
    expect(api).toHaveBeenCalledWith(
      `/crews/${crewId}/unavailability`,
      expect.objectContaining({
        method: 'POST',
        body: {
          localStart: '2030-01-07T09:00',
          localEnd: '2030-01-07T12:00',
          reason: 'Fictional absence',
        },
      }),
    );
    expect(screen.getByRole('link', { name: new RegExp(affected.orderNumber) })).toHaveAttribute(
      'href',
      `/backoffice/orders/${affected.orderId}`,
    );
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });
  it('loads retained intervals, permits logical disabling and shows inactive team warnings', async () => {
    const initial = availability();
    initial.unavailability = [
      {
        id: 'absence-2',
        crewId,
        startAt: '2030-01-07T08:00:00Z',
        endAt: '2030-01-07T11:00:00Z',
        reason: 'Retained absence',
        active: true,
        createdBy: fixtureActorId,
        updatedBy: fixtureActorId,
        createdAt: '2030-01-07T08:00:00Z',
        updatedAt: '2030-01-07T08:00:00Z',
      },
    ];
    api.mockImplementation(async () => initial);
    render(<CrewPlanningEditor crewId={crewId} active={false} />);
    await screen.findByText(/Retained absence/, { selector: 'summary' });
    expect(screen.getByText(/This team is inactive/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Retained absence/, { selector: 'summary' }));
    const form = screen.getByRole('form', { name: 'Edit unavailability absence-2' });
    expect(within(form).getByLabelText('Local start (Europe/Rome)')).toHaveValue(
      '2030-01-07T09:00',
    );
    fireEvent.click(within(form).getByLabelText('Unavailability active'));
    fireEvent.submit(form);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        `/crews/${crewId}/unavailability/absence-2`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.objectContaining({ active: false, reason: 'Retained absence' }),
        }),
      ),
    );
  });
});
