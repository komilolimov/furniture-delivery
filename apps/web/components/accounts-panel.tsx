'use client';

import type { AuthResponse, AuthUser, UsersResponse } from '@furniture-delivery/contracts';
import { useState, type FormEvent } from 'react';
import { apiRequest, describeError } from '../lib/api-client';
import { isAccountResponse, isUsersResponse } from '../lib/contracts-guards';
import { useApiResource } from '../lib/use-api-resource';
import { Feedback, ResourceNotice } from './form-parts';
import { useCurrentUser } from './session-provider';

function UserForm({ user, onSaved }: Readonly<{ user?: AuthUser; onSaved: () => void }>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get('password') ?? '');
    const body = {
      displayName: String(data.get('displayName') ?? '').trim(),
      role: String(data.get('role') ?? 'CREW_MEMBER'),
      active: data.get('active') === 'on',
      ...(!user
        ? { username: String(data.get('username') ?? '').trim(), password }
        : password
          ? { password }
          : {}),
    };
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await apiRequest<AuthResponse>(`/users${user ? `/${user.id}` : ''}`, {
        method: user ? 'PATCH' : 'POST',
        body,
        validate: isAccountResponse,
      });
      if (!user) form.reset();
      else {
        const input = form.elements.namedItem('password');
        if (input instanceof HTMLInputElement) input.value = '';
      }
      setSuccess(user ? 'Account updated.' : 'Account created.');
      onSaved();
    } catch (error) {
      setError(describeError(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={pending}>
        {!user && (
          <label>
            Username
            <input
              name="username"
              autoComplete="off"
              required
              minLength={3}
              maxLength={64}
              pattern="[a-z][a-z0-9._-]{2,63}"
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
        )}
        <label>
          Display name
          <input name="displayName" required maxLength={120} defaultValue={user?.displayName} />
        </label>
        <label>
          Role
          <select name="role" defaultValue={user?.role ?? 'CREW_MEMBER'}>
            <option value="CREW_MEMBER">Team member</option>
            <option value="DISPATCHER">Dispatcher</option>
            <option value="ADMIN">Administrator</option>
          </select>
        </label>
        <label>
          {user ? 'New password (optional)' : 'Password'}
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required={!user}
            minLength={12}
            maxLength={128}
          />
          <small>
            {user ? 'Leave empty to keep the current password.' : 'Use at least 12 characters.'}
          </small>
        </label>
        <label className="checkbox-field">
          <input name="active" type="checkbox" defaultChecked={user?.active ?? true} />
          Account enabled
        </label>
      </fieldset>
      <Feedback error={error} success={success} />
      <button className="primary-button" disabled={pending}>
        {pending ? 'Saving…' : user ? 'Save account' : 'Create account'}
      </button>
    </form>
  );
}

function AccountManagement() {
  const resource = useApiResource<UsersResponse>('/users', isUsersResponse);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Accounts</h1>
          <p>Personal accounts, roles and access.</p>
        </div>
      </div>
      <details className="content-card create-panel">
        <summary>Create an account</summary>
        <UserForm onSaved={() => void resource.refresh()} />
      </details>
      <ResourceNotice
        pending={resource.pending}
        error={resource.error}
        retry={() => void resource.refresh()}
      />
      {!resource.pending &&
        resource.data &&
        (resource.data.users.length === 0 ? (
          <div className="empty-state">
            <h2>No accounts to display</h2>
          </div>
        ) : (
          <div className="account-list">
            {resource.data.users.map((user) => (
              <details className="content-card account-editor" key={user.id}>
                <summary>
                  <span>
                    <strong>{user.displayName}</strong>
                    <small>
                      {user.username} ·{' '}
                      {user.role === 'ADMIN'
                        ? 'Administrator'
                        : user.role === 'DISPATCHER'
                          ? 'Dispatcher'
                          : 'Team member'}
                    </small>
                  </span>
                  <span className={`service-badge ${user.active ? 'up' : 'unknown'}`}>
                    {user.active ? 'Enabled' : 'Disabled'}
                  </span>
                </summary>
                <UserForm user={user} onSaved={() => void resource.refresh()} />
              </details>
            ))}
          </div>
        ))}
    </>
  );
}

export function AccountsPanel() {
  const user = useCurrentUser();
  if (user.role !== 'ADMIN')
    return (
      <div className="empty-state" role="alert">
        <h1>Access denied</h1>
        <p>Account management is available to administrators.</p>
      </div>
    );
  return <AccountManagement />;
}
