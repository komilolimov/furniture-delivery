import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { DatabaseService } from '../src/database/database.service';
import { assertSeedAllowed, demoCrews } from '../src/database/demo-crews';
import { HealthService } from '../src/health/health.service';

describe('health service', () => {
  it('reports database availability and the time after a successful check', async () => {
    const checkConnection = vi.fn().mockResolvedValue(undefined);
    const service = new HealthService({ checkConnection } as unknown as DatabaseService);
    const result = await service.check();
    expect(result).toMatchObject({ status: 'ok', api: 'up', database: 'up' });
    expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
    expect(checkConnection).toHaveBeenCalledOnce();
  });

  it('returns only the public contract on connection failure', async () => {
    const checkConnection = vi.fn().mockRejectedValue(new Error('secret-connection-details'));
    const service = new HealthService({ checkConnection } as unknown as DatabaseService);
    const result = await service.check();
    expect(result).toEqual({
      status: 'error',
      api: 'up',
      database: 'down',
      checkedAt: expect.any(String),
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});

describe('lazy database connection', () => {
  it('shares a concurrent initialization, executes SELECT 1 and retries failed initialization', async () => {
    let finishInitialization!: () => void;
    const source = {
      isInitialized: false,
      initialize: vi.fn(),
      query: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    source.initialize.mockRejectedValueOnce(new Error('unavailable'));
    source.initialize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishInitialization = () => {
            source.isInitialized = true;
            resolve(source);
          };
        }),
    );
    const service = new DatabaseService(source as unknown as DataSource);
    await expect(service.checkConnection()).rejects.toThrow('unavailable');
    const first = service.checkConnection();
    const second = service.checkConnection();
    expect(source.initialize).toHaveBeenCalledTimes(2);
    finishInitialization();
    await Promise.all([first, second]);
    expect(source.query).toHaveBeenCalledTimes(2);
    expect(source.query).toHaveBeenCalledWith('SELECT 1');
    await service.onApplicationShutdown();
    expect(source.destroy).toHaveBeenCalledOnce();
  });
});

describe('demo seed safety', () => {
  it('has ten unique stable demo codes and refuses production', () => {
    expect(demoCrews).toHaveLength(10);
    expect(new Set(demoCrews.map(({ code }) => code)).size).toBe(10);
    expect(() => assertSeedAllowed('production')).toThrow();
    expect(() => assertSeedAllowed('development')).not.toThrow();
    expect(() => assertSeedAllowed('test')).not.toThrow();
  });
});
