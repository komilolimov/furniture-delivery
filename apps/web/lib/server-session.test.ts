import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSession } from './server-session';

const cookieGetter = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({ cookies: async () => ({ get: cookieGetter }) }));
const user = {
  id: 'user-1',
  username: 'worker',
  displayName: 'Worker',
  role: 'CREW_MEMBER',
  active: true,
  crewIds: ['crew-1'],
};

beforeEach(() => {
  cookieGetter.mockReset();
  vi.stubEnv('API_ORIGIN', 'http://127.0.0.1:3001');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('server session verification', () => {
  it('does not open a protected session without an incoming cookie', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    cookieGetter.mockReturnValue(undefined);
    await expect(loadSession()).resolves.toEqual({ kind: 'anonymous' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards only the session cookie to the API and never caches permissions', async () => {
    cookieGetter.mockReturnValue({ value: 'test-session-cookie' });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ user }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadSession()).resolves.toEqual({ kind: 'authenticated', user });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:3001/api/auth/me'),
      expect.objectContaining({
        headers: { Cookie: 'fd_session=test-session-cookie' },
        cache: 'no-store',
      }),
    );
  });

  it('treats revoked cookies as anonymous', async () => {
    cookieGetter.mockReturnValue({ value: 'revoked-cookie' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(loadSession()).resolves.toEqual({ kind: 'anonymous' });
  });

  it('distinguishes unavailable API verification from a valid session', async () => {
    cookieGetter.mockReturnValue({ value: 'test-session-cookie' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unavailable')));
    await expect(loadSession()).resolves.toEqual({ kind: 'unavailable' });
  });
});
