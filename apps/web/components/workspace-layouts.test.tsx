import type { AuthUser } from '@furniture-delivery/contracts';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BackofficeLayout from '../app/backoffice/layout';
import CrewLayout from '../app/crew/layout';
import { loadSession } from '../lib/server-session';

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  pathname: '/crew',
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
  redirect: navigation.redirect,
  usePathname: () => navigation.pathname,
}));
vi.mock('../lib/server-session', () => ({ loadSession: vi.fn() }));
const sessionMock = vi.mocked(loadSession);
const user: AuthUser = {
  id: 'user-1',
  username: 'worker',
  displayName: 'Worker',
  role: 'CREW_MEMBER',
  active: true,
  crewIds: [],
};

beforeEach(() => {
  sessionMock.mockReset();
  navigation.pathname = '/crew';
  navigation.redirect.mockClear();
});

describe('server workspace boundaries', () => {
  it('redirects anonymous visitors before rendering protected children', async () => {
    sessionMock.mockResolvedValue({ kind: 'anonymous' });
    await expect(BackofficeLayout({ children: <p>Protected content</p> })).rejects.toThrow(
      'redirect:/login',
    );
  });

  it('redirects staff away from the backoffice', async () => {
    sessionMock.mockResolvedValue({ kind: 'authenticated', user });
    await expect(BackofficeLayout({ children: <p>Protected content</p> })).rejects.toThrow(
      'redirect:/crew',
    );
  });

  it('keeps account navigation out of the dispatcher layout', async () => {
    sessionMock.mockResolvedValue({ kind: 'authenticated', user: { ...user, role: 'DISPATCHER' } });
    render(await BackofficeLayout({ children: <p>Teams content</p> }));
    expect(screen.getByRole('link', { name: 'Teams' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Teams' })).toHaveAttribute(
      'href',
      '/backoffice/crews',
    );
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute(
      'href',
      '/backoffice/orders',
    );
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/backoffice');
    expect(screen.queryByRole('link', { name: 'Accounts' })).not.toBeInTheDocument();
  });

  it('shows account management navigation for administrators', async () => {
    sessionMock.mockResolvedValue({ kind: 'authenticated', user: { ...user, role: 'ADMIN' } });
    render(await BackofficeLayout({ children: <p>Teams content</p> }));
    expect(screen.getByRole('link', { name: 'Accounts' })).toBeInTheDocument();
  });

  it('uses a separate staff layout with no administrative links', async () => {
    sessionMock.mockResolvedValue({ kind: 'authenticated', user });
    render(await CrewLayout({ children: <p>My team content</p> }));
    expect(screen.getByText('Team member')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Accounts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Teams' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
  });

  it('does not render protected content when session verification fails', async () => {
    sessionMock.mockResolvedValue({ kind: 'unavailable' });
    render(await BackofficeLayout({ children: <p>Protected content</p> }));
    expect(screen.getByText('We could not check your session.')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
  it('redirects anonymous staff visitors before rendering their workspace', async () => {
    sessionMock.mockResolvedValue({ kind: 'anonymous' });
    await expect(CrewLayout({ children: <p>Protected crew content</p> })).rejects.toThrow(
      'redirect:/login',
    );
  });

  it.each(['ADMIN', 'DISPATCHER'] as const)('keeps %s outside the crew workspace', async (role) => {
    sessionMock.mockResolvedValue({ kind: 'authenticated', user: { ...user, role } });
    await expect(CrewLayout({ children: <p>Protected crew content</p> })).rejects.toThrow(
      'redirect:/backoffice',
    );
  });

  it('marks the current staff section while retaining work and team destinations', async () => {
    sessionMock.mockResolvedValue({ kind: 'authenticated', user });
    navigation.pathname = '/crew/assignments/fixture';
    const view = render(await CrewLayout({ children: <p>Staff visit</p> }));
    const nav = screen.getByRole('navigation', { name: 'Team navigation' });
    expect(within(nav).getByRole('link', { name: 'My work' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'My team' })).toHaveAttribute(
      'href',
      '/crew/team',
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    navigation.pathname = '/crew/team';
    view.rerender(await CrewLayout({ children: <p>Staff team</p> }));
    expect(within(nav).getByRole('link', { name: 'My team' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'My work' })).not.toHaveAttribute('aria-current');
  });
});
