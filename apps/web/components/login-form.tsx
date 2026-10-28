'use client';

import type { AuthResponse } from '@furniture-delivery/contracts';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from './ui/button';
import { apiRequest, describeError } from '../lib/api-client';
import { homeForRole, isAuthResponse } from '../lib/session';

const inputClasses =
  'tw:min-h-11 tw:w-full tw:min-w-0 tw:rounded-[7px] tw:border tw:border-solid tw:border-[#cbd4c7] tw:bg-white tw:p-3 tw:[font-family:inherit] tw:text-[14px] tw:leading-[18px] tw:font-normal tw:text-[#18372e] tw:focus-visible:outline-3 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-[#91b88e] tw:disabled:cursor-wait tw:disabled:bg-[#f1f3ee]';
const labelClasses = 'tw:grid tw:min-w-0 tw:gap-2 tw:text-[12px] tw:font-bold tw:text-[#18372e]';

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const passwordId = useId();
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPasswordVisible(false);
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
    <form className="tw:mt-7 tw:grid tw:gap-[18px]" onSubmit={(event) => void submit(event)}>
      <label className={labelClasses}>
        Username
        <input
          className={inputClasses}
          name="username"
          autoComplete="username"
          required
          maxLength={64}
          autoCapitalize="none"
          spellCheck={false}
          disabled={pending}
        />
      </label>
      <div className={labelClasses}>
        <label htmlFor={passwordId}>Password</label>
        <div className="tw:relative tw:min-w-0">
          <input
            id={passwordId}
            className={`${inputClasses} tw:pr-14`}
            name="password"
            type={passwordVisible ? 'text' : 'password'}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            maxLength={128}
            disabled={pending}
          />
          <Button
            variant="ghost"
            size="icon"
            type="button"
            className="tw:absolute tw:inset-y-0 tw:right-0 tw:my-auto tw:rounded-[7px]"
            aria-label={passwordVisible ? 'Hide password' : 'Show password'}
            aria-controls={passwordId}
            aria-pressed={passwordVisible}
            disabled={pending}
            onClick={() => setPasswordVisible((visible) => !visible)}
          >
            {passwordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </Button>
        </div>
      </div>
      {error && (
        <p
          className="tw:m-0 tw:rounded-[7px] tw:bg-[#fff0ed] tw:p-3 tw:text-[12px] tw:leading-[1.6] tw:font-normal tw:wrap-anywhere tw:text-[#97372a]"
          role="alert"
        >
          {error}
        </p>
      )}
      <button
        className="tw:inline-flex tw:min-h-11 tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-[7px] tw:border tw:border-solid tw:border-[#18372e] tw:bg-[#18372e] tw:px-[17px] tw:py-[11px] tw:text-[12px] tw:font-bold tw:text-white tw:no-underline tw:enabled:hover:bg-[#2b5142] tw:focus-visible:outline-3 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-[#91b88e] tw:disabled:cursor-wait tw:disabled:opacity-60"
        type="submit"
        disabled={pending}
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
