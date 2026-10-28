// Adapted from shadcn/ui (MIT); see LICENSE.
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        'tw:min-h-11 tw:w-full tw:min-w-0 tw:rounded-lg tw:border tw:border-solid tw:border-[#d5dfd0] tw:bg-white tw:px-3 tw:py-2.5 tw:text-[13px] tw:leading-normal tw:font-normal tw:text-[#18372e] tw:placeholder:text-[#8a9584] tw:focus-visible:outline-3 tw:focus-visible:outline-solid tw:focus-visible:outline-[#91b88e] tw:focus-visible:outline-offset-2 tw:aria-invalid:border-[#97372a] tw:disabled:cursor-not-allowed tw:disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
