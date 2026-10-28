'use client';

// Adapted from shadcn/ui (MIT); see LICENSE. Radix owns dialog/focus/keyboard behavior.
import type { ComponentProps } from 'react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../lib/utils';
import { X } from 'lucide-react';
export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
export function SheetContent({
  className,
  children,
  closeLabel = 'Close preview',
  closeDisabled = false,
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> & {
  closeLabel?: string;
  closeDisabled?: boolean;
}) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="tw:fixed tw:inset-0 tw:z-50 tw:bg-[#102c22]/40"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'tw:fixed tw:inset-y-0 tw:right-0 tw:z-50 tw:flex tw:h-dvh tw:w-full tw:max-w-[560px] tw:min-w-0 tw:flex-col tw:gap-6 tw:overflow-y-auto tw:overscroll-contain tw:border-x-0 tw:border-y-0 tw:border-l tw:border-solid tw:border-[#dce4d5] tw:bg-[#fffefa] tw:p-7 tw:text-[#18372e] tw:shadow-2xl tw:outline-none tw:max-[600px]:max-w-none tw:max-[600px]:p-5',
          className,
        )}
        {...props}
      >
        <SheetPrimitive.Close
          aria-label={closeLabel}
          disabled={closeDisabled}
          className="tw:absolute tw:disabled:cursor-not-allowed tw:disabled:opacity-50 tw:top-4 tw:right-4 tw:inline-flex tw:size-11 tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-lg tw:border-0 tw:bg-transparent tw:text-[#65765f] tw:hover:bg-[#edf3e8] tw:focus-visible:outline-3 tw:focus-visible:outline-solid tw:focus-visible:outline-[#91b88e] tw:focus-visible:outline-offset-2"
        >
          <X aria-hidden="true" size={16} strokeWidth={1.75} className="tw:size-4" />
        </SheetPrimitive.Close>
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}
export function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('tw:flex tw:min-w-0 tw:flex-col tw:gap-2 tw:pr-12', className)}
      {...props}
    />
  );
}
export function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        'tw:m-0 tw:text-xl tw:leading-snug tw:font-semibold tw:tracking-[-0.5px]',
        className,
      )}
      {...props}
    />
  );
}
export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('tw:m-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]', className)}
      {...props}
    />
  );
}
