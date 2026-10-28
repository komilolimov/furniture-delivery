'use client';

import type { CrewListResponse, PlanningProgress } from '@furniture-delivery/contracts';
import { memo, useId, useState, type FormEvent } from 'react';
import { Search, SlidersHorizontal, Users, X } from 'lucide-react';
import { progressLabels, serviceLabels } from '../lib/order-labels';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SelectField } from './ui/select';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './ui/popover';

export interface PlanningFilterValue {
  allTeams: boolean;
  crewIds: string[];
  includeUnassigned: boolean;
  confirmation: 'all' | 'CONFIRMED' | 'NEEDS_CONFIRMATION';
  attention: 'all' | 'attention' | 'clear';
  serviceType: '' | 'DELIVERY_ONLY' | 'DELIVERY_AND_ASSEMBLY';
  progress: '' | PlanningProgress;
}
export const initialPlanningFilters: PlanningFilterValue = {
  allTeams: true,
  crewIds: [],
  includeUnassigned: true,
  confirmation: 'all',
  attention: 'all',
  serviceType: '',
  progress: '',
};
const labelClass = 'tw:grid tw:min-w-0 tw:gap-2 tw:text-xs tw:font-semibold tw:text-[#52654f]';
const checkboxClass =
  'tw:size-4 tw:shrink-0 tw:accent-[#28543b] tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-[#91b88e] tw:focus-visible:outline-offset-3';
const confirmationLabels = {
  all: 'All confirmations',
  CONFIRMED: 'Confirmed',
  NEEDS_CONFIRMATION: 'Needs confirmation',
};
const attentionLabels = {
  all: 'All attention states',
  attention: 'Needs attention',
  clear: 'No attention flags',
};

