'use client';
// Adapted from shadcn/ui (MIT); see LICENSE. Empty public values use an internal sentinel.
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../lib/utils';
const empty = '__orders_no_filter__';
export function SelectField({
  label,
  value,
  onValueChange,
  options,
  disabled,
  className,
}: Readonly<{
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
  disabled?: boolean;
  className?: string;
}>) {
  return (
    <SelectPrimitive.Root
      value={value || empty}
      onValueChange={(next) => onValueChange(next === empty ? '' : next)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        aria-label={label}
        className={cn(
          'tw:inline-flex tw:min-h-11 tw:w-full tw:min-w-0 tw:cursor-pointer tw:items-center tw:justify-between tw:gap-2 tw:rounded-lg tw:border tw:border-solid tw:border-[#d5dfd0] tw:bg-white tw:px-3 tw:py-2.5 tw:text-left tw:text-xs tw:leading-normal tw:font-normal tw:text-[#294b39] tw:focus-visible:outline-3 tw:focus-visible:outline-solid tw:focus-visible:outline-[#91b88e] tw:focus-visible:outline-offset-2 tw:disabled:cursor-not-allowed tw:disabled:opacity-50',
          className,
        )}
      >
        <SelectPrimitive.Value className="tw:min-w-0 tw:flex-1 tw:truncate" />
        <SelectPrimitive.Icon asChild>
          <ChevronDown
            aria-hidden="true"
            size={16}
            strokeWidth={1.75}
            className="tw:size-4 tw:shrink-0 tw:text-[#6d8065]"
          />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          className="tw:z-[70] tw:max-h-[min(320px,var(--radix-select-content-available-height))] tw:w-[max(var(--radix-select-trigger-width),180px)] tw:max-w-[calc(100vw_-_24px)] tw:overflow-hidden tw:rounded-xl tw:border tw:border-solid tw:border-[#dce4d5] tw:bg-[#fffefa] tw:text-[#18372e] tw:shadow-xl"
        >
          <SelectPrimitive.ScrollUpButton className="tw:flex tw:h-7 tw:items-center tw:justify-center">
            <ChevronUp aria-hidden="true" size={16} className="tw:size-4" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="tw:p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value || empty}
                value={option.value || empty}
                disabled={option.disabled}
                className="tw:relative tw:flex tw:min-h-11 tw:cursor-pointer tw:items-center tw:rounded-lg tw:py-2 tw:pr-9 tw:pl-3 tw:text-xs tw:leading-relaxed tw:outline-none tw:select-none tw:data-[highlighted]:bg-[#eaf2e4] tw:data-[disabled]:pointer-events-none tw:data-[disabled]:opacity-50"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="tw:absolute tw:right-3">
                  <Check
                    aria-hidden="true"
                    size={15}
                    strokeWidth={1.75}
                    className="tw:size-[15px]"
                  />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="tw:flex tw:h-7 tw:items-center tw:justify-center">
            <ChevronDown aria-hidden="true" size={16} className="tw:size-4" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
