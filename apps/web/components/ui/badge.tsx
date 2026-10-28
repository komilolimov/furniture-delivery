// Adapted from shadcn/ui (MIT); see LICENSE.
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
const variants = {
  default: 'tw:border-[#d9e6d4] tw:bg-[#e9f2e3] tw:text-[#3e6743]',
  secondary: 'tw:border-[#e2e6dc] tw:bg-[#f2f4ee] tw:text-[#59674f]',
  outline: 'tw:border-[#dce2d6] tw:bg-transparent tw:text-[#65705c]',
  destructive: 'tw:border-[#ecd8d0] tw:bg-[#fbefea] tw:text-[#9d5747]',
  success: 'tw:border-[#cce1cf] tw:bg-[#e9f4e9] tw:text-[#356445]',
  warning: 'tw:border-[#eee1bf] tw:bg-[#fcf4df] tw:text-[#906627]',
};
export function Badge({
  className,
  variant = 'secondary',
  ...props
}: ComponentProps<'span'> & { variant?: keyof typeof variants }) {
  return (
    <span
      data-slot="badge"
      className={cn(
        'tw:inline-flex tw:max-w-full tw:items-center tw:gap-1.5 tw:rounded-full tw:border tw:border-solid tw:px-2.5 tw:py-1 tw:text-[10px] tw:leading-[1.4] tw:font-semibold tw:whitespace-normal tw:wrap-anywhere',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
