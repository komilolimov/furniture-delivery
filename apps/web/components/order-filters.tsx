'use client';

import type { PaymentStatus, PlanningProgress, ServiceType } from '@furniture-delivery/contracts';
import { useId, useState, type FormEvent } from 'react';
import { paymentLabels, progressLabels, serviceLabels } from '../lib/order-labels';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SelectField } from './ui/select';
import { OrderIcon } from './ui/order-icon';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './ui/popover';

export type OrderFilterValues = {
  search: string;
  serviceType: string;
  paymentStatus: string;
  progress: PlanningProgress | '';
  hasOpenIssues: '' | 'true' | 'false';
  pageSize: string;
};
type AdvancedFilters = Pick<
  OrderFilterValues,
  'serviceType' | 'paymentStatus' | 'progress' | 'hasOpenIssues'
>;
const emptyAdvanced: AdvancedFilters = {
  serviceType: '',
  paymentStatus: '',
  progress: '',
  hasOpenIssues: '',
};
const advancedValues = (value: OrderFilterValues): AdvancedFilters => ({
  serviceType: value.serviceType,
  paymentStatus: value.paymentStatus,
  progress: value.progress,
  hasOpenIssues: value.hasOpenIssues,
});
const labelClass = 'tw:grid tw:min-w-0 tw:gap-2 tw:text-xs tw:font-semibold tw:text-[#52654f]';

