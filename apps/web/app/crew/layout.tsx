import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Activity, UserRound } from 'lucide-react';
import { CrewNavigation } from '../../components/crew-navigation';
import { buttonVariants } from '../../components/ui/button';
import '../../components/crew-shell.css';
import { LogoutButton } from '../../components/logout-button';
import { SessionProvider } from '../../components/session-provider';
import { SessionUnavailable } from '../../components/session-unavailable';
import { loadSession } from '../../lib/server-session';

export default async function CrewLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await loadSession();
  if (session.kind === 'anonymous') redirect('/login');
  if (session.kind === 'unavailable') return <SessionUnavailable />;
  if (session.user.role !== 'CREW_MEMBER') redirect('/backoffice');
  return (
    <SessionProvider user={session.user}>
      <div className="crew-mobile-shell">
        <header className="crew-shell-header">
          <Link className="crew-shell-brand" href="/crew" aria-label="Furniture Delivery · My work">
            <span className="crew-shell-mark" aria-hidden="true">
              fd.
            </span>
            <span>
              My work<small>Delivery & assembly</small>
            </span>
          </Link>
          <div className="crew-shell-account">
            <div className="crew-shell-identity">
              <UserRound size={19} strokeWidth={1.75} aria-hidden="true" />
              <span>
                {session.user.displayName}
                <small>Team member</small>
              </span>
            </div>
            <LogoutButton className={buttonVariants({ variant: 'outline', size: 'sm' })} />
          </div>
        </header>
        <CrewNavigation />
        <main className="crew-shell-content">{children}</main>
        <footer className="crew-shell-footer">
          <Link href="/">
            <Activity size={14} aria-hidden="true" />
            Service status
          </Link>
        </footer>
      </div>
    </SessionProvider>
  );
}
