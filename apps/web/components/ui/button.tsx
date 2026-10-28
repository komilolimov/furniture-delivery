// Adapted from shadcn/ui (MIT); see LICENSE. Tailwind prefix and palette are project-specific.
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

const variants = {
  default: 'tw:border-[#183d30] tw:bg-[#183d30] tw:text-white tw:hover:bg-[#28523d]',
  outline: 'tw:border-[#d5dfd0] tw:bg-white tw:text-[#294b39] tw:hover:bg-[#f0f5ec]',
  ghost: 'tw:border-transparent tw:bg-transparent tw:text-[#3e5d47] tw:hover:bg-[#edf3e8]',
};
const sizes = {
  default: 'tw:min-h-11 tw:px-4 tw:py-2.5',
  sm: 'tw:min-h-11 tw:px-3 tw:py-2',
  icon: 'tw:size-11 tw:shrink-0 tw:p-2.5',
};
type ButtonOptions = {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  className?: string;
};
export function buttonVariants({
  variant = 'default',
  size = 'default',
  className,
}: ButtonOptions = {}) {
  return cn(
    'tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:rounded-lg tw:border tw:border-solid tw:text-xs tw:leading-normal tw:font-semibold tw:no-underline tw:cursor-pointer tw:focus-visible:outline-3 tw:focus-visible:outline-solid tw:focus-visible:outline-[#91b88e] tw:focus-visible:outline-offset-2 tw:disabled:pointer-events-none tw:disabled:opacity-50 tw:[&_svg]:size-4 tw:[&_svg]:shrink-0 tw:[&_svg]:stroke-[1.75]',
    variants[variant],
    sizes[size],
    className,
  );
}
export function Button({
  className,
  variant,
  size,
  type = 'button',
  ...props
}: ComponentProps<'button'> & ButtonOptions) {
  return (
    <button
      data-slot="button"
      type={type}
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  );
}