export function OrderFilters({
  value,
  onApply,
}: Readonly<{ value: OrderFilterValues; onApply: (next: OrderFilterValues) => void }>) {
  const id = useId();
  const [searchDraft, setSearchDraft] = useState(value.search);
  const [advancedDraft, setAdvancedDraft] = useState<AdvancedFilters>(() => advancedValues(value));
  const [open, setOpen] = useState(false);
  const count = Object.values(advancedValues(value)).filter(Boolean).length;
  const chips = [
    value.search
      ? { key: 'search', text: `Search: ${value.search}`, remove: 'Remove search filter' }
      : null,
    value.progress
      ? {
          key: 'progress',
          text: `Work: ${progressLabels[value.progress]}`,
          remove: 'Remove work progress filter',
        }
      : null,
    value.paymentStatus
      ? {
          key: 'paymentStatus',
          text: `Payment: ${paymentLabels[value.paymentStatus as PaymentStatus] ?? value.paymentStatus}`,
          remove: 'Remove payment status filter',
        }
      : null,
    value.serviceType
      ? {
          key: 'serviceType',
          text: `Service: ${serviceLabels[value.serviceType as ServiceType] ?? value.serviceType}`,
          remove: 'Remove service filter',
        }
      : null,
    value.hasOpenIssues
      ? {
          key: 'hasOpenIssues',
          text:
            value.hasOpenIssues === 'true' ? 'Issues: Has open issues' : 'Issues: No open issues',
          remove: 'Remove issues filter',
        }
      : null,
  ].filter((chip): chip is { key: string; text: string; remove: string } => chip !== null);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = searchDraft.trim();
    setSearchDraft(normalized);
    onApply({ ...value, search: normalized });
  }
  function applyAdvanced(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = searchDraft.trim();
    setSearchDraft(normalized);
    onApply({ ...value, ...advancedDraft, search: normalized });
    setOpen(false);
  }
  function remove(key: string) {
    if (key === 'search') setSearchDraft('');
    onApply({ ...value, [key]: '' });
  }
  function clear() {
    setSearchDraft('');
    setAdvancedDraft({ ...emptyAdvanced });
    onApply({ ...value, ...emptyAdvanced, search: '' });
  }

  return (
    <section
      aria-label="Order filtering"
      className="tw:min-w-0 tw:rounded-xl tw:border tw:border-solid tw:border-[#e0e5da] tw:bg-[#fffefa] tw:p-3 tw:max-[600px]:p-3"
    >
      <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:max-[600px]:flex-wrap">
        <form
          onSubmit={search}
          aria-label="Order search"
          className="tw:flex tw:min-w-0 tw:flex-1 tw:gap-2 tw:max-[600px]:basis-full"
        >
          <label htmlFor={`${id}-search`} className="tw:sr-only">
            Search
          </label>
          <div className="tw:relative tw:min-w-0 tw:flex-1">
            <span className="tw:pointer-events-none tw:absolute tw:top-1/2 tw:left-3 tw:-translate-y-1/2 tw:text-[#819079]">
              <OrderIcon name="search" />
            </span>
            <Input
              id={`${id}-search`}
              name="search"
              type="search"
              className="tw:pl-10"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              maxLength={120}
              placeholder="Order number, customer or city"
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            aria-label="Search orders"
            className="tw:shrink-0"
          >
            Search
          </Button>
        </form>
        <Popover
          modal
          open={open}
          onOpenChange={(next) => {
            setAdvancedDraft(advancedValues(value));
            setOpen(next);
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" aria-label="Filters" className="tw:shrink-0 tw:gap-2">
              <OrderIcon name="filters" /> Filters
              {count > 0 && (
                <Badge
                  variant="default"
                  className="tw:min-w-5 tw:justify-center tw:px-1.5 tw:py-0.5"
                >
                  {count}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            collisionPadding={16}
            aria-label="Order filters"
            aria-describedby={`${id}-description`}
            className="tw:w-[min(420px,calc(100vw_-_32px))] tw:max-h-[min(80dvh,480px)] tw:overflow-y-auto tw:p-5"
          >
            <div className="tw:mb-5 tw:flex tw:items-start tw:justify-between tw:gap-3">
              <div>
                <h2 className="tw:m-0 tw:text-base tw:leading-snug tw:font-semibold tw:tracking-[-0.3px]">
                  Filter orders
                </h2>
                <p
                  id={`${id}-description`}
                  className="tw:mt-1.5 tw:mb-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]"
                >
                  Choose what to show, then apply.
                </p>
              </div>
              <PopoverClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close filters"
                  className="tw:-mt-2 tw:-mr-2"
                >
                  <OrderIcon name="close" />
                </Button>
              </PopoverClose>
            </div>
            <form
              onSubmit={applyAdvanced}
              aria-label="Advanced order filters"
              className="tw:grid tw:min-w-0 tw:gap-5"
            >
              <div className="tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-x-3 tw:gap-y-4 tw:max-[360px]:grid-cols-1">
                <label className={labelClass}>
                  Work progress
                  <SelectField
                    label="Work progress"
                    value={advancedDraft.progress}
                    onValueChange={(next) =>
                      setAdvancedDraft((draft) => ({
                        ...draft,
                        progress: next as PlanningProgress | '',
                      }))
                    }
                    options={[
                      { value: '', label: 'All work states' },
                      ...Object.entries(progressLabels).map(([value, label]) => ({ value, label })),
                    ]}
                  />
                </label>
                <label className={labelClass}>
                  Payment status
                  <SelectField
                    label="Payment status"
                    value={advancedDraft.paymentStatus}
                    onValueChange={(next) =>
                      setAdvancedDraft((draft) => ({ ...draft, paymentStatus: next }))
                    }
                    options={[
                      { value: '', label: 'All payment states' },
                      ...Object.entries(paymentLabels).map(([value, label]) => ({ value, label })),
                    ]}
                  />
                </label>
                <label className={labelClass}>
                  Service
                  <SelectField
                    label="Service"
                    value={advancedDraft.serviceType}
                    onValueChange={(next) =>
                      setAdvancedDraft((draft) => ({ ...draft, serviceType: next }))
                    }
                    options={[
                      { value: '', label: 'All services' },
                      ...Object.entries(serviceLabels).map(([value, label]) => ({ value, label })),
                    ]}
                  />
                </label>
                <label className={labelClass}>
                  Issues
                  <SelectField
                    label="Issues"
                    value={advancedDraft.hasOpenIssues}
                    onValueChange={(next) =>
                      setAdvancedDraft((draft) => ({
                        ...draft,
                        hasOpenIssues: next as '' | 'true' | 'false',
                      }))
                    }
                    options={[
                      { value: '', label: 'All issue states' },
                      { value: 'true', label: 'Has open issues' },
                      { value: 'false', label: 'No open issues' },
                    ]}
                  />
                </label>
              </div>
              <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e8ece3] tw:pt-4">
                <Button variant="ghost" onClick={() => setAdvancedDraft({ ...emptyAdvanced })}>
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
          role="group"
          aria-label="Applied filters"
          className="tw:mt-2 tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-0"
        >
          {chips.map((chip) => (
            <Button
              key={chip.key}
              variant="ghost"
              aria-label={chip.remove}
              aria-describedby={`${id}-chip-${chip.key}`}
              title={chip.text}
              className="tw:min-w-0 tw:max-w-full tw:rounded-full tw:px-0 tw:py-0 tw:hover:bg-transparent"
              onClick={() => remove(chip.key)}
            >
              <Badge variant="default" className="tw:gap-2 tw:py-1.5 tw:pr-2 tw:whitespace-nowrap">
                <span id={`${id}-chip-${chip.key}`} className="tw:max-w-[220px] tw:truncate">
                  {chip.text}
                </span>
                <OrderIcon name="close" />
              </Badge>
            </Button>
          ))}
          <Button variant="ghost" onClick={clear} className="tw:ml-auto tw:text-[#65716a]">
            Clear filters
          </Button>
        </div>
      )}
    </section>
  );
}
