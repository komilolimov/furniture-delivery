import type { CookieOptions } from 'express';
import type { AuthConfig } from './auth.types';

export const SESSION_COOKIE = 'fd_session';

export function sessionCookieOptions(config: AuthConfig): CookieOptions {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/' };
}

export function readSessionCookie(header: string | undefined): string | undefined {
  if (!header || header.length > 8192) return undefined;
  const candidates = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (candidates.length !== 1) return undefined;
  const value = candidates[0]?.slice(SESSION_COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
