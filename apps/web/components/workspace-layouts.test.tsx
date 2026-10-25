import type { AuthUser } from '@furniture-delivery/contracts';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BackofficeLayout from '../app/backoffice/layout';
import CrewLayout from '../app/crew/layout';
import { loadSession } from '../lib/server-session';

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => navigation, redirect: navigation.redirect }));
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
  });

  it('does not render protected content when session verification fails', async () => {
    sessionMock.mockResolvedValue({ kind: 'unavailable' });
    render(await BackofficeLayout({ children: <p>Protected content</p> }));
    expect(screen.getByText('We could not check your session.')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
