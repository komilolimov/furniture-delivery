'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiRequest, ApiError, describeError } from '../lib/api-client';

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setPending(true);
    setError(null);
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
      router.replace('/login');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace('/login');
        router.refresh();
      } else {
        setError(describeError(error));
        setPending(false);
      }
    }
  }

  return (
    <div className="logout-control">
      <button className="secondary-button" onClick={() => void logout()} disabled={pending}>
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
