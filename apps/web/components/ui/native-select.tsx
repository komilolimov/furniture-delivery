// Adapted from shadcn/ui (MIT); see LICENSE. Native selection is retained on phones.
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
export function NativeSelect({ className, style, ...props }: ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236d8065' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        ...style,
      }}
      className={cn(
        'tw:min-h-11 tw:w-full tw:min-w-0 tw:appearance-none tw:bg-no-repeat tw:bg-[position:right_12px_center] tw:bg-[length:16px_16px] tw:rounded-lg tw:border tw:border-solid tw:border-[#d5dfd0] tw:bg-white tw:px-3 tw:py-2.5 tw:pr-9 tw:text-xs tw:leading-normal tw:font-normal tw:text-[#294b39] tw:focus-visible:outline-3 tw:focus-visible:outline-solid tw:focus-visible:outline-[#91b88e] tw:focus-visible:outline-offset-2 tw:aria-invalid:border-[#97372a] tw:disabled:cursor-not-allowed tw:disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
