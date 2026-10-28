'use client';

import type { AuthUser } from '@furniture-delivery/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../lib/utils';

const destinations = [
  { href: '/backoffice', label: 'Dashboard' },
  { href: '/backoffice/orders', label: 'Orders' },
  { href: '/backoffice/planning', label: 'Planning' },
  { href: '/backoffice/issues', label: 'Issues' },
  { href: '/backoffice/return-requests', label: 'Return visits' },
  { href: '/backoffice/crews', label: 'Teams' },
  { href: '/backoffice/task-templates', label: 'Task templates' },
  { href: '/backoffice/accounts', label: 'Accounts' },
  { href: '/', label: 'Service status' },
] as const;

export function BackofficeNavigation({
  role,
  className,
}: Readonly<{ role: AuthUser['role']; className?: string }>) {
  const pathname = usePathname();
  if (role === 'CREW_MEMBER') return null;

  return (
    <nav
      aria-label="Backoffice"
      className={cn('tw:flex tw:min-w-0 tw:flex-wrap tw:gap-1', className)}
    >
      {destinations
        .filter(({ href }) => href !== '/backoffice/accounts' || role === 'ADMIN')
        .map(({ href, label }) => {
          const current =
            pathname === href ||
            (href !== '/' && href !== '/backoffice' && pathname?.startsWith(`${href}/`));
          return (
            <Link
              key={href}
              href={href}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'tw:inline-flex tw:min-h-11 tw:items-center tw:gap-2 tw:rounded-[10px] tw:border tw:border-solid tw:px-3 tw:py-2 tw:text-xs tw:no-underline tw:transition-colors tw:focus-visible:outline-3 tw:focus-visible:outline-solid tw:focus-visible:outline-[#91b88e] tw:focus-visible:outline-offset-2 tw:motion-reduce:transition-none',
                current
                  ? 'tw:border-[#cbdcc2] tw:bg-[#edf4e4] tw:font-semibold tw:text-[#294d36]'
                  : 'tw:border-transparent tw:font-medium tw:text-[#65716a] tw:hover:bg-[#f3f6ef] tw:hover:text-[#18372e]',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'tw:size-1.5 tw:shrink-0 tw:rounded-full',
                  current ? 'tw:bg-[#416744]' : 'tw:bg-transparent',
                )}
              />
              {label}
            </Link>
          );
        })}
    </nav>
  );
}
