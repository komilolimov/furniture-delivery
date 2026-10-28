import type { CrewAvailabilityResponse } from '@furniture-delivery/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { fixtureActorId, planningCrews } from '../test/planning-fixture';
import { CrewPlanningEditor } from './crew-planning-editor';

vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const api = vi.mocked(apiRequest);
const crewId = planningCrews[0]!.id;
const privateReason = 'Synthetic retained absence visible only with planning access';
const initialAvailability = (): CrewAvailabilityResponse => ({
  config: {
    crewId,
    weeklyWindows: [{ weekday: 1, startTime: '08:00', endTime: '12:00' }],
    travelBufferMinutes: 30,
    version: 4,
    updatedBy: fixtureActorId,
    createdAt: '2030-01-07T08:00:00.000Z',
    updatedAt: '2030-01-07T08:00:00.000Z',
  },
  unavailability: [
    {
      id: 'synthetic-private-absence',
      crewId,
      startAt: '2030-01-08T08:00:00.000Z',
      endAt: '2030-01-08T11:00:00.000Z',
      reason: privateReason,
      active: true,
      createdBy: fixtureActorId,
      updatedBy: fixtureActorId,
      createdAt: '2030-01-07T08:00:00.000Z',
      updatedAt: '2030-01-07T08:00:00.000Z',
    },
  ],
  affectedAppointments: [],
});

beforeEach(() => {
  api.mockReset();
});

describe('team availability resource access and draft retention', () => {
  it.each([401, 403, 404])(
    'removes previously loaded working hours and absence data after a %s read',
    async (status) => {
      api
        .mockResolvedValueOnce(initialAvailability())
        .mockRejectedValue(
          new ApiError(status, 'Synthetic planning access is no longer available.'),
        );
      render(<CrewPlanningEditor crewId={crewId} />);
      await screen.findByRole('form', { name: 'Working configuration' });
      expect(screen.getByDisplayValue(privateReason)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Default travel buffer (minutes)'), {
        target: { value: '15' },
      });

      fireEvent(window, new Event('focus'));
      await screen.findByRole('alert');
      await waitFor(() => {
        expect(
          screen.queryByRole('form', { name: 'Working configuration', hidden: true }),
        ).not.toBeInTheDocument();
        expect(screen.queryByDisplayValue(privateReason)).not.toBeInTheDocument();
        expect(document.body).not.toHaveTextContent(privateReason);
        expect(
          screen.queryByRole('form', {
            name: 'Edit unavailability synthetic-private-absence',
            hidden: true,
          }),
        ).not.toBeInTheDocument();
      });
      expect(api).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    },
  );

  it('keeps a working-hours draft and its loaded revision after a transient 503 read', async () => {
    let current = initialAvailability();
    let unavailable = false;
    api.mockImplementation(async (_path, options) => {
      if (options?.method === 'PATCH') {
        const body = options.body as {
          weeklyWindows: CrewAvailabilityResponse['config']['weeklyWindows'];
          travelBufferMinutes: number;
        };
        current = {
          ...current,
          config: {
            ...current.config,
            weeklyWindows: body.weeklyWindows,
            travelBufferMinutes: body.travelBufferMinutes,
            version: 5,
          },
        };
        unavailable = false;
        return current;
      }
      if (unavailable) throw new ApiError(503, 'Synthetic availability service outage.');
      return current;
    });
    render(<CrewPlanningEditor crewId={crewId} />);
    const form = await screen.findByRole('form', { name: 'Working configuration' });
    fireEvent.change(screen.getByLabelText('Default travel buffer (minutes)'), {
      target: { value: '15' },
    });
    fireEvent.change(screen.getByLabelText('Window 1 start'), {
      target: { value: '09:00' },
    });

    unavailable = true;
    fireEvent(window, new Event('focus'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Synthetic availability service outage.',
    );
    expect(screen.getByRole('form', { name: 'Working configuration' })).toBe(form);
    expect(screen.getByLabelText('Default travel buffer (minutes)')).toHaveValue(15);
    expect(screen.getByLabelText('Window 1 start')).toHaveValue('09:00');
    expect(screen.getByDisplayValue(privateReason)).toBeInTheDocument();

    fireEvent.submit(form);
    await screen.findByText(
      'Working configuration saved. Existing visits and their buffer snapshots were preserved.',
    );
    expect(api).toHaveBeenCalledWith(
      `/crews/${crewId}/planning`,
      expect.objectContaining({
        method: 'PATCH',
        body: {
          expectedVersion: 4,
          weeklyWindows: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }],
          travelBufferMinutes: 15,
        },
      }),
    );
  });
});
