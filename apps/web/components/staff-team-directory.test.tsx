import type { CrewDetail } from '@furniture-delivery/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { planningCrews } from '../test/planning-fixture';
import { deferred, realtimeUser } from '../test/realtime-fixture';
import { useCurrentUser } from './session-provider';
import { StaffTeams } from './staff-teams';
vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
vi.mock('./session-provider', () => ({ useCurrentUser: vi.fn() }));
const api = vi.mocked(apiRequest);
const auth = vi.mocked(useCurrentUser);
const member = {
  id: 'member-1',
  crewId: planningCrews[0]!.id,
  userId: 'crew-user',
  active: true,
  createdAt: '2030-01-07T08:00:00Z',
  updatedAt: '2030-01-07T08:00:00Z',
  user: {
    id: 'crew-user',
    username: 'fixture.worker',
    displayName: 'Fixture team member',
    active: true,
    role: 'CREW_MEMBER' as const,
  },
};
const contact = {
  id: 'contact-1',
  crewId: planningCrews[0]!.id,
  name: 'Fixture electrician',
  specialty: 'Electrical installations',
  phone: '+39 000 444',
  email: 'fixture@example.test',
  active: true,
  createdAt: member.createdAt,
  updatedAt: member.updatedAt,
};
const crew: CrewDetail = {
  ...planningCrews[0]!,
  name: 'Fixture shared team',
  members: [member],
  contacts: [contact],
};
beforeEach(() => {
  api.mockReset();
  auth.mockReturnValue({
    ...realtimeUser,
    id: 'crew-user',
    role: 'CREW_MEMBER',
    crewIds: [crew.id],
  });
});
function responses(detail = crew) {
  api.mockImplementation(async (path) =>
    path === '/crews' ? { crews: [detail] } : { crew: detail },
  );
}
describe('Read-only My team directory', () => {
  it.each(['ADMIN', 'DISPATCHER'] as const)(
    'does not load staff data for %s in this workspace',
    (role) => {
      auth.mockReturnValue({ ...realtimeUser, role });
      render(<StaffTeams />);
      expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
      expect(api).not.toHaveBeenCalled();
    },
  );
  it('shows complete allowed records and filters names, specialties and shared contact values locally', async () => {
    const detail = {
      ...crew,
      active: false,
      members: [
        member,
        {
          ...member,
          id: 'member-2',
          userId: 'colleague',
          active: false,
          user: {
            ...member.user,
            id: 'colleague',
            username: 'fixture.colleague',
            displayName: 'Former colleague',
            active: false,
          },
        },
      ],
    };
    responses(detail);
    render(<StaffTeams />);
    await screen.findByText('Fixture electrician');
    expect(screen.getByText('Team disabled')).toBeInTheDocument();
    expect(screen.getByText('Inactive member')).toBeInTheDocument();
    expect(screen.getByText('Account disabled')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call Fixture electrician' })).toHaveAttribute(
      'href',
      `tel:${contact.phone}`,
    );
    expect(screen.getByRole('link', { name: 'Email Fixture electrician' })).toHaveAttribute(
      'href',
      `mailto:${contact.email}`,
    );
    const search = screen.getByRole('searchbox', { name: 'Search team people' });
    for (const query of ['electrical', '000 444', 'example.test']) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getByText('Fixture electrician')).toBeInTheDocument();
      expect(screen.queryByText(member.user.displayName)).not.toBeInTheDocument();
    }
    fireEvent.change(search, { target: { value: 'fixture.worker' } });
    expect(screen.getByText(member.user.displayName)).toBeInTheDocument();
    expect(screen.queryByText('Fixture electrician')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear team search' }));
    expect(screen.getByText('Former colleague')).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(2);
    expect(
      api.mock.calls.every(
        ([path, options]) =>
          (path === '/crews' || path === `/crews/${crew.id}`) && !options?.method,
      ),
    ).toBe(true);
    expect(
      screen.queryByRole('button', { name: /add|save|deactivate|create/i }),
    ).not.toBeInTheDocument();
  });
  it('clears all team children when the authorized team list is revoked', async () => {
    let revoked = false;
    api.mockImplementation(async (path) => {
      if (path === '/crews') {
        if (revoked) throw new ApiError(403, 'Membership changed');
        return { crews: [crew] };
      }
      return { crew };
    });
    render(<StaffTeams />);
    await screen.findByText(contact.name);
    revoked = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh my team' }));
    await waitFor(() => expect(screen.queryByText(contact.name)).not.toBeInTheDocument());
    expect(screen.queryByText(member.user.displayName)).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
  });
  it.each([401, 403, 404])(
    'clears detail and contact links when detail access returns%s',
    async (status) => {
      let revoked = false;
      api.mockImplementation(async (path) => {
        if (path === '/crews') return { crews: [crew] };
        if (revoked) throw new ApiError(status, 'Team access changed');
        return { crew };
      });
      render(<StaffTeams />);
      await screen.findByText(contact.name);
      revoked = true;
      fireEvent.click(screen.getByRole('button', { name: 'Refresh my team' }));
      await screen.findByRole('alert');
      expect(screen.queryByText(crew.name)).not.toBeInTheDocument();
      expect(screen.queryByText(contact.name)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: 'Call Fixture electrician' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    },
  );
  it('retains the same team card and search through transient failures of both reads', async () => {
    let unavailable = false;
    api.mockImplementation(async (path) => {
      if (unavailable) throw new ApiError(503, 'Team temporarily unavailable');
      return path === '/crews' ? { crews: [crew] } : { crew };
    });
    render(<StaffTeams />);
    const card = await screen.findByRole('article', {
      name: 'External specialist Fixture electrician',
    });
    const search = screen.getByRole('searchbox', { name: 'Search team people' });
    fireEvent.change(search, { target: { value: 'electrical' } });
    unavailable = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh my team' }));
    await screen.findAllByRole('alert');
    expect(screen.getByRole('article', { name: 'External specialist Fixture electrician' })).toBe(
      card,
    );
    expect(screen.getByRole('searchbox')).toBe(search);
    expect(search).toHaveValue('electrical');
    expect(within(card).getByRole('link', { name: 'Call Fixture electrician' })).toHaveAttribute(
      'href',
      `tel:${contact.phone}`,
    );
  });
  it('discards an old team and its late detail response after current membership changes', async () => {
    const late = deferred<unknown>();
    const next = {
      ...crew,
      id: 'next-crew',
      name: 'Different shared team',
      members: [],
      contacts: [],
    };
    let moved = false;
    api.mockImplementation(async (path) => {
      if (path === '/crews') return { crews: [moved ? next : crew] };
      if (path === `/crews/${crew.id}`) return moved ? late.promise : { crew };
      return { crew: next };
    });
    render(<StaffTeams />);
    await screen.findByText(contact.name);
    moved = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh my team' }));
    await screen.findByRole('heading', { name: next.name });
    const oldReads = api.mock.calls.filter(([path]) => path === `/crews/${crew.id}`);
    expect(oldReads).toHaveLength(2);
    expect(oldReads.at(-1)![1]?.signal?.aborted).toBe(true);
    await act(async () => late.resolve({ crew }));
    expect(screen.queryByText(crew.name)).not.toBeInTheDocument();
    expect(screen.queryByText(contact.name)).not.toBeInTheDocument();
    expect(screen.getByText('No external contacts.')).toBeInTheDocument();
    expect(screen.getByText('No team members to display.')).toBeInTheDocument();
  });
});
