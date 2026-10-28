'use client';

import type { AuthResponse, AuthUser } from '@furniture-delivery/contracts';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { KeyRound, Save, ShieldCheck, UserPlus, UserRound } from 'lucide-react';
import { apiRequest, describeError } from '../lib/api-client';
import { isAccountResponse } from '../lib/contracts-guards';
import { DraftChangeNotice } from './draft-change-notice';
import { Feedback } from './form-parts';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { NativeSelect } from './ui/native-select';

const field = 'tw:grid tw:min-w-0 tw:gap-2 tw:text-xs tw:font-semibold tw:text-[#52654f]';
const hint = 'tw:m-0 tw:text-[11px] tw:leading-relaxed tw:font-normal tw:text-[#73816b]';
const paths = ['/users'];

export function AccountForm({
  user,
  onSaved,
  onPendingChange,
  onCancel,
  currentUserId,
}: Readonly<{
  user?: AuthUser;
  onSaved: (account: AuthUser) => void;
  onPendingChange?: (pending: boolean) => void;
  onCancel?: () => void;
  currentUserId?: string;
}>) {
  // A refreshed list must not rebase a profile, role or password draft already being edited.
  // The owning drawer keys this form by account ID (or creation), so another account starts fresh.
  const [base] = useState(user);
  const id = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get('password') ?? '');
    const body = {
      displayName: String(data.get('displayName') ?? '').trim(),
      role: String(data.get('role') ?? 'CREW_MEMBER'),
      active: data.get('active') === 'on',
      ...(!base
        ? { username: String(data.get('username') ?? '').trim(), password }
        : password
          ? { password }
          : {}),
    };
    busy.current = true;
    setPending(true);
    onPendingChange?.(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiRequest<AuthResponse>(`/users${base ? `/${base.id}` : ''}`, {
        method: base ? 'PATCH' : 'POST',
        body,
        validate: isAccountResponse,
      });
      if (!mounted.current) return;
      if (!base) form.reset();
      else {
        const input = form.elements.namedItem('password');
        if (input instanceof HTMLInputElement) input.value = '';
      }
      setSuccess(base ? 'Account updated.' : 'Account created.');
      onSaved(response.user);
    } catch (error) {
      if (mounted.current) setError(describeError(error));
    } finally {
      busy.current = false;
      if (mounted.current) {
        setPending(false);
        onPendingChange?.(false);
      }
    }
  }

  return (
    <form
      aria-label={base ? 'Edit account' : 'Create account'}
      className="account-form tw:grid tw:min-w-0 tw:gap-6"
      onSubmit={(event) => void submit(event)}
    >
      <DraftChangeNotice paths={paths} />
      <fieldset
        disabled={pending}
        className="tw:m-0 tw:grid tw:min-w-0 tw:gap-6 tw:border-0 tw:p-0"
      >
        <section className="tw:grid tw:min-w-0 tw:gap-4" aria-labelledby={`${id}-identity`}>
          <div className="tw:flex tw:items-center tw:gap-2">
            <UserRound size={16} aria-hidden="true" className="tw:text-[#69835e]" />
            <h3 id={`${id}-identity`} className="tw:m-0 tw:text-sm tw:font-semibold">
              Personal details
            </h3>
            {base && base.id === currentUserId && <Badge variant="secondary">Your account</Badge>}
          </div>
          <label className={field} htmlFor={`${id}-username`}>
            Username
            {base ? (
              <Input
                id={`${id}-username`}
                value={base.username}
                readOnly
                autoComplete="off"
                className="tw:bg-[#f4f7ef] tw:text-[#73816b]"
                aria-describedby={`${id}-username-note`}
              />
            ) : (
              <Input
                id={`${id}-username`}
                name="username"
                autoComplete="off"
                required
                minLength={3}
                maxLength={64}
                pattern="[a-z][a-z0-9._-]{2,63}"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="e.g. new.employee"
                aria-describedby={`${id}-username-note`}
              />
            )}
          </label>
          <p id={`${id}-username-note`} className={`${hint} tw:-mt-2`}>
            {base
              ? 'This sign-in name stays with the account and cannot be changed here.'
              : 'Start with a lowercase letter. Use 3–64 lowercase letters, numbers, dots, underscores or hyphens.'}
          </p>
          <label className={field} htmlFor={`${id}-name`}>
            Display name
            <Input
              id={`${id}-name`}
              name="displayName"
              required
              maxLength={120}
              defaultValue={base?.displayName}
              placeholder="Name shown to colleagues"
            />
          </label>
        </section>
        <section
          className="tw:grid tw:min-w-0 tw:gap-4 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e3e9dc] tw:pt-5"
          aria-labelledby={`${id}-access`}
        >
          <div className="tw:flex tw:items-center tw:gap-2">
            <ShieldCheck size={16} aria-hidden="true" className="tw:text-[#69835e]" />
            <h3 id={`${id}-access`} className="tw:m-0 tw:text-sm tw:font-semibold">
              Role and access
            </h3>
          </div>
          <label className={field} htmlFor={`${id}-role`}>
            Role
            <NativeSelect
              id={`${id}-role`}
              name="role"
              defaultValue={base?.role ?? 'CREW_MEMBER'}
              aria-describedby={`${id}-role-note`}
            >
              <option value="CREW_MEMBER">Team member</option>
              <option value="DISPATCHER">Dispatcher</option>
              <option value="ADMIN">Administrator</option>
            </NativeSelect>
          </label>
          <p id={`${id}-role-note`} className={`${hint} tw:-mt-2`}>
            Administrators manage accounts. Dispatchers plan and manage orders. Team members access
            assigned work; their team membership is managed in Teams.
          </p>
          <label className="tw:flex tw:min-h-11 tw:cursor-pointer tw:items-start tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#dfe6d8] tw:bg-[#f7f9f3] tw:p-4 tw:text-xs tw:font-medium">
            <input
              aria-label="Account enabled"
              aria-describedby={`${id}-enabled-note`}
              name="active"
              type="checkbox"
              defaultChecked={base?.active ?? true}
              className="tw:mt-0.5 tw:size-4 tw:shrink-0 tw:accent-[#28543b]"
            />
            <span>
              Account enabled
              <span
                id={`${id}-enabled-note`}
                className="tw:mt-1 tw:block tw:text-[11px] tw:leading-relaxed tw:font-normal tw:text-[#73816b]"
              >
                Enabled accounts can sign in. Existing history is retained when access is disabled.
              </span>
            </span>
          </label>
          {base && (
            <p
              className="tw:m-0 tw:rounded-xl tw:border tw:border-solid tw:border-[#e8dfc7] tw:bg-[#fcf6e8] tw:p-4 tw:text-xs tw:leading-relaxed tw:text-[#856328]"
              role="note"
            >
              Changes to role, enabled status or password revoke existing sessions.{' '}
              {base.id === currentUserId
                ? 'Changing these settings on your own account will require signing in again.'
                : 'The account holder will need to sign in again with their current access.'}
            </p>
          )}
        </section>
        <section
          className="tw:grid tw:min-w-0 tw:gap-4 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e3e9dc] tw:pt-5"
          aria-labelledby={`${id}-credentials`}
        >
          <div className="tw:flex tw:items-center tw:gap-2">
            <KeyRound size={16} aria-hidden="true" className="tw:text-[#69835e]" />
            <h3 id={`${id}-credentials`} className="tw:m-0 tw:text-sm tw:font-semibold">
              {base ? 'Change password' : 'Sign-in password'}
            </h3>
          </div>
          <label className={field} htmlFor={`${id}-password`}>
            {base ? 'New password (optional)' : 'Password'}
            <Input
              id={`${id}-password`}
              name="password"
              type="password"
              autoComplete="new-password"
              required={!base}
              minLength={12}
              maxLength={128}
              aria-describedby={`${id}-password-note`}
            />
          </label>
          <p id={`${id}-password-note`} className={`${hint} tw:-mt-2`}>
            {base ? 'Leave empty to keep the current password.' : 'Use at least 12 characters.'}
          </p>
        </section>
      </fieldset>
      <Feedback error={error} success={success} />
      <div className="tw:flex tw:justify-end tw:gap-2 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e3e9dc] tw:pt-4">
        {onCancel && (
          <Button variant="outline" type="button" disabled={pending} onClick={onCancel}>
            {base ? 'Close' : 'Cancel'}
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {base ? <Save aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
          {pending ? 'Saving…' : base ? 'Save account' : 'Create account'}
        </Button>
      </div>
    </form>
  );
}
