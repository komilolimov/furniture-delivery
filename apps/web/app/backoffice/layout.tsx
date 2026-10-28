import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BackofficeNavigation } from '../../components/backoffice-navigation';
import { LogoutButton } from '../../components/logout-button';
import { SessionProvider } from '../../components/session-provider';
import { SessionUnavailable } from '../../components/session-unavailable';
import { loadSession } from '../../lib/server-session';

const logoutButton =
  'tw:inline-flex tw:min-h-11 tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-[7px] tw:border tw:border-solid tw:border-[#cbd4c7] tw:bg-white tw:px-[17px] tw:py-[11px] tw:text-xs tw:font-bold tw:text-[#18372e] tw:no-underline tw:enabled:hover:bg-[#f1f3ee] tw:disabled:cursor-wait tw:disabled:opacity-60 tw:focus-visible:outline-3 tw:focus-visible:outline-solid tw:focus-visible:outline-[#91b88e] tw:focus-visible:outline-offset-4 tw:max-[600px]:p-[9px] tw:max-[600px]:text-[11px]';

export default async function BackofficeLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await loadSession();
  if (session.kind === 'anonymous') redirect('/login');
  if (session.kind === 'unavailable') return <SessionUnavailable />;
  if (session.user.role === 'CREW_MEMBER') redirect('/crew');
  return (
    <SessionProvider user={session.user}>
      <div className="tw:min-h-screen">
        <header className="tw:flex tw:flex-wrap tw:items-center tw:gap-8 tw:border-x-0 tw:border-t-0 tw:border-b tw:border-solid tw:border-[#e1e5dc] tw:bg-white tw:px-[max(24px,calc((100vw_-_1120px)/2))] tw:py-[22px] tw:max-[850px]:gap-5 tw:max-[600px]:gap-4 tw:max-[600px]:px-5 tw:max-[600px]:py-[18px]">
          <Link
            className="tw:inline-flex tw:items-center tw:gap-3 tw:text-base tw:font-bold tw:tracking-[-0.3px] tw:no-underline tw:focus-visible:outline-3 tw:focus-visible:outline-solid tw:focus-visible:outline-[#91b88e] tw:focus-visible:outline-offset-4 tw:max-[600px]:flex-1 tw:max-[600px]:gap-[9px] tw:max-[600px]:text-[13px]"
            href="/backoffice"
          >
            <span
              className="tw:grid tw:size-10 tw:shrink-0 tw:place-items-center tw:rounded-[10px] tw:bg-[#18372e] tw:pr-0.5 tw:text-[22px] tw:tracking-[-2px] tw:text-white tw:max-[600px]:size-[34px] tw:max-[600px]:text-xl"
              aria-hidden="true"
            >
              fd.
            </span>
            Backoffice
          </Link>
          <BackofficeNavigation
            role={session.user.role}
            className="tw:flex-1 tw:max-[850px]:order-3 tw:max-[850px]:w-full tw:max-[850px]:basis-full"
          />
          <div className="tw:ml-auto tw:flex tw:items-center tw:gap-[18px] tw:max-[600px]:max-w-full tw:max-[600px]:gap-[10px]">
            <span className="tw:text-right tw:text-xs tw:font-bold tw:max-[600px]:max-w-[135px] tw:max-[600px]:[overflow-wrap:anywhere]">
              {session.user.displayName}
              <small className="tw:mt-[5px] tw:block tw:text-[10px] tw:font-normal tw:text-[#65716a]">
                {session.user.role === 'ADMIN' ? 'Administrator' : 'Dispatcher'}
              </small>
            </span>
            <LogoutButton className={logoutButton} />
          </div>
        </header>
        <main className="tw:mx-auto tw:mt-9 tw:mb-20 tw:w-[calc(100%_-_48px)] tw:max-w-[1120px] tw:max-[600px]:mt-6 tw:max-[600px]:w-[calc(100%_-_40px)]">
          {children}
        </main>
      </div>
    </SessionProvider>
  );
}
