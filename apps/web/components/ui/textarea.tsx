// Adapted from shadcn/ui (MIT); see LICENSE.
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'tw:min-h-[96px] tw:w-full tw:min-w-0 tw:resize-y tw:rounded-lg tw:border tw:border-solid tw:border-[#d5dfd0] tw:bg-white tw:px-3 tw:py-2.5 tw:text-[13px] tw:leading-relaxed tw:font-normal tw:text-[#18372e] tw:focus-visible:outline-3 tw:focus-visible:outline-solid tw:focus-visible:outline-[#91b88e] tw:focus-visible:outline-offset-2 tw:aria-invalid:border-[#97372a] tw:disabled:cursor-not-allowed tw:disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}
