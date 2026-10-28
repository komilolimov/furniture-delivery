'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiRequest, ApiError, describeError } from '../lib/api-client';

export function LogoutButton({ className }: Readonly<{ className?: string }> = {}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setPending(true);
    setError(null);
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
      window.dispatchEvent(new Event('fd:session-expired'));
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
    <div className={className === undefined ? 'logout-control' : 'tw:max-w-[240px]'}>
      <button
        className={className ?? 'secondary-button'}
        onClick={() => void logout()}
        disabled={pending}
      >
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
      {error && (
        <p
          className={
            className === undefined
              ? 'form-error'
              : 'tw:mt-[10px] tw:mb-0 tw:rounded-[7px] tw:bg-[#fff0ed] tw:p-3 tw:text-xs tw:leading-[1.6] tw:text-[#97372a] tw:[overflow-wrap:anywhere]'
          }
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
