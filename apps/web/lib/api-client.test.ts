import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './api-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authenticated API client', () => {
  it('sends cookies with same-origin requests and a CSRF header for mutations', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: 'Done' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await apiRequest('/auth/login', {
      method: 'POST',
      body: { username: 'worker', password: 'test-only-value' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Protection': '1',
        },
        body: JSON.stringify({ username: 'worker', password: 'test-only-value' }),
      }),
    );
  });

  it('does not attach a mutation header or body to reads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ users: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await apiRequest('/users');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/users',
      expect.objectContaining({ method: 'GET', headers: { Accept: 'application/json' } }),
    );
  });

  it('announces an expired session on authenticated HTTP 401 responses', async () => {
    const expired = vi.fn();
    window.addEventListener('fd:session-expired', expired);
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
      await expect(apiRequest('/crews')).rejects.toMatchObject({ status: 401 });
      expect(expired).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('fd:session-expired', expired);
    }
  });

  it('keeps invalid login on the form rather than announcing an expired session', async () => {
    const expired = vi.fn();
    window.addEventListener('fd:session-expired', expired);
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
      await expect(apiRequest('/auth/login', { method: 'POST' })).rejects.toMatchObject({
        status: 401,
      });
      expect(expired).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('fd:session-expired', expired);
    }
  });

  it('reports denied access and never treats HTTP 403 as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
    await expect(apiRequest('/users')).rejects.toMatchObject({
      status: 403,
      message: 'You do not have permission to perform this action.',
    });
  });

  it('checks the runtime response contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(
      apiRequest('/crews', {
        validate: (value): value is { crews: unknown[] } =>
          typeof value === 'object' && value !== null && 'crews' in value,
      }),
    ).rejects.toThrow('invalid response');
  });

  it('reports network failures without exposing raw internal messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private diagnostic')));
    await expect(apiRequest('/crews')).rejects.toThrow('The service could not be reached');
  });
});
