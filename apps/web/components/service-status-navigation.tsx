import { loadSession } from '../lib/server-session';
import { BackofficeNavigation } from './backoffice-navigation';

export async function ServiceStatusNavigation() {
  const session = await loadSession();
  if (session.kind !== 'authenticated' || session.user.role === 'CREW_MEMBER') return null;
  return (
    <BackofficeNavigation
      role={session.user.role}
      className="tw:mt-4 tw:rounded-2xl tw:border tw:border-solid tw:border-[#e1e5dc] tw:bg-white tw:p-2"
    />
  );
}
