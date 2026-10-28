import type { AuthUser } from '@furniture-delivery/contracts';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceStatusNavigation } from './service-status-navigation';
import { loadSession } from '../lib/server-session';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
vi.mock('../lib/server-session', () => ({ loadSession: vi.fn() }));

const sessionMock = vi.mocked(loadSession);
const user: AuthUser = {
  id: 'fixture-user',
  username: 'fixture',
  displayName: 'Fixture',
  role: 'ADMIN',
  active: true,
  crewIds: [],
};

beforeEach(() => {
  sessionMock.mockReset();
});

describe('Service status navigation', () => {
  it.each(['ADMIN', 'DISPATCHER'] as const)(
    'retains the menu and marks Service status for %s',
    async (role) => {
      sessionMock.mockResolvedValue({ kind: 'authenticated', user: { ...user, role } });
      render(await ServiceStatusNavigation());
      const nav = screen.getByRole('navigation', { name: 'Backoffice' });
      expect(within(nav).getByRole('link', { name: 'Service status' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(nav.querySelectorAll('[aria-current]')).toHaveLength(1);
      expect(Boolean(within(nav).queryByRole('link', { name: 'Accounts' }))).toBe(role === 'ADMIN');
    },
  );

  it.each(['anonymous', 'unavailable'] as const)(
    'keeps health public when the session is %s',
    async (kind) => {
      sessionMock.mockResolvedValue({ kind });
      render(await ServiceStatusNavigation());
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    },
  );

  it('keeps backoffice links out of the crew public status page', async () => {
    sessionMock.mockResolvedValue({
      kind: 'authenticated',
      user: { ...user, role: 'CREW_MEMBER' },
    });
    render(await ServiceStatusNavigation());
    expect(screen.queryByRole('navigation', { name: 'Backoffice' })).not.toBeInTheDocument();
  });
});
