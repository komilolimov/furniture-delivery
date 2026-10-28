import { mkdtemp, realpath, rm, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoArguments } from '../src/demo/cli';
import { DEMO_MAGIC, type DemoRunState } from '../src/demo/demo-types';
import {
  demoPaths,
  demoRunId,
  demoSchema,
  demoTargetConfig,
  loadDemoState,
  newBaseDate,
  privateDirectory,
  targetIdentity,
  workspaceHash,
  writePrivateJson,
} from '../src/demo/demo-run-state';
import { sameDemoProcess } from '../src/demo/demo-lifecycle';

const environment = () => ({
  NODE_ENV: 'test',
  DATABASE_NAME: 'furniture_delivery',
  TEST_DATABASE_HOST: '127.0.0.1',
  TEST_DATABASE_PORT: '5433',
  TEST_DATABASE_NAME: 'furniture_delivery_test',
  TEST_DATABASE_USER: 'fixture',
  TEST_DATABASE_PASSWORD: 'fixture-only-not-a-working-secret',
});
describe('M8 explicit isolated demo target and ownership boundaries', () => {
  const owned: string[] = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const path of owned.splice(0)) {
      if (!path.includes('fd_demo_guard_')) throw new Error('Unsafe test directory cleanup.');
      await rm(path, { recursive: true, force: true });
    }
  });
  it('requires all explicit test settings, refuses production/development fallback and remote targets', () => {
    expect(demoTargetConfig(environment()).nodeEnv).toBe('test');
    for (const change of [
      { NODE_ENV: 'production' },
      { TEST_DATABASE_HOST: undefined },
      { TEST_DATABASE_PASSWORD: undefined },
      { TEST_DATABASE_NAME: 'furniture_delivery' },
      { TEST_DATABASE_NAME: 'other' },
      { TEST_DATABASE_HOST: 'remote.example.invalid' },
      { TEST_DATABASE_PORT: 'invalid' },
    ])
      expect(() => demoTargetConfig({ ...environment(), ...change })).toThrow();
  });
  it('bounds run IDs and keeps distinct slugs in distinct schema namespaces', () => {
    for (const id of ['../outside', 'A-user', 'x', 'a'.repeat(41), 'demo/foreign', 'demo;drop'])
      expect(() => demoRunId(id)).toThrow();
    expect(demoSchema('demo-one')).not.toBe(demoSchema('demo_one'));
    expect(demoSchema('demo-one').length).toBeLessThanOrEqual(63);
    expect(demoArguments(['prepare', '--run', 'demo-test', '--base-date', '2030-01-07'])).toEqual({
      action: 'prepare',
      runId: 'demo-test',
      baseDate: '2030-01-07',
    });
    for (const args of [
      ['cleanup'],
      ['start', '--run', 'demo-test', '--base-date', '2030-01-07'],
      ['prepare', '--run', 'demo-test', '--run', 'demo-test'],
      ['prepare', '--unknown', 'value'],
    ])
      expect(() => demoArguments(args)).toThrow();
  });
  it('uses Rome Today for new actual workflows and honestly rejects the first two local minutes', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-07T08:00:00Z'));
    expect(newBaseDate()).toBe('2030-01-07');
    expect(() => newBaseDate('2030-01-06')).toThrow();
    vi.setSystemTime(new Date('2030-01-06T23:01:00Z'));
    expect(() => newBaseDate()).toThrow(/00:02/);
  });
  it('accepts private markers only for the exact workspace/run/target and rejects storage symlinks', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'fd_demo_guard_')));
    owned.push(root);
    const config = demoTargetConfig(environment()),
      runId = 'demo-guard',
      paths = demoPaths(root, runId);
    await privateDirectory(join(root, '.demo-runs'), true);
    await privateDirectory(paths.directory, true);
    await privateDirectory(paths.storage, true);
    const state: DemoRunState = {
      version: 1,
      owner: {
        magic: DEMO_MAGIC,
        runId,
        ownerId: randomUUID(),
        workspaceHash: workspaceHash(root),
      },
      target: targetIdentity(config),
      baseDate: '2030-01-07',
      schema: demoSchema(runId),
      createdAt: new Date().toISOString(),
      status: 'FAILED',
    };
    await writePrivateJson(paths.state, state, true);
    await writePrivateJson(paths.storageOwner, state.owner, true);
    expect((await loadDemoState(root, runId, config)).schema).toBe(state.schema);
    await expect(
      loadDemoState(root, runId, {
        ...config,
        database: { ...config.database, name: 'different_test' },
      }),
    ).rejects.toThrow();
    await writePrivateJson(paths.state, { ...state, schema: 'public' });
    await expect(loadDemoState(root, runId, config)).rejects.toThrow();
    await writePrivateJson(paths.state, state);
    const other = join(root, 'other');
    await mkdir(other, { mode: 0o700 });
    await rm(paths.storage, { recursive: true });
    await symlink(other, paths.storage);
    await expect(loadDemoState(root, runId, config)).rejects.toThrow();
  });
  it('never treats PID reuse, a changed command or a foreign cwd as ownership', () => {
    const expected = {
      pid: 123,
      startTime: 'fixed start',
      command: 'node demo/cli.ts start --run demo-own',
      cwd: '/owned',
    };
    expect(sameDemoProcess({ ...expected }, expected)).toBe(true);
    for (const actual of [
      null,
      { ...expected, startTime: 'different' },
      { ...expected, command: 'node other.js' },
      { ...expected, cwd: '/foreign' },
      { ...expected, pid: 124 },
    ])
      expect(sameDemoProcess(actual, expected)).toBe(false);
  });
});
