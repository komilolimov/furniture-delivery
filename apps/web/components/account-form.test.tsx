import type { AuthResponse, AuthUser } from '@furniture-delivery/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { AccountForm } from './account-form';

vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const api = vi.mocked(apiRequest);
const fixture: AuthUser = {
  id: 'fixture-employee',
  username: 'fixture.worker',
  displayName: 'Fixture Worker',
  role: 'CREW_MEMBER',
  active: true,
  crewIds: ['fixture-crew'],
};
// Synthetic values only; no real account credentials are read or changed by these tests.
const fixturePassword = 'test-only-long-password';
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const password = () => screen.getByLabelText('New password (optional)');
beforeEach(() => {
  api.mockReset();
});

describe('account form payloads and draft boundaries', () => {
  it('creates an inactive personal account with the existing defaults and constraints', async () => {
    const onSaved = vi.fn();
    const created = { ...fixture, active: false, crewIds: [] };
    api.mockResolvedValue({ user: created });
    render(<AccountForm onSaved={onSaved} />);
    const username = screen.getByLabelText('Username');
    expect(username).toHaveAttribute('minlength', '3');
    expect(username).toHaveAttribute('maxlength', '64');
    expect(username).toHaveAttribute('pattern', '[a-z][a-z0-9._-]{2,63}');
    expect(username).toHaveAttribute('autocomplete', 'off');
    const secret = screen.getByLabelText('Password');
    expect(secret).toHaveAttribute('type', 'password');
    expect(secret).toBeRequired();
    expect(secret).toHaveAttribute('minlength', '12');
    expect(secret).toHaveAttribute('maxlength', '128');
    expect(secret).toHaveAttribute('autocomplete', 'new-password');
    fireEvent.change(username, { target: { value: fixture.username } });
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: '  Fixture Worker  ' },
    });
    fireEvent.change(secret, { target: { value: fixturePassword } });
    fireEvent.click(screen.getByLabelText('Account enabled'));
    fireEvent.submit(screen.getByRole('form', { name: 'Create account' }));
    await screen.findByText('Account created.');
    expect(api).toHaveBeenCalledWith(
      '/users',
      expect.objectContaining({
        method: 'POST',
        body: {
          username: fixture.username,
          displayName: 'Fixture Worker',
          role: 'CREW_MEMBER',
          active: false,
          password: fixturePassword,
        },
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(created);
    expect(secret).toHaveValue('');
    expect(username).toHaveValue('');
  });

  it('edits the public fields while leaving an empty optional password and immutable username out of PATCH', async () => {
    const onSaved = vi.fn();
    api.mockResolvedValue({
      user: {
        ...fixture,
        displayName: 'Updated Worker',
        role: 'DISPATCHER',
        active: false,
        crewIds: [],
      },
    });
    render(<AccountForm user={fixture} onSaved={onSaved} />);
    const username = screen.getByLabelText('Username');
    expect(username).toHaveValue(fixture.username);
    expect(username).toHaveAttribute('readonly');
    expect(username).not.toHaveAttribute('name');
    expect(password()).not.toBeRequired();
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: '  Updated Worker  ' },
    });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'DISPATCHER' } });
    fireEvent.click(screen.getByLabelText('Account enabled'));
    fireEvent.submit(screen.getByRole('form', { name: 'Edit account' }));
    await screen.findByText('Account updated.');
    expect(api).toHaveBeenCalledWith(
      `/users/${fixture.id}`,
      expect.objectContaining({
        method: 'PATCH',
        body: { displayName: 'Updated Worker', role: 'DISPATCHER', active: false },
      }),
    );
    expect(screen.getByLabelText('Display name')).toHaveValue('  Updated Worker  ');
    expect(password()).toHaveValue('');
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('sends a new password only when entered and clears it after success without resetting the other inputs', async () => {
    api.mockResolvedValue({ user: fixture });
    render(<AccountForm user={fixture} onSaved={vi.fn()} currentUserId={fixture.id} />);
    expect(screen.getByText('Your account')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('your own account');
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Edited draft name' },
    });
    fireEvent.change(password(), { target: { value: fixturePassword } });
    fireEvent.submit(screen.getByRole('form', { name: 'Edit account' }));
    await screen.findByText('Account updated.');
    expect(api).toHaveBeenCalledWith(
      `/users/${fixture.id}`,
      expect.objectContaining({
        method: 'PATCH',
        body: {
          displayName: 'Edited draft name',
          role: 'CREW_MEMBER',
          active: true,
          password: fixturePassword,
        },
      }),
    );
    expect(password()).toHaveValue('');
    expect(screen.getByLabelText('Display name')).toHaveValue('Edited draft name');
  });

  it.each([409, 403])(
    'keeps rejected edits and password when the server returns %i',
    async (status) => {
      const onSaved = vi.fn();
      api.mockRejectedValue(new ApiError(status, 'Synthetic account rejection.'));
      render(<AccountForm user={fixture} onSaved={onSaved} />);
      fireEvent.change(screen.getByLabelText('Display name'), {
        target: { value: 'Unsent public name' },
      });
      fireEvent.change(password(), { target: { value: fixturePassword } });
      fireEvent.submit(screen.getByRole('form', { name: 'Edit account' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic account rejection.');
      expect(screen.getByLabelText('Display name')).toHaveValue('Unsent public name');
      expect(password()).toHaveValue(fixturePassword);
      expect(screen.getByRole('button', { name: 'Save account' })).toBeEnabled();
      expect(onSaved).not.toHaveBeenCalled();
    },
  );

  it('blocks duplicate submits and reports its pending state until the request completes', async () => {
    const request = deferred<AuthResponse>();
    const onPendingChange = vi.fn();
    api.mockReturnValue(request.promise);
    render(<AccountForm user={fixture} onSaved={vi.fn()} onPendingChange={onPendingChange} />);
    const form = screen.getByRole('form', { name: 'Edit account' });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(api).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(onPendingChange.mock.calls).toEqual([[true]]);
    await act(async () => request.resolve({ user: fixture }));
    await screen.findByText('Account updated.');
    expect(onPendingChange.mock.calls).toEqual([[true], [false]]);
  });

  it('retains the original keyed account and dirty role/access/password through refreshed list props', async () => {
    api.mockResolvedValue({ user: fixture });
    const onSaved = vi.fn();
    const view = render(<AccountForm user={fixture} onSaved={onSaved} />);
    const name = screen.getByLabelText('Display name');
    const secret = password();
    fireEvent.change(name, { target: { value: 'Unsent account name' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'DISPATCHER' } });
    fireEvent.click(screen.getByLabelText('Account enabled'));
    fireEvent.change(secret, { target: { value: fixturePassword } });
    view.rerender(
      <AccountForm
        user={{ ...fixture, displayName: 'Remote account name', role: 'ADMIN' }}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByLabelText('Display name')).toBe(name);
    expect(name).toHaveValue('Unsent account name');
    expect(password()).toBe(secret);
    expect(secret).toHaveValue(fixturePassword);
    expect(screen.getByLabelText('Role')).toHaveValue('DISPATCHER');
    expect(screen.getByLabelText('Account enabled')).not.toBeChecked();
    fireEvent.submit(screen.getByRole('form', { name: 'Edit account' }));
    await screen.findByText('Account updated.');
    expect(api).toHaveBeenCalledWith(
      `/users/${fixture.id}`,
      expect.objectContaining({
        body: {
          displayName: 'Unsent account name',
          role: 'DISPATCHER',
          active: false,
          password: fixturePassword,
        },
      }),
    );
  });

  it('does not deliver a late mutation response to an editor that was unmounted', async () => {
    const request = deferred<AuthResponse>();
    const onSaved = vi.fn();
    const onPendingChange = vi.fn();
    api.mockReturnValue(request.promise);
    const view = render(
      <AccountForm user={fixture} onSaved={onSaved} onPendingChange={onPendingChange} />,
    );
    fireEvent.submit(screen.getByRole('form', { name: 'Edit account' }));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => request.resolve({ user: fixture }));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onPendingChange.mock.calls).toEqual([[true]]);
  });
});
