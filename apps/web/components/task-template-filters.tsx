'use client';

import { memo, useEffect, useId, useState, type FormEvent } from 'react';
import {
  CircleCheck,
  Layers3,
  ListFilter,
  Power,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Truck,
  X,
} from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './ui/popover';
import { SelectField } from './ui/select';

export interface TemplateFilterValue {
  search: string;
  status: 'all' | 'enabled' | 'disabled';
  required: 'all' | 'required' | 'optional';
  applicability: 'all' | 'ALL' | 'DELIVERY_ONLY' | 'DELIVERY_AND_ASSEMBLY';
  severity: 'all' | 'LOW' | 'MEDIUM' | 'HIGH';
}
export const initialTemplateFilters: TemplateFilterValue = {
  search: '',
  status: 'all',
  required: 'all',
  applicability: 'all',
  severity: 'all',
};
type AdvancedFilters = Omit<TemplateFilterValue, 'search'>;
const advanced = ({
  status,
  required,
  applicability,
  severity,
}: TemplateFilterValue): AdvancedFilters => ({ status, required, applicability, severity });
const applicabilityLabels = {
  ALL: 'All-service templates',
  DELIVERY_ONLY: 'Delivery only',
  DELIVERY_AND_ASSEMBLY: 'Delivery and assembly',
};
const severityLabels = { LOW: 'Low severity', MEDIUM: 'Medium severity', HIGH: 'High severity' };
const fieldClass = 'tw:grid tw:min-w-0 tw:gap-2 tw:text-xs tw:font-semibold tw:text-[#52654f]';

