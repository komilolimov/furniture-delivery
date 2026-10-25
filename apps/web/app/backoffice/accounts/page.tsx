import { redirect } from 'next/navigation';
import { AccountsPanel } from '../../../components/accounts-panel';
import { SessionUnavailable } from '../../../components/session-unavailable';
import { loadSession } from '../../../lib/server-session';

export default async function AccountsPage() {
  const session = await loadSession();
  if (session.kind === 'anonymous') redirect('/login');
  if (session.kind === 'unavailable') return <SessionUnavailable />;
  if (session.user.role !== 'ADMIN')
    redirect(session.user.role === 'CREW_MEMBER' ? '/crew' : '/backoffice');
  return <AccountsPanel />;
}
