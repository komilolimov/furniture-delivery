import type { AuthResponse, AuthUser, UsersResponse } from '@furniture-delivery/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { AccountsPanel } from './accounts-panel';
import { useCurrentUser } from './session-provider';
import { chooseSelectOption } from '../test/select-option';

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
const dispatcher: AuthUser = {
  ...admin,
  id: 'dispatcher-1',
  username: 'fixture.dispatcher',
  displayName: 'Fixture dispatcher',
  role: 'DISPATCHER',
};
const assigned: AuthUser = {
  ...admin,
  id: 'assigned-worker',
  username: 'fixture.worker.assigned',
  displayName: 'Assigned worker',
  role: 'CREW_MEMBER',
  crewIds: ['crew-one'],
};
const unassigned: AuthUser = {
  ...assigned,
  id: 'free-worker',
  username: 'fixture.worker.free',
  displayName: 'Unassigned worker',
  crewIds: [],
};
const disabledAssigned: AuthUser = {
  ...assigned,
  id: 'disabled-assigned-worker',
  username: 'fixture.worker.disabled.assigned',
  displayName: 'Disabled assigned worker',
  active: false,
};
const disabledUnassigned: AuthUser = {
  ...unassigned,
  id: 'disabled-free-worker',
  username: 'fixture.worker.disabled.free',
  displayName: 'Disabled unassigned worker',
  active: false,
};
const directory = [admin, dispatcher, assigned, unassigned, disabledAssigned, disabledUnassigned];
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const metric = (label: string) =>
  within(screen.getByLabelText('Account directory summary')).getByText(label).nextElementSibling;

beforeEach(() => {
  apiMock.mockReset();
  currentUserMock.mockReset();
  currentUserMock.mockReturnValue(admin);
});

