'use client';

import type { ReturnRequestStatus } from '@furniture-delivery/contracts';
import { memo, useId, useState, type FormEvent } from 'react';
import {
  BadgeCheck,
  CalendarClock,
  CircleDashed,
  ListFilter,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './ui/popover';
import { SelectField } from './ui/select';

export interface ReturnRequestFilterValue {
  status: ReturnRequestStatus | '';
  pageSize: '20' | '50' | '100';
}
const statusLabels: Record<ReturnRequestStatus, string> = {
  OPEN: 'Open',
  PLANNED: 'Planned · need still open',
  RESOLVED: 'Resolved',
};
const statusIcons = { OPEN: CircleDashed, PLANNED: CalendarClock, RESOLVED: BadgeCheck };
const fieldClass = 'tw:grid tw:min-w-0 tw:gap-2 tw:text-xs tw:font-semibold tw:text-[#52654f]';

/** A search result never changes while status or pagination choices are still drafts. */
export const ReturnRequestFilters = memo(function ReturnRequestFilters({
  value,
  onApply,
  onRefresh,
  refreshing = false,
}: Readonly<{
  value: ReturnRequestFilterValue;
  onApply: (value: ReturnRequestFilterValue) => void;
  onRefresh: () => void;
  refreshing?: boolean;
}>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReturnRequestFilterValue>(value);
  const StatusIcon = value.status ? statusIcons[value.status] : ListFilter;

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply({ ...draft });
    setOpen(false);
  }

  return (
    <section aria-label="Return request filtering" className="tw:grid tw:min-w-0 tw:gap-3">
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
              <Button variant="outline" aria-label="Filter return requests">
                <SlidersHorizontal aria-hidden="true" /> Filters
                {value.status && (
                  <Badge className="tw:min-w-5 tw:justify-center tw:px-1.5 tw:py-0.5">1</Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent aria-label="Return request filters" aria-describedby={`${id}-help`}>
              <div className="tw:mb-5 tw:flex tw:items-start tw:justify-between tw:gap-3">
                <div className="tw:min-w-0">
                  <h2 className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-base tw:font-semibold tw:tracking-[-0.3px]">
                    <ListFilter aria-hidden="true" className="tw:size-4 tw:text-[#6e8565]" /> Filter
                    requests
                  </h2>
                  <p
                    id={`${id}-help`}
                    className="tw:mt-2 tw:mb-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]"
                  >
                    A planned visit still needs completion and dispatcher review.
                  </p>
                </div>
                <PopoverClose asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close request filters"
                    className="tw:-mt-2 tw:-mr-2"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </PopoverClose>
              </div>
              <form
                aria-label="Return request filters"
                onSubmit={apply}
                className="tw:grid tw:min-w-0 tw:gap-5"
              >
                <label className={fieldClass}>
                  Request status
                  <SelectField
                    label="Request status"
                    value={draft.status}
                    onValueChange={(status) =>
                      setDraft((current) => ({
                        ...current,
                        status: status as ReturnRequestFilterValue['status'],
                      }))
                    }
                    options={[
                      { value: '', label: 'All requests' },
                      { value: 'OPEN', label: statusLabels.OPEN },
                      { value: 'PLANNED', label: statusLabels.PLANNED },
                      { value: 'RESOLVED', label: statusLabels.RESOLVED },
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
                        pageSize: pageSize as ReturnRequestFilterValue['pageSize'],
                      }))
                    }
                    options={['20', '50', '100'].map((size) => ({ value: size, label: size }))}
                  />
                </label>
                <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e5eadf] tw:pt-4">
                  <Button
                    variant="ghost"
                    onClick={() => setDraft((current) => ({ ...current, status: '' }))}
                  >
                    Reset selection
                  </Button>
                  <Button type="submit">Apply request filters</Button>
                </div>
              </form>
            </PopoverContent>
          </Popover>
          <span className="tw:text-xs tw:text-[#73816b]">{value.pageSize} per page</span>
        </div>
        <Button
          variant="ghost"
          aria-label="Refresh requests"
          onClick={() => onRefresh()}
          disabled={refreshing}
          aria-busy={refreshing}
        >
          <RotateCcw aria-hidden="true" />{' '}
          {refreshing ? 'Refreshing requests…' : 'Refresh requests'}
        </Button>
      </div>
      {value.status && (
        <div
          aria-label="Applied return request filters"
          className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2"
        >
          <Badge variant="secondary" className="tw:max-w-full tw:gap-1.5 tw:py-1 tw:pr-1">
            <StatusIcon size={13} className="tw:size-[13px] tw:shrink-0" aria-hidden="true" />
            <span className="tw:min-w-0 tw:wrap-anywhere">{statusLabels[value.status]}</span>
            <button
              type="button"
              aria-label="Remove request status filter"
              onClick={() => onApply({ ...value, status: '' })}
              className="tw:grid tw:size-7 tw:shrink-0 tw:cursor-pointer tw:place-items-center tw:rounded-full tw:border-0 tw:bg-transparent tw:text-inherit tw:hover:bg-[#dce9d3] tw:focus-visible:outline-2 tw:focus-visible:outline-[#91b88e]"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => onApply({ ...value, status: '' })}>
            Clear request filters
          </Button>
        </div>
      )}
    </section>
  );
});
