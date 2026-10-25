'use client';

import type { AuthResponse } from '@furniture-delivery/contracts';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiRequest, describeError } from '../lib/api-client';
import { homeForRole, isAuthResponse } from '../lib/session';

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(null);
    try {
      const response = await apiRequest<AuthResponse>('/auth/login', {
        method: 'POST',
        body: {
          username: String(data.get('username') ?? '').trim(),
          password: String(data.get('password') ?? ''),
        },
      });
      if (!isAuthResponse(response)) throw new Error('Invalid session response.');
      form.reset();
      router.replace(homeForRole(response.user.role));
      router.refresh();
    } catch (error) {
      setError(describeError(error));
      setPending(false);
    }
  }

  return (
    <form className="stacked-form" onSubmit={(event) => void submit(event)}>
      <label>
        Username
        <input
          name="username"
          autoComplete="username"
          required
          maxLength={64}
          autoCapitalize="none"
          spellCheck={false}
          disabled={pending}
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          disabled={pending}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
