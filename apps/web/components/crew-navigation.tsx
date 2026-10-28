'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardList, UsersRound } from 'lucide-react';
import { cn } from '../lib/utils';
export function CrewNavigation() {
  const path = usePathname() ?? '/crew';
  const team = path === '/crew/team' || path.startsWith('/crew/team/');
  return (
    <nav className="crew-shell-nav" aria-label="Team navigation">
      <div className="crew-shell-nav-inner">
        {[
          { href: '/crew', label: 'My work', icon: ClipboardList, current: !team },
          { href: '/crew/team', label: 'My team', icon: UsersRound, current: team },
        ].map(({ href, label, icon: Icon, current }) => (
          <Link
            key={href}
            href={href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'tw:flex tw:min-h-12 tw:items-center tw:justify-center tw:gap-2 tw:rounded-xl tw:border tw:border-solid tw:px-5 tw:py-3 tw:text-xs tw:font-semibold tw:no-underline tw:focus-visible:outline-3 tw:focus-visible:outline-solid tw:focus-visible:outline-[#91b88e] tw:focus-visible:outline-offset-2',
              current
                ? 'tw:border-[#d3e0c7] tw:bg-[#edf4e4] tw:text-[#416744]'
                : 'tw:border-transparent tw:bg-transparent tw:text-[#71806a] tw:hover:bg-[#f4f7ee]',
            )}
          >
            <Icon size={17} strokeWidth={1.75} className="tw:shrink-0" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
