import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, stat, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readIntegrationConfig, type AppConfig } from '../src/config/environment';
import { createDataSource } from '../src/database/data-source';
import { cleanupDemo } from '../src/demo/demo-lifecycle';
import { DEMO_MAGIC, type DemoRunState } from '../src/demo/demo-types';
import {
  demoPaths,
  demoSchema,
  privateDirectory,
  targetIdentity,
  workspaceHash,
  writePrivateJson,
} from '../src/demo/demo-run-state';

describe('M8 demo cleanup guards on an isolated test database without a large prepare fixture', () => {
  const runId = 'demo-guard-' + randomUUID().slice(0, 8),
    schema = demoSchema(runId),
    sibling = 'qa_demo_neighbor_' + randomUUID().replaceAll('-', '');
  let source: DataSource, root: string, config: AppConfig, state: DemoRunState;
  beforeAll(async () => {
    config = readIntegrationConfig();
    source = createDataSource(config);
    await source.initialize();
    root = await realpath(await mkdtemp(join(tmpdir(), 'fd_demo_owner_')));
    const paths = demoPaths(root, runId);
    await privateDirectory(join(root, '.demo-runs'), true);
    await privateDirectory(paths.directory, true);
    await privateDirectory(paths.storage, true);
    state = {
      version: 1,
      owner: {
        magic: DEMO_MAGIC,
        runId,
        ownerId: randomUUID(),
        workspaceHash: workspaceHash(root),
      },
      target: targetIdentity(config),
      baseDate: '2030-01-07',
      schema,
      createdAt: new Date().toISOString(),
      status: 'FAILED',
    };
    await writePrivateJson(paths.state, state, true);
    await writePrivateJson(paths.storageOwner, state.owner, true);
    await source.query(`CREATE SCHEMA "${schema}"`);
    await source.query(`CREATE TABLE "${schema}".sentinel(id integer PRIMARY KEY)`);
    await source.query(`INSERT INTO "${schema}".sentinel VALUES(1)`);
    await source.query(`CREATE SCHEMA "${sibling}"`);
    await source.query(`CREATE TABLE "${sibling}".sentinel(id integer PRIMARY KEY)`);
    await source.query(`INSERT INTO "${sibling}".sentinel VALUES(1)`);
    await source.query(
      `COMMENT ON SCHEMA "${schema}" IS '${JSON.stringify({ ...state.owner, ownerId: randomUUID() })}'`,
    );
  });
  afterAll(async () => {
    if (source?.isInitialized) {
      for (const created of [schema, sibling]) {
        if (!/^(?:fd_demo_demo_guard_[a-f0-9_]+|qa_demo_neighbor_[a-f0-9]+)$/.test(created))
          throw new Error('Unsafe isolated fixture schema cleanup.');
        await source.query(`DROP SCHEMA IF EXISTS "${created}" CASCADE`);
      }
      await source.destroy();
    }
    if (root) {
      if (!root.includes('fd_demo_owner_')) throw new Error('Unsafe fixture directory cleanup.');
      await rm(root, { recursive: true, force: true });
    }
  });
  it('refuses a matching schema name with another owner marker and preserves its rows and private files', async () => {
    await expect(cleanupDemo(root, runId, config)).rejects.toThrow(/ownership/);
    expect(await source.query(`SELECT id FROM "${schema}".sentinel`)).toEqual([{ id: 1 }]);
    await access(demoPaths(root, runId).state);
    expect((await stat(demoPaths(root, runId).state)).mode & 0o077).toBe(0);
  });
  it('refuses changed target identity before connecting to or deleting another database', async () => {
    await expect(
      cleanupDemo(root, runId, {
        ...config,
        database: { ...config.database, name: 'another_isolated_test' },
      }),
    ).rejects.toThrow();
    expect(await source.query(`SELECT id FROM "${schema}".sentinel`)).toEqual([{ id: 1 }]);
    expect(await source.query(`SELECT id FROM "${sibling}".sentinel`)).toEqual([{ id: 1 }]);
  });
  it('cleans only its exact matched schema/storage and preserves the neighboring fixture', async () => {
    await source.query(`COMMENT ON SCHEMA "${schema}" IS '${JSON.stringify(state.owner)}'`);
    await cleanupDemo(root, runId, config);
    expect(
      await source.query('SELECT nspname FROM pg_namespace WHERE nspname=$1', [schema]),
    ).toEqual([]);
    expect(await source.query(`SELECT id FROM "${sibling}".sentinel`)).toEqual([{ id: 1 }]);
    await expect(access(demoPaths(root, runId).directory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