/** Search and advanced criteria have independent, explicitly applied drafts. */
export const TaskTemplateFilters = memo(function TaskTemplateFilters({
  value,
  onApply,
}: Readonly<{
  value: TemplateFilterValue;
  onApply: (value: TemplateFilterValue) => void;
}>) {
  const id = useId();
  const [searchDraft, setSearchDraft] = useState(value.search);
  const [draft, setDraft] = useState(() => advanced(value));
  const [open, setOpen] = useState(false);
  useEffect(() => setSearchDraft(value.search), [value.search]);
  const count = Object.values(advanced(value)).filter((choice) => choice !== 'all').length;
  const chips: { key: keyof TemplateFilterValue; text: string; remove: string }[] = [];
  if (value.search)
    chips.push({
      key: 'search',
      text: `Search: ${value.search}`,
      remove: 'Remove template search filter',
    });
  if (value.status !== 'all')
    chips.push({
      key: 'status',
      text: value.status === 'enabled' ? 'Enabled templates' : 'Disabled templates',
      remove: 'Remove template status filter',
    });
  if (value.required !== 'all')
    chips.push({
      key: 'required',
      text: value.required === 'required' ? 'Required templates' : 'Optional templates',
      remove: 'Remove template requirement filter',
    });
  if (value.applicability !== 'all')
    chips.push({
      key: 'applicability',
      text: applicabilityLabels[value.applicability],
      remove: 'Remove template service filter',
    });
  if (value.severity !== 'all')
    chips.push({
      key: 'severity',
      text: severityLabels[value.severity],
      remove: 'Remove template severity filter',
    });

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = searchDraft.trim();
    setSearchDraft(normalized);
    onApply({ ...value, search: normalized });
  }
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply({ ...value, ...draft });
    setOpen(false);
  }
  function remove(key: keyof TemplateFilterValue) {
    if (key === 'search') setSearchDraft('');
    onApply({ ...value, [key]: initialTemplateFilters[key] });
  }
  function clear() {
    setSearchDraft('');
    setDraft(advanced(initialTemplateFilters));
    onApply({ ...initialTemplateFilters });
  }
  return (
    <section aria-label="Task template filtering" className="tw:grid tw:min-w-0 tw:gap-3">
      <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2">
        <form
          role="search"
          aria-label="Search templates"
          onSubmit={search}
          className="tw:flex tw:min-w-0 tw:flex-1 tw:gap-2 tw:max-[600px]:basis-full"
        >
          <label htmlFor={`${id}-search`} className="tw:sr-only">
            Search templates
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
              placeholder="Search name, code or description…"
              maxLength={200}
              className="tw:pr-10 tw:pl-9"
            />
            {searchDraft && (
              <button
                type="button"
                aria-label="Clear template search"
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
          <Button variant="outline" type="submit" aria-label="Search templates">
            Search
          </Button>
        </form>
        <Popover
          modal
          open={open}
          onOpenChange={(next) => {
            setDraft(advanced(value));
            setOpen(next);
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" aria-label="Filter templates">
              <SlidersHorizontal aria-hidden="true" />
              Filters
              {count > 0 && (
                <Badge className="tw:min-w-5 tw:justify-center tw:px-1.5 tw:py-0.5">{count}</Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent aria-label="Template filters" aria-describedby={`${id}-help`}>
            <div className="tw:mb-5 tw:flex tw:items-start tw:justify-between tw:gap-3">
              <div>
                <h2 className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-base tw:font-semibold tw:tracking-[-0.3px]">
                  <ListFilter className="tw:size-4 tw:text-[#6e8565]" aria-hidden="true" />
                  Filter templates
                </h2>
                <p
                  id={`${id}-help`}
                  className="tw:mt-2 tw:mb-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]"
                >
                  Choose the task defaults to show in your catalog.
                </p>
              </div>
              <PopoverClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close template filters"
                  className="tw:-mt-2 tw:-mr-2"
                >
                  <X aria-hidden="true" />
                </Button>
              </PopoverClose>
            </div>
            <form
              aria-label="Template filters"
              onSubmit={apply}
              className="tw:grid tw:min-w-0 tw:gap-5"
            >
              <label className={fieldClass}>
                <span className="tw:inline-flex tw:items-center tw:gap-2">
                  <Power size={14} aria-hidden="true" />
                  Template status
                </span>
                <SelectField
                  label="Template status"
                  value={draft.status}
                  onValueChange={(status) =>
                    setDraft((current) => ({
                      ...current,
                      status: status as TemplateFilterValue['status'],
                    }))
                  }
                  options={[
                    { value: 'all', label: 'Any status' },
                    { value: 'enabled', label: 'Enabled' },
                    { value: 'disabled', label: 'Disabled' },
                  ]}
                />
              </label>
              <label className={fieldClass}>
                <span className="tw:inline-flex tw:items-center tw:gap-2">
                  <CircleCheck size={14} aria-hidden="true" />
                  Task requirement
                </span>
                <SelectField
                  label="Task requirement"
                  value={draft.required}
                  onValueChange={(required) =>
                    setDraft((current) => ({
                      ...current,
                      required: required as TemplateFilterValue['required'],
                    }))
                  }
                  options={[
                    { value: 'all', label: 'Any requirement' },
                    { value: 'required', label: 'Required' },
                    { value: 'optional', label: 'Optional' },
                  ]}
                />
              </label>
              <label className={fieldClass}>
                <span className="tw:inline-flex tw:items-center tw:gap-2">
                  <Truck size={14} aria-hidden="true" />
                  Service applicability
                </span>
                <SelectField
                  label="Service applicability"
                  value={draft.applicability}
                  onValueChange={(applicability) =>
                    setDraft((current) => ({
                      ...current,
                      applicability: applicability as TemplateFilterValue['applicability'],
                    }))
                  }
                  options={[
                    { value: 'all', label: 'Any service applicability' },
                    ...Object.entries(applicabilityLabels).map(([value, label]) => ({
                      value,
                      label,
                    })),
                  ]}
                />
              </label>
              <label className={fieldClass}>
                <span className="tw:inline-flex tw:items-center tw:gap-2">
                  <ShieldAlert size={14} aria-hidden="true" />
                  Template severity
                </span>
                <SelectField
                  label="Template severity"
                  value={draft.severity}
                  onValueChange={(severity) =>
                    setDraft((current) => ({
                      ...current,
                      severity: severity as TemplateFilterValue['severity'],
                    }))
                  }
                  options={[
                    { value: 'all', label: 'Any severity' },
                    { value: 'LOW', label: 'Low' },
                    { value: 'MEDIUM', label: 'Medium' },
                    { value: 'HIGH', label: 'High' },
                  ]}
                />
              </label>
              <p className="tw:m-0 tw:flex tw:items-start tw:gap-2 tw:text-[11px] tw:leading-relaxed tw:text-[#73816b]">
                <Layers3 size={15} aria-hidden="true" className="tw:mt-0.5 tw:shrink-0" />
                All-service templates are available for both service types. Search is applied
                separately.
              </p>
              <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e5eadf] tw:pt-4">
                <Button variant="ghost" onClick={() => setDraft(advanced(initialTemplateFilters))}>
                  Reset selection
                </Button>
                <Button type="submit">Apply template filters</Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      </div>
      {chips.length > 0 && (
        <div
          aria-label="Applied template filters"
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
                onClick={() => remove(chip.key)}
                className="tw:grid tw:size-7 tw:shrink-0 tw:cursor-pointer tw:place-items-center tw:rounded-full tw:border-0 tw:bg-transparent tw:text-inherit tw:hover:bg-[#dce9d3] tw:focus-visible:outline-2 tw:focus-visible:outline-[#91b88e]"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </Badge>
          ))}
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear template filters
          </Button>
        </div>
      )}
    </section>
  );
});
