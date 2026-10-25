import type { CrewDetail } from '@furniture-delivery/contracts';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { StaffTeams } from './staff-teams';

vi.mock('../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const apiMock = vi.mocked(apiRequest);
const crew: CrewDetail = {
  id: 'crew-1',
  code: 'DEMO-01',
  name: 'My team',
  active: true,
  workEnvironment: 'INDOOR',
  serviceArea: 'North',
  createdAt: '2026-10-25T00:00:00Z',
  updatedAt: '2026-10-25T00:00:00Z',
  members: [
    {
      id: 'membership-1',
      userId: 'user-1',
      crewId: 'crew-1',
      active: true,
      createdAt: '2026-10-25T00:00:00Z',
      updatedAt: '2026-10-25T00:00:00Z',
      user: {
        id: 'user-1',
        username: 'worker',
        displayName: 'My colleague',
        active: true,
        role: 'CREW_MEMBER',
      },
    },
  ],
  contacts: [],
};

beforeEach(() => {
  apiMock.mockReset();
});

describe('staff team workspace', () => {
  it('shows only the returned team composition with no administrative controls', async () => {
    apiMock.mockResolvedValueOnce({ crews: [crew] }).mockResolvedValueOnce({ crew });
    render(<StaffTeams />);
    expect(await screen.findByText('My colleague')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /add|save|deactivate|create/i }),
    ).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(
      '/crews',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(apiMock).toHaveBeenCalledWith('/crews/crew-1', expect.any(Object));
  });

  it('shows a useful empty state when membership is absent', async () => {
    apiMock.mockResolvedValue({ crews: [] });
    render(<StaffTeams />);
    expect(await screen.findByText('No team assignment')).toBeInTheDocument();
  });

  it('shows denied access and retry when current permissions no longer allow the read', async () => {
    apiMock.mockRejectedValue(new ApiError(403, 'Access denied.'));
    render(<StaffTeams />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
