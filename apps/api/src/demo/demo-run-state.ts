import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DateTime } from 'luxon';
import type { DataSource } from 'typeorm';
import { readIntegrationConfig, type AppConfig } from '../config/environment';
import { createDataSource } from '../database/data-source';
import { localToUtc } from '../planning/planning-time';
import {
  DEMO_MAGIC,
  type DemoManifest,
  type DemoOwner,
  type DemoRunState,
  type DemoTarget,
} from './demo-types';

export function demoRunId(value: string): string {
  if (!/^[a-z][a-z0-9_-]{3,39}$/.test(value))
    throw new Error('Use a 4–40 character lowercase demo run ID.');
  return value;
}
export const newDemoRunId = () =>
  'demo-' +
  new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).toLowerCase() +
  '-' +
  randomUUID().slice(0, 8);
export const demoSchema = (runId: string) =>
  'fd_demo_' +
  demoRunId(runId).replaceAll('-', '_') +
  '_' +
  createHash('sha256').update(runId).digest('hex').slice(0, 8);
export const workspaceHash = (root: string) => createHash('sha256').update(root).digest('hex');
export const hashBytes = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function demoTargetConfig(env: NodeJS.ProcessEnv): AppConfig {
  if (env.NODE_ENV === 'production') throw new Error('Demo commands refuse production mode.');
  const config = readIntegrationConfig({ ...env, NODE_ENV: 'test' });
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.database.host))
    throw new Error('The demo target must be the explicit local TEST_DATABASE target.');
  return config;
}
export function assertDemoTarget(config: AppConfig): void {
  if (
    config.nodeEnv !== 'test' ||
    !config.database.name.endsWith('_test') ||
    !['127.0.0.1', 'localhost', '::1'].includes(config.database.host) ||
    !config.database.password
  )
    throw new Error('Demo writes require an explicit isolated local test database.');
}
export const targetIdentity = (config: AppConfig): DemoTarget => ({
  host: config.database.host,
  port: config.database.port,
  name: config.database.name,
  user: config.database.user,
});
export function demoPaths(root: string, runId: string) {
  const directory = join(root, '.demo-runs', demoRunId(runId));
  return {
    directory,
    state: join(directory, 'state.json'),
    manifest: join(directory, 'manifest.json'),
    credentials: join(directory, 'credentials.local.json'),
    storage: join(directory, 'storage'),
    storageOwner: join(directory, 'storage', '.demo-owner.json'),
    log: join(directory, 'application.log'),
    originalNextEnv: join(directory, 'next-env.original'),
  };
}
export async function privateDirectory(path: string, create = false): Promise<void> {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    (await realpath(path)) !== resolve(path)
  )
    throw new Error('Demo directories must be private canonical directories without symlinks.');
  if (process.getuid && info.uid !== process.getuid())
    throw new Error('The demo directory belongs to another operating-system user.');
}
export async function readPrivateJson<T>(path: string): Promise<T> {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    info.size > 2 * 1024 * 1024
  )
    throw new Error('The demo state file is not a bounded private regular file.');
  if (process.getuid && info.uid !== process.getuid())
    throw new Error('The demo state file belongs to another operating-system user.');
  return JSON.parse(await readFile(path, 'utf8')) as T;
}
export async function writePrivateJson(
  path: string,
  value: unknown,
  initial = false,
): Promise<void> {
  await privateDirectory(resolve(path, '..'));
  if (initial) {
    await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return;
  }
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new Error('Refusing to replace an unowned demo state file.');
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
export function assertOwner(owner: DemoOwner, expected: DemoOwner): void {
  if (
    !owner ||
    owner.magic !== DEMO_MAGIC ||
    owner.runId !== expected.runId ||
    owner.ownerId !== expected.ownerId ||
    owner.workspaceHash !== expected.workspaceHash
  )
    throw new Error('Demo resource ownership does not match this run.');
}
export async function loadDemoState(
  root: string,
  runId: string,
  config: AppConfig,
): Promise<DemoRunState> {
  assertDemoTarget(config);
  const paths = demoPaths(root, runId);
  await privateDirectory(join(root, '.demo-runs'));
  await privateDirectory(paths.directory);
  const state = await readPrivateJson<DemoRunState>(paths.state);
  if (
    state.version !== 1 ||
    state.schema !== demoSchema(runId) ||
    !state.owner ||
    state.owner.magic !== DEMO_MAGIC ||
    state.owner.runId !== runId ||
    state.owner.workspaceHash !== workspaceHash(root) ||
    !/^[a-f0-9-]{36}$/.test(state.owner.ownerId) ||
    JSON.stringify(state.target) !== JSON.stringify(targetIdentity(config))
  )
    throw new Error('Demo state, target or workspace ownership is inconsistent.');
  localToUtc(state.baseDate + 'T00:00');
  await privateDirectory(paths.storage);
  assertOwner(await readPrivateJson<DemoOwner>(paths.storageOwner), state.owner);
  return state;
}
export function newBaseDate(input?: string): string {
  const now = DateTime.now().setZone('Europe/Rome'),
    today = now.toISODate()!;
  const date = input ?? today;
  localToUtc(date + 'T00:00');
  if (date !== today)
    throw new Error(
      'A new demo run must use today in Europe/Rome; repeat an old run to preserve its historical dates.',
    );
  if (now.hour === 0 && now.minute < 2)
    throw new Error(
      'Prepare this synthetic delay demo after 00:02 Europe/Rome; no fake actual timestamps are inserted.',
    );
  return date;
}
export function runConfig(config: AppConfig, state: DemoRunState, root: string): AppConfig {
  assertDemoTarget(config);
  return {
    ...config,
    nodeEnv: 'test',
    apiHost: '127.0.0.1',
    apiPort: 3001,
    auth: { ...config.auth, webOrigin: 'http://127.0.0.1:3000', cookieSecure: false },
    database: { ...config.database, schema: state.schema },
    storage: { ...config.storage, root: demoPaths(root, state.owner.runId).storage },
  };
}
export async function schemaOwner(source: DataSource, schema: string): Promise<DemoOwner | null> {
  const rows = (await source.query(
    "SELECT obj_description(oid,'pg_namespace') AS owner FROM pg_namespace WHERE nspname=$1",
    [schema],
  )) as { owner: string | null }[];
  if (!rows.length) return null;
  try {
    return JSON.parse(rows[0]!.owner ?? '') as DemoOwner;
  } catch {
    throw new Error('The target schema has no matching demo owner marker.');
  }
}
export async function verifyDemoSchema(config: AppConfig, state: DemoRunState): Promise<void> {
  assertDemoTarget(config);
  const source = createDataSource(config);
  try {
    await source.initialize();
    const owner = await schemaOwner(source, state.schema);
    if (!owner) throw new Error('The demo schema is missing.');
    assertOwner(owner, state.owner);
  } finally {
    if (source.isInitialized) await source.destroy();
  }
}
export async function readDemoManifest(root: string, state: DemoRunState): Promise<DemoManifest> {
  const manifest = await readPrivateJson<DemoManifest>(demoPaths(root, state.owner.runId).manifest);
  if (
    manifest.version !== 1 ||
    manifest.synthetic !== true ||
    manifest.runId !== state.owner.runId ||
    manifest.baseDate !== state.baseDate ||
    manifest.counts?.orders !== 40 ||
    manifest.orders?.length !== 40
  )
    throw new Error('The prepared demo manifest is incomplete.');
  return manifest;
}
