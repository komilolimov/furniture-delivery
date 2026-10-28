'use client';

import type { IssueStatus, IssueType } from '@furniture-delivery/contracts';
import { memo, useId, useState, type FormEvent } from 'react';
import { ListFilter, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { issueTypeLabel, issueTypes } from './issue-presentation';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './ui/popover';
import { SelectField } from './ui/select';

export interface IssueFilterValue {
  status: IssueStatus | '';
  type: IssueType | '';
  pageSize: '20' | '50' | '100';
}
const fieldClass = 'tw:grid tw:min-w-0 tw:gap-2 tw:text-xs tw:font-semibold tw:text-[#52654f]';
const statusLabels: Record<IssueStatus, string> = {
  OPEN: 'Open issues',
  RESOLVED: 'Resolved issues',
};

/** Only applied choices reach the server. Reset clears conditions and keeps the page size. */
export const IssueFilters = memo(function IssueFilters({
  value,
  onApply,
  onRefresh,
  refreshing = false,
}: Readonly<{
  value: IssueFilterValue;
  onApply: (value: IssueFilterValue) => void;
  onRefresh: () => void;
  refreshing?: boolean;
}>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<IssueFilterValue>(value);
  const count = Number(Boolean(value.status)) + Number(Boolean(value.type));
  const chips: { key: 'status' | 'type'; text: string; remove: string }[] = [];
  if (value.status)
    chips.push({
      key: 'status',
      text: statusLabels[value.status],
      remove: 'Remove issue status filter',
    });
  if (value.type)
    chips.push({
      key: 'type',
      text: issueTypeLabel(value.type),
      remove: 'Remove issue type filter',
    });

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply({ ...draft });
    setOpen(false);
  }

  return (
    <section aria-label="Issue filtering" className="tw:grid tw:min-w-0 tw:gap-3">
      <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
        <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-3">
          <Popover
            modal
            open={open}
            onOpenChange={(next) => {
              setDraft({ ...value });
              setOpen(next);
            }}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" aria-label="Filter issues">
                <SlidersHorizontal aria-hidden="true" /> Filters
                {count > 0 && (
                  <Badge className="tw:min-w-5 tw:justify-center tw:px-1.5 tw:py-0.5">
                    {count}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent aria-label="Issue filters" aria-describedby={`${id}-help`}>
              <div className="tw:mb-5 tw:flex tw:items-start tw:justify-between tw:gap-3">
                <div>
                  <h2 className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-base tw:font-semibold tw:tracking-[-0.3px]">
                    <ListFilter aria-hidden="true" className="tw:size-4 tw:text-[#6e8565]" /> Filter
                    issues
                  </h2>
                  <p
                    id={`${id}-help`}
                    className="tw:mt-2 tw:mb-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]"
                  >
                    Narrow the list by status and problem type.
                  </p>
                </div>
                <PopoverClose asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close issue filters"
                    className="tw:-mt-2 tw:-mr-2"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </PopoverClose>
              </div>
              <form
                aria-label="Issue filters"
                onSubmit={apply}
                className="tw:grid tw:min-w-0 tw:gap-5"
              >
                <label className={fieldClass}>
                  Issue status
                  <SelectField
                    label="Issue status"
                    value={draft.status}
                    onValueChange={(status) =>
                      setDraft((current) => ({
                        ...current,
                        status: status as IssueFilterValue['status'],
                      }))
                    }
                    options={[
                      { value: '', label: 'All issues' },
                      { value: 'OPEN', label: 'Open' },
                      { value: 'RESOLVED', label: 'Resolved' },
                    ]}
                  />
                </label>
                <label className={fieldClass}>
                  Issue type
                  <SelectField
                    label="Issue type"
                    value={draft.type}
                    onValueChange={(type) =>
                      setDraft((current) => ({
                        ...current,
                        type: type as IssueFilterValue['type'],
                      }))
                    }
                    options={[
                      { value: '', label: 'All types' },
                      ...issueTypes.map((type) => ({ value: type, label: issueTypeLabel(type) })),
                    ]}
                  />
                </label>
                <label className={fieldClass}>
                  Per page
                  <SelectField
                    label="Per page"
                    value={draft.pageSize}
                    onValueChange={(pageSize) =>
                      setDraft((current) => ({
                        ...current,
                        pageSize: pageSize as IssueFilterValue['pageSize'],
                      }))
                    }
                    options={['20', '50', '100'].map((size) => ({ value: size, label: size }))}
                  />
                </label>
                <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e5eadf] tw:pt-4">
                  <Button
                    variant="ghost"
                    onClick={() => setDraft((current) => ({ ...current, status: '', type: '' }))}
                  >
                    Reset selection
                  </Button>
                  <Button type="submit">Apply issue filters</Button>
                </div>
              </form>
            </PopoverContent>
          </Popover>
          <span className="tw:text-xs tw:text-[#73816b]">{value.pageSize} per page</span>
        </div>
        <Button
          variant="ghost"
          onClick={() => onRefresh()}
          disabled={refreshing}
          aria-busy={refreshing}
        >
          <RotateCcw aria-hidden="true" /> {refreshing ? 'Refreshing issues…' : 'Refresh issues'}
        </Button>
      </div>
      {chips.length > 0 && (
        <div
          aria-label="Applied issue filters"
          className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2"
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
                onClick={() => onApply({ ...value, [chip.key]: '' })}
                className="tw:grid tw:size-7 tw:shrink-0 tw:cursor-pointer tw:place-items-center tw:rounded-full tw:border-0 tw:bg-transparent tw:text-inherit tw:hover:bg-[#dce9d3] tw:focus-visible:outline-2 tw:focus-visible:outline-[#91b88e]"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onApply({ ...value, status: '', type: '' })}
          >
            Clear issue filters
          </Button>
        </div>
      )}
    </section>
  );
});
