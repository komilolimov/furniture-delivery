'use client';

import type { AuthUser } from '@furniture-delivery/contracts';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

const SessionContext = createContext<AuthUser | null>(null);

export function SessionProvider({
  user,
  children,
}: Readonly<{ user: AuthUser; children: ReactNode }>) {
  const router = useRouter();
  useEffect(() => {
    const onExpired = () => {
      router.replace('/login');
      router.refresh();
    };
    const onPermissionsChanged = () => router.refresh();
    window.addEventListener('fd:session-expired', onExpired);
    window.addEventListener('fd:permissions-changed', onPermissionsChanged);
    return () => {
      window.removeEventListener('fd:session-expired', onExpired);
      window.removeEventListener('fd:permissions-changed', onPermissionsChanged);
    };
  }, [router]);
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;
}

export function useCurrentUser(): AuthUser {
  const user = useContext(SessionContext);
  if (!user) throw new Error('SessionProvider is required for this page.');
  return user;
}
