'use client';

// Adapted from shadcn/ui (MIT); see LICENSE. Radix owns positioning and focus behavior.
import type { ComponentProps } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../../lib/utils';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  align = 'end',
  sideOffset = 8,
  collisionPadding = 16,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          'tw:z-50 tw:w-[min(420px,calc(100vw_-_32px))] tw:max-h-[min(80dvh,480px)] tw:overflow-y-auto tw:overscroll-contain tw:rounded-2xl tw:border tw:border-solid tw:border-[#dce4d5] tw:bg-[#fffefa] tw:p-5 tw:text-[#18372e] tw:shadow-[0_14px_44px_#18372e1c] tw:outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
