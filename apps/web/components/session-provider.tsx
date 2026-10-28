'use client';

import type { AuthUser } from '@furniture-delivery/contracts';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { authScope, RealtimeCoordinator } from '../lib/realtime-coordinator';
import { RealtimeContext } from '../lib/realtime-context';
import { homeForRole } from '../lib/session';
import { LiveStatus } from './live-status';

const SessionContext = createContext<AuthUser | null>(null);

function SessionScope({ user, children }: Readonly<{ user: AuthUser; children: ReactNode }>) {
  const router = useRouter(),
    currentRouter = useRef(router);
  currentRouter.current = router;
  const [sessionUser, setUser] = useState(user),
    [blocked, setBlocked] = useState(false),
    [scopeGeneration, setGeneration] = useState(0);
  const reset = useRef(false);
  const [coordinator] = useState(
    () =>
      new RealtimeCoordinator({
        initialUser: user,
        onAccessReset: () => {
          reset.current = true;
          setBlocked(true);
          setGeneration((value) => value + 1);
        },
        onExpired: () => {
          setBlocked(true);
          setGeneration((value) => value + 1);
          currentRouter.current.replace('/login');
          currentRouter.current.refresh();
        },
        onSession: (fresh) => {
          if (authScope(fresh) !== authScope(user)) {
            setBlocked(true);
            currentRouter.current.replace(homeForRole(fresh.role));
            currentRouter.current.refresh();
            return false;
          }
          setUser(fresh);
          setBlocked(false);
          if (reset.current) {
            reset.current = false;
            currentRouter.current.refresh();
          }
        },
      }),
  );
  useEffect(() => {
    const onExpired = () => coordinator.expire();
    const onPermissionsChanged = () => coordinator.accessReset();
    window.addEventListener('fd:session-expired', onExpired);
    window.addEventListener('fd:permissions-changed', onPermissionsChanged);
    coordinator.start();
    return () => {
      coordinator.stop();
      window.removeEventListener('fd:session-expired', onExpired);
      window.removeEventListener('fd:permissions-changed', onPermissionsChanged);
    };
  }, [coordinator]);
  return (
    <SessionContext.Provider value={sessionUser}>
      <RealtimeContext.Provider value={coordinator}>
        <LiveStatus />
        {blocked ? (
          <p role="status">Checking current access…</p>
        ) : (
          <div key={scopeGeneration} className="session-scope">
            {children}
          </div>
        )}
      </RealtimeContext.Provider>
    </SessionContext.Provider>
  );
}

export function SessionProvider(props: Readonly<{ user: AuthUser; children: ReactNode }>) {
  return <SessionScope key={authScope(props.user)} {...props} />;
}

export function useCurrentUser(): AuthUser {
  const user = useContext(SessionContext);
  if (!user) throw new Error('SessionProvider is required for this page.');
  return user;
}