describe('administrator account management', () => {
  it('does not request or expose account management for a dispatcher', () => {
    currentUserMock.mockReturnValue({ ...admin, role: 'DISPATCHER' });
    render(<AccountsPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.queryByText('Create an account')).not.toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('does not request or expose account data or forms for a team member', () => {
    currentUserMock.mockReturnValue({ ...admin, role: 'CREW_MEMBER' });
    render(<AccountsPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.queryByRole('table', { name: 'Accounts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create an account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Username' })).not.toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('creates an inactive personal account without rejecting a successful inactive response', async () => {
    currentUserMock.mockReturnValue(admin);
    apiMock
      .mockResolvedValueOnce({ users: [] })
      .mockResolvedValueOnce({
        user: { ...admin, id: 'new-1', username: 'new.worker', role: 'CREW_MEMBER', active: false },
      })
      .mockResolvedValue({ users: [] });
    render(<AccountsPanel />);
    await screen.findByText('No accounts to display');
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
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

  it('filters the complete directory locally without extra reads and keeps directory totals truthful', async () => {
    apiMock.mockResolvedValue({ users: directory });
    render(<AccountsPanel />);
    const table = await screen.findByRole('table', { name: 'Accounts' });
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(metric('Total accounts')).toHaveTextContent('6');
    expect(metric('Enabled accounts')).toHaveTextContent('4');
    expect(metric('Administrators')).toHaveTextContent('1');
    // Disabled unassigned employees are not falsely presented as ready-to-assign candidates.
    expect(metric('Unassigned team members')).toHaveTextContent('2');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search accounts' }), {
      target: { value: 'worker' },
    });
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    fireEvent.submit(screen.getByRole('search', { name: 'Search accounts' }));
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Filter accounts' }));
    await chooseSelectOption('Account role', 'Team member');
    await chooseSelectOption('Account status', 'Disabled');
    await chooseSelectOption('Team membership', 'Team members with a team');
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    const row = within(table).getByText(disabledAssigned.username).closest('tr')!;
    expect(row).toHaveTextContent('Disabled');
    expect(within(row).getByRole('link', { name: '1 active membership' })).toHaveAttribute(
      'href',
      '/backoffice/crews/crew-one',
    );
    expect(within(table).queryByText(disabledUnassigned.username)).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 1 of 6 accounts/)).toBeInTheDocument();
    expect(metric('Total accounts')).toHaveTextContent('6');
    expect(metric('Enabled accounts')).toHaveTextContent('4');
    expect(metric('Unassigned team members')).toHaveTextContent('2');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(screen.getByRole('textbox', { name: 'Search accounts' })).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Filter accounts' }));
    await chooseSelectOption('Team membership', 'Team members without a team');
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText(unassigned.username)).toBeInTheDocument();
    expect(within(table).getByText(disabledUnassigned.username)).toBeInTheDocument();
    expect(within(table).queryByText(admin.username)).not.toBeInTheDocument();
    expect(within(table).queryByText(dispatcher.username)).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(
      apiMock.mock.calls.every(([path, options]) => path === '/users' && !options?.method),
    ).toBe(true);
  });

  it('keeps the chosen account and password draft mounted through a background directory refresh, then resets for another account', async () => {
    const refreshed = deferred<UsersResponse>();
    let gets = 0;
    apiMock.mockImplementation(
      () => (++gets === 1 ? Promise.resolve({ users: directory }) : refreshed.promise) as never,
    );
    render(<AccountsPanel />);
    await screen.findByRole('table', { name: 'Accounts' });
    // Keep the refresh control reference to exercise the same resource update while its modal is open.
    const refresh = screen.getByRole('button', { name: 'Refresh accounts' });
    fireEvent.click(screen.getByRole('button', { name: `Edit account ${assigned.username}` }));
    const form = screen.getByRole('form', { name: 'Edit account' });
    const name = within(form).getByLabelText('Display name');
    const password = within(form).getByLabelText('New password (optional)');
    fireEvent.change(name, { target: { value: 'Unsent worker draft' } });
    fireEvent.change(password, { target: { value: 'synthetic-draft-password' } });
    expect(within(form).getByLabelText('Username')).toHaveAttribute('readonly');
    fireEvent.click(refresh);
    await waitFor(() => expect(gets).toBe(2));
    expect(screen.getByRole('form', { name: 'Edit account' })).toBe(form);
    expect(name).toHaveValue('Unsent worker draft');
    expect(password).toHaveValue('synthetic-draft-password');
    await act(async () =>
      refreshed.resolve({
        users: directory.map((user) =>
          user.id === assigned.id
            ? {
                ...user,
                displayName: 'Remote saved name',
                role: 'DISPATCHER' as const,
                crewIds: [],
              }
            : user,
        ),
      }),
    );
    expect(screen.getByRole('form', { name: 'Edit account' })).toBe(form);
    expect(name).toHaveValue('Unsent worker draft');
    expect(password).toHaveValue('synthetic-draft-password');
    expect(within(form).getByLabelText('Role')).toHaveValue('CREW_MEMBER');
    expect(within(form).getByLabelText('Username')).toHaveValue(assigned.username);
    fireEvent.click(screen.getByRole('button', { name: 'Close edit account' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit account' })).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: `Edit account ${unassigned.username}` }));
    const next = screen.getByRole('form', { name: 'Edit account' });
    expect(next).not.toBe(form);
    expect(within(next).getByLabelText('Username')).toHaveValue(unassigned.username);
    expect(within(next).getByLabelText('Display name')).toHaveValue(unassigned.displayName);
    expect(within(next).getByLabelText('New password (optional)')).toHaveValue('');
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });

  it('clears the opened editor, credential draft and private directory when a refresh loses access', async () => {
    let denied = false;
    apiMock.mockImplementation(() =>
      denied
        ? Promise.reject(new ApiError(403, 'Synthetic account access revoked.'))
        : (Promise.resolve({ users: directory }) as never),
    );
    render(<AccountsPanel />);
    await screen.findByRole('table', { name: 'Accounts' });
    const refresh = screen.getByRole('button', { name: 'Refresh accounts' });
    fireEvent.click(screen.getByRole('button', { name: `Edit account ${assigned.username}` }));
    const form = screen.getByRole('form', { name: 'Edit account' });
    fireEvent.change(within(form).getByLabelText('New password (optional)'), {
      target: { value: 'synthetic-private-draft' },
    });
    denied = true;
    fireEvent.click(refresh);
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.queryByRole('dialog', { name: 'Edit account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Edit account' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New password (optional)')).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Accounts' })).not.toBeInTheDocument();
    for (const person of directory)
      expect(screen.queryByText(person.username)).not.toBeInTheDocument();
    expect(metric('Total accounts')).toHaveTextContent('—');
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });

  it('keeps a pending account creation open until the response instead of losing the form on Escape or Close', async () => {
    const posted = deferred<AuthResponse>();
    const created: AuthUser = {
      ...unassigned,
      id: 'pending-worker',
      username: 'fixture.pending',
      displayName: 'Pending worker',
    };
    apiMock.mockImplementation(
      (_path, options) =>
        (options?.method === 'POST' ? posted.promise : Promise.resolve({ users: [] })) as never,
    );
    render(<AccountsPanel />);
    await screen.findByRole('heading', { name: 'No accounts to display' });
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    const dialog = screen.getByRole('dialog', { name: 'Create an account' });
    fireEvent.change(within(dialog).getByLabelText('Username'), {
      target: { value: created.username },
    });
    fireEvent.change(within(dialog).getByLabelText('Display name'), {
      target: { value: created.displayName },
    });
    fireEvent.change(within(dialog).getByLabelText('Password'), {
      target: { value: 'synthetic-create-password' },
    });
    fireEvent.submit(within(dialog).getByRole('form', { name: 'Create account' }));
    expect(within(dialog).getByRole('button', { name: 'Close create account' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close create account' }));
    expect(screen.getByRole('dialog', { name: 'Create an account' })).toBe(dialog);
    expect(within(dialog).getByLabelText('Username')).toHaveValue(created.username);
    await act(async () => posted.resolve({ user: created }));
    expect(await screen.findByText('Account created.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Create an account' })).not.toBeInTheDocument();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });
});
