import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogoutButton } from '../../components/logout-button';
import { SessionProvider } from '../../components/session-provider';
import { SessionUnavailable } from '../../components/session-unavailable';
import { loadSession } from '../../lib/server-session';

export default async function BackofficeLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await loadSession();
  if (session.kind === 'anonymous') redirect('/login');
  if (session.kind === 'unavailable') return <SessionUnavailable />;
  if (session.user.role === 'CREW_MEMBER') redirect('/crew');
  return (
    <SessionProvider user={session.user}>
      <div className="workspace backoffice-workspace">
        <header className="workspace-header">
          <Link className="wordmark" href="/backoffice">
            <span className="brand-mark" aria-hidden="true">
              fd.
            </span>
            Backoffice
          </Link>
          <nav aria-label="Backoffice">
            <Link href="/backoffice">Teams</Link>
            {session.user.role === 'ADMIN' && <Link href="/backoffice/accounts">Accounts</Link>}
            <Link href="/">Service status</Link>
          </nav>
          <div className="user-menu">
            <span>
              {session.user.displayName}
              <small>{session.user.role === 'ADMIN' ? 'Administrator' : 'Dispatcher'}</small>
            </span>
            <LogoutButton />
          </div>
        </header>
        <main className="workspace-content">{children}</main>
      </div>
    </SessionProvider>
  );
}
