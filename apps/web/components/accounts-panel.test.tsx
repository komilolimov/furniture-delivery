import type { AuthUser } from '@furniture-delivery/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../lib/api-client';
import { AccountsPanel } from './accounts-panel';
import { useCurrentUser } from './session-provider';

vi.mock('./session-provider', () => ({ useCurrentUser: vi.fn() }));
vi.mock('../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const apiMock = vi.mocked(apiRequest);
const currentUserMock = vi.mocked(useCurrentUser);
const admin: AuthUser = {
  id: 'admin-1',
  username: 'admin',
  displayName: 'Admin',
  role: 'ADMIN',
  active: true,
  crewIds: [],
};

beforeEach(() => {
  apiMock.mockReset();
  currentUserMock.mockReset();
});

describe('administrator account management', () => {
  it('does not request or expose account management for a dispatcher', () => {
    currentUserMock.mockReturnValue({ ...admin, role: 'DISPATCHER' });
    render(<AccountsPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.queryByText('Create an account')).not.toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('creates an inactive personal account without rejecting a successful inactive response', async () => {
    currentUserMock.mockReturnValue(admin);
    apiMock
      .mockResolvedValueOnce({ users: [] })
      .mockResolvedValueOnce({
        user: { ...admin, id: 'new-1', username: 'new.worker', active: false },
      })
      .mockResolvedValue({ users: [] });
    render(<AccountsPanel />);
    await screen.findByText('No accounts to display');
    fireEvent.click(screen.getByText('Create an account'));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'new.worker' } });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'New worker' } });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'test-only-password' },
    });
    fireEvent.click(screen.getByLabelText('Account enabled'));
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }).closest('form')!);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        '/users',
        expect.objectContaining({
          method: 'POST',
          body: {
            username: 'new.worker',
            displayName: 'New worker',
            password: 'test-only-password',
            role: 'CREW_MEMBER',
            active: false,
          },
        }),
      ),
    );
    expect(await screen.findByText('Account created.')).toBeInTheDocument();
  });
});
