'use client';

import { memo, useEffect, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './ui/popover';
import { SelectField } from './ui/select';

export interface TeamDirectoryFilterValue {
  search: string;
  status: 'all' | 'enabled' | 'disabled';
  environment: 'all' | 'INDOOR' | 'OUTDOOR';
}
export const initialTeamDirectoryFilters: TeamDirectoryFilterValue = {
  search: '',
  status: 'all',
  environment: 'all',
};
export const TeamDirectoryFilters = memo(function TeamDirectoryFilters({
  value,
  onApply,
}: Readonly<{
  value: TeamDirectoryFilterValue;
  onApply: (value: TeamDirectoryFilterValue) => void;
}>) {
  const [search, setSearch] = useState(value.search);
  useEffect(() => setSearch(value.search), [value.search]);
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const count = Number(value.status !== 'all') + Number(value.environment !== 'all');
  function clear() {
    setSearch('');
    setDraft(initialTeamDirectoryFilters);
    onApply(initialTeamDirectoryFilters);
  }
  function remove(key: keyof TeamDirectoryFilterValue) {
    if (key === 'search') setSearch('');
    onApply({ ...value, [key]: initialTeamDirectoryFilters[key] });
  }
  return (
    <section className="tw:grid tw:min-w-0 tw:gap-3" aria-label="Team directory filters">
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <form
          role="search"
          aria-label="Search teams"
          onSubmit={(event) => {
            event.preventDefault();
            onApply({ ...value, search: search.trim() });
          }}
          className="tw:flex tw:min-w-0 tw:flex-1 tw:gap-2"
        >
          <div className="tw:relative tw:min-w-0 tw:flex-1">
            <Search
              aria-hidden="true"
              className="tw:pointer-events-none tw:absolute tw:top-3.5 tw:left-3 tw:size-4 tw:text-[#75856b]"
            />
            <Input
              aria-label="Search teams"
              placeholder="Search by team, code or service area…"
              value={search}
              maxLength={200}
              onChange={(event) => setSearch(event.target.value)}
              className="tw:pr-10 tw:pl-9"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear team search"
                onClick={() => {
                  setSearch('');
                  onApply({ ...value, search: '' });
                }}
                className="tw:absolute tw:top-1 tw:right-1 tw:grid tw:size-9 tw:cursor-pointer tw:place-items-center tw:rounded-md tw:border-0 tw:bg-transparent tw:text-[#75856b] tw:hover:bg-[#edf3e8]"
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
            setDraft(value);
            setOpen(next);
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" aria-label="Filter teams">
              <SlidersHorizontal aria-hidden="true" />
              Filters{' '}
              {count > 0 && (
                <Badge className="tw:min-w-5 tw:justify-center tw:px-1.5 tw:py-0.5">{count}</Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent aria-label="Team filters">
            <div className="tw:mb-5 tw:flex tw:items-start tw:justify-between tw:gap-3">
              <div>
                <h2 className="tw:m-0 tw:text-base tw:font-semibold">Filter teams</h2>
                <p className="tw:mt-1.5 tw:mb-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
                  Narrow the complete team directory.
                </p>
              </div>
              <PopoverClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close team filters"
                  className="tw:-mt-2 tw:-mr-2"
                >
                  <X aria-hidden="true" />
                </Button>
              </PopoverClose>
            </div>
            <form
              aria-label="Team filters"
              onSubmit={(event) => {
                event.preventDefault();
                onApply({ ...draft, search: search.trim() });
                setOpen(false);
              }}
              className="tw:grid tw:gap-5"
            >
              <label className="tw:grid tw:gap-2 tw:text-xs tw:font-semibold">
                Team status
                <SelectField
                  label="Team status"
                  value={draft.status}
                  onValueChange={(value) =>
                    setDraft({ ...draft, status: value as TeamDirectoryFilterValue['status'] })
                  }
                  options={[
                    { value: 'all', label: 'All statuses' },
                    { value: 'enabled', label: 'Enabled' },
                    { value: 'disabled', label: 'Disabled' },
                  ]}
                />
              </label>
              <label className="tw:grid tw:gap-2 tw:text-xs tw:font-semibold">
                Team environment
                <SelectField
                  label="Team environment"
                  value={draft.environment}
                  onValueChange={(value) =>
                    setDraft({
                      ...draft,
                      environment: value as TeamDirectoryFilterValue['environment'],
                    })
                  }
                  options={[
                    { value: 'all', label: 'All environments' },
                    { value: 'INDOOR', label: 'Indoor' },
                    { value: 'OUTDOOR', label: 'Outdoor' },
                  ]}
                />
              </label>
              <div className="tw:flex tw:flex-wrap tw:justify-between tw:gap-2 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e5eadf] tw:pt-4">
                <Button variant="ghost" onClick={() => setDraft(initialTeamDirectoryFilters)}>
                  Reset selection
                </Button>
                <Button type="submit">Apply filters</Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      </div>
      {(value.search || count > 0) && (
        <div
          className="tw:flex tw:flex-wrap tw:items-center tw:gap-2"
          aria-label="Applied team filters"
        >
          {(
            [
              ['search', value.search ? `Search: ${value.search}` : ''],
              [
                'status',
                value.status === 'all'
                  ? ''
                  : value.status === 'enabled'
                    ? 'Enabled teams'
                    : 'Disabled teams',
              ],
              [
                'environment',
                value.environment === 'all'
                  ? ''
                  : value.environment === 'INDOOR'
                    ? 'Indoor'
                    : 'Outdoor',
              ],
            ] as const
          )
            .filter(([, text]) => text)
            .map(([key, text]) => (
              <Badge
                key={key}
                variant="secondary"
                className="tw:max-w-full tw:gap-1 tw:py-1 tw:pr-1"
              >
                <span className="tw:min-w-0 tw:wrap-anywhere">{text}</span>
                <button
                  type="button"
                  aria-label={`Remove ${key} filter`}
                  onClick={() => remove(key)}
                  className="tw:grid tw:size-7 tw:shrink-0 tw:cursor-pointer tw:place-items-center tw:rounded-full tw:border-0 tw:bg-transparent tw:text-inherit tw:hover:bg-[#dce9d3]"
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
