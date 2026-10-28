import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createApplication } from '../application';
import { createDataSource } from '../database/data-source';
import { DatabaseService } from '../database/database.service';
import type { AppConfig } from '../config/environment';
import { DEMO_MAGIC, type DemoManifest, type DemoOwner, type DemoRunState } from './demo-types';
import {
  assertDemoTarget,
  assertOwner,
  demoPaths,
  demoRunId,
  demoSchema,
  loadDemoState,
  newBaseDate,
  privateDirectory,
  readDemoManifest,
  readPrivateJson,
  runConfig,
  schemaOwner,
  targetIdentity,
  verifyDemoSchema,
  workspaceHash,
  writePrivateJson,
} from './demo-run-state';
import { buildDemoScenarios } from './demo-scenarios';

export async function prepareDemo(
  rootInput: string,
  runInput: string,
  config: AppConfig,
  baseDate?: string,
): Promise<{ manifest: DemoManifest; repeated: boolean }> {
  assertDemoTarget(config);
  const root = await realpath(rootInput),
    runId = demoRunId(runInput),
    paths = demoPaths(root, runId);
  try {
    await lstat(paths.directory);
    const state = await loadDemoState(root, runId, config);
    if (!['PREPARED', 'STOPPED', 'RUNNING'].includes(state.status))
      throw new Error(
        'A partial demo run is not resumed. Explicitly stop/clean up this owned run or choose a new run ID.',
      );
    if (baseDate !== undefined && baseDate !== state.baseDate)
      throw new Error('Repeat cannot change the original demo base date.');
    await verifyDemoSchema(config, state);
    await readPrivateJson(paths.credentials);
    return { manifest: await readDemoManifest(root, state), repeated: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const chosenDate = newBaseDate(baseDate);
  await privateDirectory(join(root, '.demo-runs'), true);
  await mkdir(paths.directory, { mode: 0o700 });
  await privateDirectory(paths.directory);
  const owner: DemoOwner = {
    magic: DEMO_MAGIC,
    runId,
    ownerId: randomUUID(),
    workspaceHash: workspaceHash(root),
  };
  await privateDirectory(paths.storage, true);
  await writePrivateJson(paths.storageOwner, owner, true);
  const state: DemoRunState = {
    version: 1,
    owner,
    target: targetIdentity(config),
    baseDate: chosenDate,
    schema: demoSchema(runId),
    createdAt: new Date().toISOString(),
    status: 'PREPARING',
  };
  await writePrivateJson(paths.state, state, true);
  const admin = createDataSource(config),
    runner = admin.createQueryRunner();
  let app: Awaited<ReturnType<typeof createApplication>> | undefined,
    locked = false;
  try {
    await admin.initialize();
    await runner.connect();
    const lock = (await runner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [
      'fd-demo:' + state.schema,
    ])) as { locked: boolean }[];
    locked = !!lock[0]?.locked;
    if (!locked) throw new Error('This demo run is already being prepared or cleaned up.');
    if (await schemaOwner(admin, state.schema))
      throw new Error('The target schema already exists; no existing schema is adopted.');
    // run IDs/UUIDs/hashes contain no SQL quote; schema identifier is generated and bounded above.
    await runner.startTransaction();
    await runner.query(`CREATE SCHEMA "${state.schema}"`);
    await runner.query(`COMMENT ON SCHEMA "${state.schema}" IS '${JSON.stringify(owner)}'`);
    await runner.commitTransaction();
    app = await createApplication(runConfig(config, state, root));
    const source = await app.get(DatabaseService).getDataSource();
    await source.runMigrations();
    const prepared = await buildDemoScenarios(app, state);
    await writePrivateJson(
      paths.credentials,
      { version: 1, synthetic: true, runId, accounts: prepared.credentials },
      true,
    );
    await writePrivateJson(paths.manifest, prepared.manifest, true);
    state.status = 'PREPARED';
    await writePrivateJson(paths.state, state);
    return { manifest: prepared.manifest, repeated: false };
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    state.status = 'FAILED';
    await writePrivateJson(paths.state, state);
    throw error;
  } finally {
    await app?.close();
    if (locked)
      await runner
        .query('SELECT pg_advisory_unlock(hashtext($1))', ['fd-demo:' + state.schema])
        .catch(() => undefined);
    if (!runner.isReleased) await runner.release();
    if (admin.isInitialized) await admin.destroy();
  }
}

export async function cleanupDemoSchema(
  root: string,
  state: DemoRunState,
  config: AppConfig,
): Promise<void> {
  assertDemoTarget(config);
  if (
    state.schema !== demoSchema(state.owner.runId) ||
    state.owner.workspaceHash !== workspaceHash(root) ||
    JSON.stringify(state.target) !== JSON.stringify(targetIdentity(config))
  )
    throw new Error('Refusing cleanup outside the exact owned demo target.');
  const paths = demoPaths(root, state.owner.runId);
  await privateDirectory(paths.directory);
  await privateDirectory(paths.storage);
  assertOwner(await readPrivateJson<DemoOwner>(paths.storageOwner), state.owner);
  const source = createDataSource(config);
  await source.initialize();
  const runner = source.createQueryRunner();
  let locked = false;
  try {
    await runner.connect();
    const rows = (await runner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [
      'fd-demo:' + state.schema,
    ])) as { locked: boolean }[];
    locked = !!rows[0]?.locked;
    if (!locked)
      throw new Error('The owned demo run is still active in another prepare/cleanup process.');
    const owner = await schemaOwner(source, state.schema);
    if (owner) {
      assertOwner(owner, state.owner);
      await runner.query(`DROP SCHEMA "${state.schema}" CASCADE`);
    }
    // Missing schema is allowed only after the owned state/storage checks; this also handles a failed preparation.
  } finally {
    if (locked)
      await runner
        .query('SELECT pg_advisory_unlock(hashtext($1))', ['fd-demo:' + state.schema])
        .catch(() => undefined);
    if (!runner.isReleased) await runner.release();
    if (source.isInitialized) await source.destroy();
  }
}
