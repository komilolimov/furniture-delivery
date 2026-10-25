import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
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
      <div className="workspace crew-workspace">
        <header className="workspace-header">
          <Link className="wordmark" href="/crew">
            <span className="brand-mark" aria-hidden="true">
              fd.
            </span>
            My team
          </Link>
          <div className="user-menu">
            <span>
              {session.user.displayName}
              <small>Team member</small>
            </span>
            <LogoutButton />
          </div>
        </header>
        <main className="workspace-content">{children}</main>
        <footer className="crew-footer">
          <Link href="/">Service status</Link>
        </footer>
      </div>
    </SessionProvider>
  );
}
