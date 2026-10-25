import type { AuthUser } from '@furniture-delivery/contracts';
import { cookies } from 'next/headers';
import { isAuthResponse } from './session';

type SessionResult =
  | { kind: 'authenticated'; user: AuthUser }
  | { kind: 'anonymous' }
  | { kind: 'unavailable' };

export async function loadSession(): Promise<SessionResult> {
  const sessionCookie = (await cookies()).get('fd_session');
  if (!sessionCookie) return { kind: 'anonymous' };

  try {
    const response = await fetch(
      new URL('/api/auth/me', process.env.API_ORIGIN ?? 'http://127.0.0.1:3001'),
      {
        headers: { Cookie: `fd_session=${encodeURIComponent(sessionCookie.value)}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(6_000),
      },
    );
    if (response.status === 401 || response.status === 403) return { kind: 'anonymous' };
    const body: unknown = await response.json();
    if (!response.ok || !isAuthResponse(body)) return { kind: 'unavailable' };
    return { kind: 'authenticated', user: body.user };
  } catch {
    return { kind: 'unavailable' };
  }
}