/** Draft/search state stays here so choosing filters never rebuilds the calendar before Apply. */
export const PlanningFilters = memo(function PlanningFilters({
  value,
  onApply,
  crews,
  pending,
  error,
  onRetry,
}: Readonly<{
  value: PlanningFilterValue;
  onApply: (value: PlanningFilterValue) => void;
  crews: CrewListResponse['crews'];
  pending: boolean;
  error: string | null;
  onRetry: () => void;
}>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PlanningFilterValue>(value);
  const [teamSearch, setTeamSearch] = useState('');
  const count = [
    !value.allTeams,
    !value.includeUnassigned,
    value.confirmation !== 'all',
    value.attention !== 'all',
    !!value.serviceType,
    !!value.progress,
  ].filter(Boolean).length;
  const search = teamSearch.trim().toLocaleLowerCase();
  const shownCrews = crews.filter((crew) =>
    `${crew.code} ${crew.name}`.toLocaleLowerCase().includes(search),
  );
  const chips: { key: keyof PlanningFilterValue; text: string; remove: string }[] = [];
  if (!value.allTeams)
    chips.push({
      key: 'allTeams',
      text: value.crewIds.length ? `${value.crewIds.length} selected teams` : 'No teams selected',
      remove: 'Remove team filter',
    });
  if (!value.includeUnassigned)
    chips.push({
      key: 'includeUnassigned',
      text: 'Unassigned excluded',
      remove: 'Include unassigned visits',
    });
  if (value.confirmation !== 'all')
    chips.push({
      key: 'confirmation',
      text: confirmationLabels[value.confirmation],
      remove: 'Remove confirmation filter',
    });
  if (value.attention !== 'all')
    chips.push({
      key: 'attention',
      text: attentionLabels[value.attention],
      remove: 'Remove attention filter',
    });
  if (value.serviceType)
    chips.push({
      key: 'serviceType',
      text: serviceLabels[value.serviceType],
      remove: 'Remove service filter',
    });
  if (value.progress)
    chips.push({
      key: 'progress',
      text: progressLabels[value.progress],
      remove: 'Remove work progress filter',
    });

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply({ ...draft, crewIds: [...new Set(draft.crewIds)].sort() });
    setOpen(false);
  }
  function clear() {
    setDraft({ ...initialPlanningFilters, crewIds: [] });
    onApply({ ...initialPlanningFilters, crewIds: [] });
  }
  function remove(key: keyof PlanningFilterValue) {
    onApply({ ...value, [key]: initialPlanningFilters[key] });
  }
  return (
    <section
      aria-label="Planning filtering"
      className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1"
    >
      <Popover
        modal
        open={open}
        onOpenChange={(next) => {
          setDraft(value);
          setTeamSearch('');
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" aria-label="Teams & filters">
            <SlidersHorizontal aria-hidden="true" /> Teams & filters
            {count > 0 && (
              <Badge variant="default" className="tw:min-w-5 tw:justify-center tw:px-1.5 tw:py-0.5">
                {count}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          aria-label="Planning filters"
          aria-describedby={`${id}-description`}
          className="tw:max-h-[80dvh] tw:w-[min(420px,calc(100vw_-_32px))] tw:p-5"
        >
          <div className="tw:mb-5 tw:flex tw:items-start tw:justify-between tw:gap-3">
            <div>
              <h2 className="tw:m-0 tw:text-base tw:font-semibold tw:tracking-[-0.3px]">
                Plan your view
              </h2>
              <p
                id={`${id}-description`}
                className="tw:mt-1.5 tw:mb-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]"
              >
                Choose teams and narrow visits in the selected calendar range. Apply when ready.
              </p>
            </div>
            <PopoverClose asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close planning filters"
                className="tw:-mt-2 tw:-mr-2"
              >
                <X aria-hidden="true" />
              </Button>
            </PopoverClose>
          </div>
          <form
            aria-label="Planning filters"
            onSubmit={apply}
            className="tw:grid tw:min-w-0 tw:gap-5"
          >
            <fieldset className="tw:m-0 tw:min-w-0 tw:border-0 tw:p-0">
              <legend className="tw:mb-3 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-semibold tw:text-[#52654f]">
                <Users aria-hidden="true" className="tw:size-4" /> Teams & unassigned visits
              </legend>
              <div className="tw:grid tw:grid-cols-2 tw:gap-2">
                <label className="tw:flex tw:min-h-11 tw:cursor-pointer tw:items-center tw:gap-2 tw:text-xs">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={draft.allTeams}
                    onChange={(event) =>
                      setDraft((previous) => ({ ...previous, allTeams: event.target.checked }))
                    }
                  />
                  All teams
                </label>
                <label className="tw:flex tw:min-h-11 tw:cursor-pointer tw:items-center tw:gap-2 tw:text-xs">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={draft.includeUnassigned}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        includeUnassigned: event.target.checked,
                      }))
                    }
                  />
                  Include unassigned
                </label>
              </div>
              <label className="tw:relative tw:mt-2 tw:block">
                <span className="tw:sr-only">Find teams</span>
                <Search
                  aria-hidden="true"
                  className="tw:pointer-events-none tw:absolute tw:top-1/2 tw:left-3 tw:size-4 tw:-translate-y-1/2 tw:text-[#819079]"
                />
                <Input
                  type="search"
                  value={teamSearch}
                  onChange={(event) => setTeamSearch(event.target.value)}
                  maxLength={120}
                  placeholder="Find a team by name or code"
                  className="tw:pl-10"
                />
              </label>
              <p className="tw:my-2 tw:text-[11px] tw:leading-relaxed tw:text-[#65716a]">
                {draft.allTeams
                  ? 'All teams included. Turn this off to select individual teams.'
                  : `${draft.crewIds.length} teams selected.`}{' '}
                Inactive teams remain available for retained visits.
              </p>
              {pending && (
                <p role="status" className="tw:text-xs tw:text-[#65716a]">
                  Loading teams…
                </p>
              )}
              {error && (
                <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                  <p role="alert" className="tw:m-0 tw:text-xs tw:text-[#97372a]">
                    {error}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => onRetry()}>
                    Retry teams
                  </Button>
                </div>
              )}
              <div
                role="group"
                aria-label="Individual teams"
                className="tw:max-h-[176px] tw:overflow-y-auto tw:overscroll-contain tw:rounded-lg tw:border tw:border-solid tw:border-[#e0e6d9] tw:bg-white tw:p-1"
              >
                {shownCrews.map((crew) => (
                  <label
                    key={crew.id}
                    className="tw:flex tw:min-h-11 tw:cursor-pointer tw:items-center tw:gap-3 tw:rounded-md tw:px-2 tw:py-2 tw:text-xs tw:hover:bg-[#f1f5ec]"
                  >
                    <input
                      type="checkbox"
                      aria-label={`Filter team ${crew.name}`}
                      className={checkboxClass}
                      checked={draft.crewIds.includes(crew.id)}
                      disabled={draft.allTeams}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          crewIds: event.target.checked
                            ? [...previous.crewIds, crew.id]
                            : previous.crewIds.filter((crewId) => crewId !== crew.id),
                        }))
                      }
                    />
                    <span className="tw:min-w-0 tw:flex-1 tw:wrap-anywhere">
                      {crew.name}
                      {!crew.active && (
                        <span className="tw:ml-1 tw:text-[#7a8871]">(inactive)</span>
                      )}
                    </span>
                    <span className="tw:text-[10px] tw:text-[#7a8871]">{crew.code}</span>
                  </label>
                ))}
                {shownCrews.length === 0 && !pending && !error && (
                  <p className="tw:m-0 tw:p-3 tw:text-xs tw:text-[#65716a]">
                    {search ? 'No matching teams.' : 'No teams available.'}
                  </p>
                )}
              </div>
            </fieldset>
            <fieldset className="tw:m-0 tw:min-w-0 tw:border-0 tw:p-0">
              <legend className="tw:mb-3 tw:text-xs tw:font-semibold tw:text-[#52654f]">
                Within the selected range
              </legend>
              <div className="tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-3 tw:max-[360px]:grid-cols-1">
                <label className={labelClass}>
                  Confirmation
                  <SelectField
                    label="Confirmation"
                    value={draft.confirmation}
                    onValueChange={(next) =>
                      setDraft((previous) => ({
                        ...previous,
                        confirmation: next as PlanningFilterValue['confirmation'],
                      }))
                    }
                    options={Object.entries(confirmationLabels).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                </label>
                <label className={labelClass}>
                  Attention
                  <SelectField
                    label="Attention"
                    value={draft.attention}
                    onValueChange={(next) =>
                      setDraft((previous) => ({
                        ...previous,
                        attention: next as PlanningFilterValue['attention'],
                      }))
                    }
                    options={Object.entries(attentionLabels).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                </label>
                <label className={labelClass}>
                  Service
                  <SelectField
                    label="Service"
                    value={draft.serviceType}
                    onValueChange={(next) =>
                      setDraft((previous) => ({
                        ...previous,
                        serviceType: next as PlanningFilterValue['serviceType'],
                      }))
                    }
                    options={[
                      { value: '', label: 'All services' },
                      ...Object.entries(serviceLabels).map(([value, label]) => ({ value, label })),
                    ]}
                  />
                </label>
                <label className={labelClass}>
                  Work progress
                  <SelectField
                    label="Work progress"
                    value={draft.progress}
                    onValueChange={(next) =>
                      setDraft((previous) => ({
                        ...previous,
                        progress: next as PlanningFilterValue['progress'],
                      }))
                    }
                    options={[
                      { value: '', label: 'All work states' },
                      ...Object.entries(progressLabels).map(([value, label]) => ({ value, label })),
                    ]}
                  />
                </label>
              </div>
            </fieldset>
            <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e8ece3] tw:pt-4">
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft({ ...initialPlanningFilters, crewIds: [] });
                  setTeamSearch('');
                }}
              >
                Reset selection
              </Button>
              <Button type="submit">Apply filters</Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
      {chips.map((chip) => (
        <Button
          key={chip.key}
          variant="ghost"
          aria-label={chip.remove}
          title={chip.text}
          className="tw:min-w-0 tw:max-w-full tw:rounded-full tw:px-0 tw:py-0 tw:hover:bg-transparent"
          onClick={() => remove(chip.key)}
        >
          <Badge variant="default" className="tw:gap-2 tw:py-1.5">
            <span className="tw:max-w-[160px] tw:truncate">{chip.text}</span>
            <X aria-hidden="true" className="tw:size-3.5" />
          </Badge>
        </Button>
      ))}
      {count > 0 && (
        <Button variant="ghost" onClick={clear} className="tw:text-[#65716a]">
          Clear filters
        </Button>
      )}
    </section>
  );
});
