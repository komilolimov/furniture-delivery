'use client';
// Adapted from shadcn/ui (MIT); see LICENSE. Panels are force-mounted by the order page.
import type { ComponentProps } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/utils';
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'tw:flex tw:flex-wrap tw:items-center tw:gap-1 tw:rounded-xl tw:border tw:border-solid tw:border-[#e0e6d9] tw:bg-[#edf2e8] tw:p-1.5',
        className,
      )}
      {...props}
    />
  );
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'tw:inline-flex tw:min-h-11 tw:cursor-pointer tw:items-center tw:justify-center tw:gap-2 tw:rounded-lg tw:border-0 tw:bg-transparent tw:px-4 tw:py-2 tw:text-xs tw:font-semibold tw:text-[#697961] tw:data-[state=active]:bg-white tw:data-[state=active]:text-[#1f5035] tw:data-[state=active]:shadow-sm tw:focus-visible:outline-3 tw:focus-visible:outline-solid tw:focus-visible:outline-[#91b88e] tw:focus-visible:outline-offset-2 tw:disabled:cursor-not-allowed tw:disabled:opacity-50 tw:[&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        'tw:mt-5 tw:min-w-0 tw:outline-none tw:data-[state=inactive]:hidden',
        className,
      )}
      {...props}
    />
  );
}
