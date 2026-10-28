// Adapted from shadcn/ui (MIT); see LICENSE. Wrapping supports the mobile card layout.
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="tw:relative tw:w-full tw:overflow-x-auto">
      <table
        data-slot="table"
        className={cn(
          'tw:w-full tw:border-collapse tw:caption-bottom tw:text-[13px] tw:text-[#18372e]',
          className,
        )}
        {...props}
      />
    </div>
  );
}
export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('tw:bg-[#f6f8f1]', className)} {...props} />;
}
export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={className} {...props} />;
}
export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'tw:border-x-0 tw:border-t-0 tw:border-b tw:border-solid tw:border-[#e3e9dd] tw:hover:bg-[#f7faf3]',
        className,
      )}
      {...props}
    />
  );
}
export function TableHead({ className, scope = 'col', ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn(
        'tw:h-12 tw:px-4 tw:py-3 tw:text-left tw:align-middle tw:text-[10px] tw:leading-normal tw:font-semibold tw:tracking-wide tw:whitespace-normal tw:text-[#71806a] tw:uppercase',
        className,
      )}
      {...props}
    />
  );
}
export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'tw:px-4 tw:py-4 tw:align-middle tw:whitespace-normal tw:wrap-anywhere',
        className,
      )}
      {...props}
    />
  );
}
export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('tw:mt-4 tw:text-xs tw:text-[#65716a]', className)}
      {...props}
    />
  );
}
