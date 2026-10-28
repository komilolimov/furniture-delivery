'use client';

import type { AuthUser, UserRole, UsersResponse } from '@furniture-delivery/contracts';
import Link from 'next/link';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CheckCheck,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { isUsersResponse } from '../lib/contracts-guards';
import { useApiResource } from '../lib/use-api-resource';
import { ResourceNotice } from './form-parts';
import { useCurrentUser } from './session-provider';
import { AccountForm } from './account-form';
import { AccountFilters, initialAccountFilters, type AccountFilterValue } from './account-filters';
import { Badge } from './ui/badge';
import { Button, buttonVariants } from './ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import './accounts.css';

const EMPTY_USERS: AuthUser[] = [];
const AccountEditorForm = memo(AccountForm);
const roleLabels: Record<UserRole, string> = {
  ADMIN: 'Administrator',
  DISPATCHER: 'Dispatcher',
  CREW_MEMBER: 'Team member',
};
const mobileLabel =
  'tw:mb-1.5 tw:hidden tw:text-[10px] tw:font-semibold tw:tracking-wide tw:text-[#7a8871] tw:uppercase tw:max-[900px]:block';
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}
type AccountSelection = { mode: 'create' } | { mode: 'edit'; id: string };

function AccountManagement({ currentUser }: Readonly<{ currentUser: AuthUser }>) {
  const resource = useApiResource<UsersResponse>('/users', isUsersResponse, {
    retainDataOnRefresh: true,
  });
  const [filters, setFilters] = useState<AccountFilterValue>(initialAccountFilters);
  const [selection, setSelection] = useState<AccountSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ created: boolean; account: AuthUser } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const users = resource.data?.users ?? EMPTY_USERS;
  const selected =
    selection?.mode === 'edit' ? (users.find((user) => user.id === selection.id) ?? null) : null;
  const open = Boolean(resource.data && selection && (selection.mode === 'create' || selected));
  useEffect(() => {
    if (
      selection &&
      ((!resource.data && !resource.pending) ||
        (resource.data && selection.mode === 'edit' && !selected))
    ) {
      setSelection(null);
      setBusy(false);
    }
  }, [resource.data, resource.pending, selection, selected]);
  const summary = useMemo(
    () => ({
      enabled: users.filter((user) => user.active).length,
      admins: users.filter((user) => user.role === 'ADMIN').length,
      unassigned: users.filter((user) => user.role === 'CREW_MEMBER' && user.crewIds.length === 0)
        .length,
    }),
    [users],
  );
  const filtered = useMemo(() => {
    const term = filters.search.toLocaleLowerCase('en-GB');
    return users.filter(
      (user) =>
        (filters.role === 'all' || user.role === filters.role) &&
        (filters.status === 'all' || user.active === (filters.status === 'enabled')) &&
        (filters.membership === 'all' ||
          (user.role === 'CREW_MEMBER' &&
            user.crewIds.length > 0 === (filters.membership === 'assigned'))) &&
        (!term ||
          [user.username, user.displayName].join(' ').toLocaleLowerCase('en-GB').includes(term)),
    );
  }, [users, filters]);
  const refresh = resource.refresh;
  const saved = useCallback(
    (account: AuthUser) => {
      const created = selection?.mode === 'create';
      setBusy(false);
      setNotice({ created, account });
      if (created) setSelection(null);
      void refresh();
    },
    [refresh, selection?.mode],
  );
  const closeEditor = useCallback(() => setSelection(null), []);
  const startCreate = () => {
    returnFocus.current = createButton.current;
    setNotice(null);
    setSelection({ mode: 'create' });
  };
  const startEdit = (user: AuthUser, trigger: HTMLElement) => {
    returnFocus.current = trigger;
    setNotice(null);
    setSelection({ mode: 'edit', id: user.id });
  };
  return (
    <div className="accounts-theme tw:grid tw:min-w-0 tw:gap-6 tw:text-[#18372e]">
      <header className="tw:flex tw:flex-wrap tw:items-end tw:justify-between tw:gap-4">
        <div>
          <p className="tw:mt-0 tw:mb-3 tw:text-[10px] tw:font-bold tw:tracking-[1.8px] tw:text-[#226347] tw:uppercase">
            Administration
          </p>
          <h1 className="tw:m-0 tw:text-[38px] tw:leading-tight tw:font-medium tw:tracking-[-1.2px] tw:max-[600px]:text-[32px]">
            Accounts
          </h1>
          <p className="tw:mt-3 tw:mb-0 tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
            Manage sign-in details, roles and account access in one place.
          </p>
        </div>
        <div className="tw:flex tw:flex-wrap tw:gap-2">
          <Button variant="outline" disabled={resource.pending} onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" />
            Refresh accounts
          </Button>
          <Button
            ref={createButton}
            disabled={!resource.data}
            aria-haspopup="dialog"
            onClick={startCreate}
          >
            <Plus aria-hidden="true" />
            Create an account
          </Button>
        </div>
      </header>
      <div
        className="tw:grid tw:grid-cols-4 tw:gap-3 tw:max-[650px]:grid-cols-2"
        aria-label="Account directory summary"
      >
        {[
          [Users, 'Total accounts', users.length],
          [CheckCheck, 'Enabled accounts', summary.enabled],
          [ShieldCheck, 'Administrators', summary.admins],
          [UserRound, 'Unassigned team members', summary.unassigned],
        ].map(([Icon, label, count]) => {
          const MetricIcon = Icon as typeof Users;
          return (
            <div
              key={String(label)}
              className="tw:flex tw:min-w-0 tw:items-start tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#e0e6d9] tw:bg-[#fffefa] tw:p-4"
            >
              <MetricIcon
                aria-hidden="true"
                className="tw:mt-0.5 tw:size-4 tw:shrink-0 tw:text-[#69835e]"
              />
              <div className="tw:min-w-0">
                <span className="tw:block tw:text-[10px] tw:leading-relaxed tw:text-[#73816b]">
                  {String(label)}
                </span>
                <strong className="tw:mt-1 tw:block tw:text-xl tw:font-medium tw:tabular-nums">
                  {resource.data ? String(count) : '—'}
                </strong>
              </div>
            </div>
          );
        })}
      </div>
      <AccountFilters value={filters} onApply={setFilters} />
      {notice && (
        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#d6e4cb] tw:bg-[#f1f7ea] tw:px-4 tw:py-3">
          <p role="status" className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-[#3b6240]">
            {notice.created ? 'Account created.' : 'Account updated.'}
          </p>
          {notice.created && notice.account.role === 'CREW_MEMBER' && notice.account.active && (
            <Link
              href="/backoffice/crews"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              Assign membership in Teams
              <ArrowUpRight aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
      <ResourceNotice
        pending={resource.pending && !resource.data}
        error={resource.error}
        retry={() => void refresh()}
      />
      {resource.data && (
        <section
          className="tw:min-w-0 tw:overflow-hidden tw:rounded-2xl tw:border tw:border-solid tw:border-[#e0e5da] tw:bg-[#fffefa]"
          aria-label="Account directory"
          aria-busy={resource.pending}
        >
          <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:px-5 tw:py-5">
            <div>
              <h2 className="tw:m-0 tw:text-lg tw:font-medium tw:tracking-[-0.4px]">
                User directory
              </h2>
              <p className="tw:mt-1.5 tw:mb-0 tw:text-xs tw:text-[#65716a]">
                Showing {filtered.length} of {users.length} accounts · Select Edit to manage an
                account.
              </p>
            </div>
            {resource.pending && (
              <span role="status" className="tw:text-xs tw:text-[#73816b]">
                Updating accounts…
              </span>
            )}
          </div>
          {filtered.length === 0 ? (
            <div className="tw:grid tw:justify-items-center tw:gap-3 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#edf0e8] tw:px-5 tw:py-14 tw:text-center">
              <span className="tw:grid tw:size-12 tw:place-items-center tw:rounded-xl tw:bg-[#edf3e7] tw:text-[#54764e]">
                <Users aria-hidden="true" size={22} />
              </span>
              <h2 className="tw:m-0 tw:text-xl tw:font-medium">
                {users.length ? 'No matching accounts' : 'No accounts to display'}
              </h2>
              <p className="tw:m-0 tw:max-w-[380px] tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
                {users.length
                  ? 'Try another search or clear the filters.'
                  : 'Create a personal account to give someone access to the workspace.'}
              </p>
              {users.length > 0 && (
                <Button variant="outline" onClick={() => setFilters(initialAccountFilters)}>
                  Show all accounts
                </Button>
              )}
            </div>
          ) : (
            <Table
              aria-label="Accounts"
              role="table"
              className="accounts-directory-table tw:table-fixed"
            >
              <TableHeader role="rowgroup">
                <TableRow className="tw:bg-[#f5f7f0]">
                  <TableHead className="tw:w-[30%]">User</TableHead>
                  <TableHead className="tw:w-[18%]">Role</TableHead>
                  <TableHead className="tw:w-[16%]">Account access</TableHead>
                  <TableHead className="tw:w-[22%]">Team membership</TableHead>
                  <TableHead className="tw:w-[14%]">
                    <span className="tw:sr-only">Edit account</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody role="rowgroup">
                {filtered.map((user) => (
                  <TableRow
                    key={user.id}
                    role="row"
                    className="tw:hover:bg-[#f8faf4] tw:max-[900px]:border tw:max-[900px]:border-solid tw:max-[900px]:border-[#e1e7da]"
                  >
                    <TableCell className="tw:py-5 tw:align-top tw:max-[900px]:p-0">
                      <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-3">
                        <span
                          aria-hidden="true"
                          className="tw:grid tw:size-10 tw:shrink-0 tw:place-items-center tw:rounded-xl tw:bg-[#edf3e7] tw:text-xs tw:font-semibold tw:text-[#5e7b55]"
                        >
                          {initials(user.displayName)}
                        </span>
                        <div className="tw:min-w-0">
                          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                            <strong className="tw:text-sm tw:leading-relaxed tw:font-semibold tw:wrap-anywhere">
                              {user.displayName}
                            </strong>
                            {user.id === currentUser.id && (
                              <Badge variant="outline" className="tw:py-0.5 tw:text-[9px]">
                                You
                              </Badge>
                            )}
                          </div>
                          <span className="tw:mt-1 tw:block tw:text-[11px] tw:leading-relaxed tw:text-[#73816b] tw:wrap-anywhere">
                            {user.username}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="tw:py-5 tw:align-top tw:max-[900px]:p-0">
                      <span className={mobileLabel}>Role</span>
                      <Badge variant={user.role === 'ADMIN' ? 'default' : 'secondary'}>
                        {user.role === 'ADMIN' && (
                          <ShieldCheck aria-hidden="true" className="tw:mr-1 tw:size-3" />
                        )}
                        {roleLabels[user.role]}
                      </Badge>
                    </TableCell>
                    <TableCell className="tw:py-5 tw:align-top tw:max-[900px]:p-0">
                      <span className={mobileLabel}>Account access</span>
                      <Badge variant={user.active ? 'success' : 'outline'}>
                        {user.active ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell className="tw:py-5 tw:align-top tw:max-[900px]:p-0">
                      <span className={mobileLabel}>Team membership</span>
                      {user.role === 'CREW_MEMBER' ? (
                        user.crewIds.length ? (
                          <Link
                            href={
                              user.crewIds.length === 1
                                ? `/backoffice/crews/${user.crewIds[0]}`
                                : '/backoffice/crews'
                            }
                            className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:font-medium tw:text-[#426b40] tw:underline-offset-4 tw:hover:underline"
                          >
                            {user.crewIds.length}{' '}
                            {user.crewIds.length === 1 ? 'active membership' : 'active memberships'}
                            <ArrowUpRight aria-hidden="true" className="tw:size-3.5" />
                          </Link>
                        ) : (
                          <Badge variant="outline">Not assigned</Badge>
                        )
                      ) : (
                        <span className="tw:text-xs tw:text-[#8a9680]">Not applicable</span>
                      )}
                    </TableCell>
                    <TableCell className="tw:py-5 tw:align-top tw:max-[900px]:p-0">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Edit account ${user.username}`}
                        onClick={(event) => startEdit(user, event.currentTarget)}
                      >
                        <Pencil aria-hidden="true" />
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}
      <aside className="tw:flex tw:items-start tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#e0e6d9] tw:bg-[#f5f8f0] tw:p-4">
        <KeyRound
          aria-hidden="true"
          className="tw:mt-0.5 tw:size-4 tw:shrink-0 tw:text-[#69835e]"
        />
        <p className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
          Account access and team membership are managed separately. Add a Team member account here,
          then assign it through{' '}
          <Link
            href="/backoffice/crews"
            className="tw:font-semibold tw:text-[#426b40] tw:underline-offset-4 tw:hover:underline"
          >
            Teams → Members
          </Link>
          . Unassigned counts include disabled accounts.
        </p>
      </aside>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next && !busy) setSelection(null);
        }}
      >
        <SheetContent
          className="accounts-theme tw:max-w-[620px]"
          closeLabel={selection?.mode === 'create' ? 'Close create account' : 'Close edit account'}
          closeDisabled={busy}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current?.isConnected) returnFocus.current.focus();
            else createButton.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          {open && selection && (
            <>
              <SheetHeader>
                <p className="tw:m-0 tw:text-[10px] tw:font-bold tw:tracking-widest tw:text-[#226347] tw:uppercase">
                  Administration
                </p>
                <SheetTitle>
                  {selection.mode === 'create' ? 'Create an account' : 'Edit account'}
                </SheetTitle>
                <SheetDescription>
                  {selection.mode === 'create'
                    ? 'Create personal sign-in details and choose the right access.'
                    : `Manage ${selected?.username ?? ''}. The username stays unchanged.`}
                </SheetDescription>
              </SheetHeader>
              <AccountEditorForm
                key={selection.mode === 'create' ? 'create' : selected!.id}
                user={selected ?? undefined}
                onSaved={saved}
                onPendingChange={setBusy}
                onCancel={closeEditor}
                currentUserId={currentUser.id}
              />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
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
  return <AccountManagement currentUser={user} />;
}
