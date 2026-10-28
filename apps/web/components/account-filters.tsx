'use client';

import type { UserRole } from '@furniture-delivery/contracts';
import { memo, useEffect, useId, useState, type FormEvent } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './ui/popover';
import { SelectField } from './ui/select';

export interface AccountFilterValue {
  search: string;
  role: 'all' | UserRole;
  status: 'all' | 'enabled' | 'disabled';
  membership: 'all' | 'assigned' | 'unassigned';
}
export const initialAccountFilters: AccountFilterValue = {
  search: '',
  role: 'all',
  status: 'all',
  membership: 'all',
};
type AdvancedFilters = Pick<AccountFilterValue, 'role' | 'status' | 'membership'>;
const advanced = ({ role, status, membership }: AccountFilterValue): AdvancedFilters => ({
  role,
  status,
  membership,
});
const roleLabels: Record<UserRole, string> = {
  ADMIN: 'Administrator',
  DISPATCHER: 'Dispatcher',
  CREW_MEMBER: 'Team member',
};
const labelClass = 'tw:grid tw:min-w-0 tw:gap-2 tw:text-xs tw:font-semibold tw:text-[#52654f]';

/** Only confirmed choices leave this component; drafts never trigger directory reads. */
export const AccountFilters = memo(function AccountFilters({
  value,
  onApply,
}: Readonly<{ value: AccountFilterValue; onApply: (value: AccountFilterValue) => void }>) {
  const id = useId();
  const [searchDraft, setSearchDraft] = useState(value.search);
  const [advancedDraft, setAdvancedDraft] = useState(() => advanced(value));
  const [open, setOpen] = useState(false);
  // A parent Clear action updates the input; ordinary refreshes preserve unsent text.
  useEffect(() => setSearchDraft(value.search), [value.search]);
  const count = Object.values(advanced(value)).filter((choice) => choice !== 'all').length;
  const chips: { key: keyof AccountFilterValue; text: string; remove: string }[] = [];
  if (value.search)
    chips.push({ key: 'search', text: `Search: ${value.search}`, remove: 'Remove search filter' });
  if (value.role !== 'all')
    chips.push({ key: 'role', text: roleLabels[value.role], remove: 'Remove role filter' });
  if (value.status !== 'all')
    chips.push({
      key: 'status',
      text: value.status === 'enabled' ? 'Enabled accounts' : 'Disabled accounts',
      remove: 'Remove status filter',
    });
  if (value.membership !== 'all')
    chips.push({
      key: 'membership',
      text:
        value.membership === 'assigned'
          ? 'Team members with a team'
          : 'Team members without a team',
      remove: 'Remove membership filter',
    });

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = searchDraft.trim();
    setSearchDraft(normalized);
    onApply({ ...value, search: normalized });
  }
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = searchDraft.trim();
    setSearchDraft(normalized);
    onApply({ ...value, ...advancedDraft, search: normalized });
    setOpen(false);
  }
  function remove(key: keyof AccountFilterValue) {
    if (key === 'search') setSearchDraft('');
    onApply({ ...value, [key]: initialAccountFilters[key] });
  }
  function clear() {
    setSearchDraft('');
    setAdvancedDraft(advanced(initialAccountFilters));
    onApply({ ...initialAccountFilters });
  }

  return (
    <section aria-label="Account filtering" className="tw:grid tw:min-w-0 tw:gap-3">
      <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2">
        <form
          role="search"
          aria-label="Search accounts"
          onSubmit={search}
          className="tw:flex tw:min-w-0 tw:flex-1 tw:gap-2 tw:max-[600px]:basis-full"
        >
          <label htmlFor={`${id}-search`} className="tw:sr-only">
            Search accounts
          </label>
          <div className="tw:relative tw:min-w-0 tw:flex-1">
            <Search
              aria-hidden="true"
              className="tw:pointer-events-none tw:absolute tw:top-3.5 tw:left-3 tw:size-4 tw:text-[#75856b]"
            />
            <Input
              id={`${id}-search`}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search names or usernames…"
              maxLength={200}
              className="tw:pr-10 tw:pl-9"
            />
            {searchDraft && (
              <button
                type="button"
                aria-label="Clear account search"
                onClick={() => {
                  setSearchDraft('');
                  onApply({ ...value, search: '' });
                }}
                className="tw:absolute tw:top-1 tw:right-1 tw:grid tw:size-9 tw:cursor-pointer tw:place-items-center tw:rounded-md tw:border-0 tw:bg-transparent tw:text-[#75856b] tw:hover:bg-[#edf3e8] tw:focus-visible:outline-2 tw:focus-visible:outline-[#91b88e]"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          <Button variant="outline" type="submit">
            Search
          </Button>
        </form>
        <Popover
          modal
          open={open}
          onOpenChange={(next) => {
            setAdvancedDraft(advanced(value));
            setOpen(next);
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" aria-label="Filter accounts">
              <SlidersHorizontal aria-hidden="true" /> Filters
              {count > 0 && (
                <Badge className="tw:min-w-5 tw:justify-center tw:px-1.5 tw:py-0.5">{count}</Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            aria-label="Account filters"
            aria-describedby={`${id}-description`}
            className="tw:w-[min(420px,calc(100vw_-_32px))] tw:max-h-[80dvh]"
          >
            <div className="tw:mb-5 tw:flex tw:items-start tw:justify-between tw:gap-3">
              <div>
                <h2 className="tw:m-0 tw:text-base tw:font-semibold tw:tracking-[-0.3px]">
                  Filter accounts
                </h2>
                <p
                  id={`${id}-description`}
                  className="tw:mt-1.5 tw:mb-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]"
                >
                  Choose which users to show in this directory.
                </p>
              </div>
              <PopoverClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close account filters"
                  className="tw:-mt-2 tw:-mr-2"
                >
                  <X aria-hidden="true" />
                </Button>
              </PopoverClose>
            </div>
            <form
              aria-label="Account filters"
              onSubmit={apply}
              className="tw:grid tw:min-w-0 tw:gap-5"
            >
              <label className={labelClass}>
                Account role
                <SelectField
                  label="Account role"
                  value={advancedDraft.role}
                  onValueChange={(next) =>
                    setAdvancedDraft((draft) => ({
                      ...draft,
                      role: next as AccountFilterValue['role'],
                    }))
                  }
                  options={[
                    { value: 'all', label: 'All roles' },
                    ...Object.entries(roleLabels).map(([value, label]) => ({ value, label })),
                  ]}
                />
              </label>
              <label className={labelClass}>
                Account status
                <SelectField
                  label="Account status"
                  value={advancedDraft.status}
                  onValueChange={(next) =>
                    setAdvancedDraft((draft) => ({
                      ...draft,
                      status: next as AccountFilterValue['status'],
                    }))
                  }
                  options={[
                    { value: 'all', label: 'All statuses' },
                    { value: 'enabled', label: 'Enabled' },
                    { value: 'disabled', label: 'Disabled' },
                  ]}
                />
              </label>
              <label className={labelClass}>
                Team membership
                <SelectField
                  label="Team membership"
                  value={advancedDraft.membership}
                  onValueChange={(next) =>
                    setAdvancedDraft((draft) => ({
                      ...draft,
                      membership: next as AccountFilterValue['membership'],
                    }))
                  }
                  options={[
                    { value: 'all', label: 'All users' },
                    { value: 'assigned', label: 'Team members with a team' },
                    { value: 'unassigned', label: 'Team members without a team' },
                  ]}
                />
              </label>
              <p className="tw:m-0 tw:text-[11px] tw:leading-relaxed tw:text-[#73816b]">
                Team membership choices apply to Team member accounts. Administrators and
                dispatchers use their own roles.
              </p>
              <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e5eadf] tw:pt-4">
                <Button
                  variant="ghost"
                  onClick={() => setAdvancedDraft(advanced(initialAccountFilters))}
                >
                  Reset selection
                </Button>
                <Button type="submit">Apply filters</Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      </div>
      {chips.length > 0 && (
        <div
          className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2"
          aria-label="Applied account filters"
        >
          {chips.map((chip) => (
            <Badge
              key={chip.key}
              variant="secondary"
              className="tw:max-w-full tw:gap-1 tw:py-1 tw:pr-1"
            >
              <span className="tw:min-w-0 tw:wrap-anywhere">{chip.text}</span>
              <button
                type="button"
                aria-label={chip.remove}
                onClick={() => remove(chip.key)}
                className="tw:grid tw:size-7 tw:shrink-0 tw:cursor-pointer tw:place-items-center tw:rounded-full tw:border-0 tw:bg-transparent tw:text-inherit tw:hover:bg-[#dce9d3] tw:focus-visible:outline-2 tw:focus-visible:outline-[#91b88e]"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </Badge>
          ))}
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear filters
          </Button>
        </div>
      )}
    </section>
  );
});
