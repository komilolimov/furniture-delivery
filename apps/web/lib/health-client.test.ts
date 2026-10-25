import type { HealthResponse } from '@furniture-delivery/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHealth } from './health-client';

const healthy: HealthResponse = {
  status: 'ok',
  api: 'up',
  database: 'up',
  checkedAt: '2026-10-25T12:00:00.000Z',
};
const unavailable: HealthResponse = {
  status: 'error',
  api: 'up',
  database: 'down',
  checkedAt: '2026-10-25T12:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchHealth', () => {
  it('reads a real-shaped successful response without caching', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(healthy), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await expect(fetchHealth(controller.signal)).resolves.toEqual(healthy);
    expect(fetchMock).toHaveBeenCalledWith('/api/health', {
      cache: 'no-store',
      signal: controller.signal,
    });
  });

  it('retains database failure information from HTTP 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(unavailable), { status: 503 })),
    );
    await expect(fetchHealth(new AbortController().signal)).resolves.toEqual(unavailable);
  });

  it.each([
    [200, unavailable],
    [503, healthy],
    [500, healthy],
    [200, { ...healthy, checkedAt: 'invalid' }],
    [200, { ...healthy, database: 'down' }],
    [200, null],
  ])('rejects an invalid HTTP/contract combination (%s)', async (status, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })),
    );
    await expect(fetchHealth(new AbortController().signal)).rejects.toThrow(
      'unexpected health response',
    );
  });

  it('does not turn network failure into success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network request failed')));
    await expect(fetchHealth(new AbortController().signal)).rejects.toThrow(
      'Network request failed',
    );
  });
});
