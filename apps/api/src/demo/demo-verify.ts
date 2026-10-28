import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DataSource } from 'typeorm';
import { config as loadDotEnv } from 'dotenv';
import { createApplication } from '../application';
import { DatabaseService } from '../database/database.service';
import { OrdersService } from '../orders/orders.service';
import { User } from '../identity/user.entity';
import { prepareDemo } from './demo-prepare';
import {
  demoPaths,
  demoRunId,
  demoTargetConfig,
  hashBytes,
  loadDemoState,
  runConfig,
} from './demo-run-state';

async function rowsDigest(source: DataSource, schema: string): Promise<Record<string, string[]>> {
  const columns = (await source.query(
      'SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,ordinal_position',
      [schema],
    )) as { table_name: string; column_name: string }[],
    tables = new Map<string, string[]>();
  for (const column of columns) {
    if (column.table_name === 'typeorm_migrations') continue;
    const list = tables.get(column.table_name) ?? [];
    list.push(column.column_name);
    tables.set(column.table_name, list);
  }
  const result: Record<string, string[]> = {};
  for (const [table, names] of tables) {
    if (!/^[a-z_]+$/.test(table) || names.some((name) => !/^[a-z_]+$/.test(name)))
      throw new Error('Unexpected verification identifier.');
    const rows = (await source.query(
      `SELECT md5(row_to_json(t)::text) AS hash FROM (SELECT ${names.map((name) => '"' + name + '"').join(',')} FROM "${schema}"."${table}") t ORDER BY hash`,
    )) as { hash: string }[];
    result[table] = rows.map((row) => row.hash);
  }
  return result;
}
async function fileDigest(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(path: string, relative: string) {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('Verification refuses symbolic links.');
    if (info.isDirectory())
      for (const child of await readdir(path))
        await walk(join(path, child), relative ? relative + '/' + child : child);
    else if (info.isFile()) result[relative] = hashBytes(await readFile(path));
  }
  await walk(root, '');
  return result;
}
async function main(): Promise<void> {
  const root = await realpath(resolve(__dirname, '../../../..')),
    args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--run')
    throw new Error('Use one explicit new verification --run ID.');
  const runId = demoRunId(args[1]!),
    paths = demoPaths(root, runId);
  try {
    await lstat(paths.directory);
    throw new Error(
      'Standalone verification requires a new run; it never edits an existing user demo.',
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  loadDotEnv({ path: join(root, '.env'), quiet: true });
  const config = demoTargetConfig(process.env),
    prepared = await prepareDemo(root, runId, config),
    state = await loadDemoState(root, runId, config),
    app = await createApplication(runConfig(config, state, root));
  try {
    const source = await app.get(DatabaseService).getDataSource(),
      orders = app.get(OrdersService),
      dispatcher = await source
        .getRepository(User)
        .findOneByOrFail({ username: 'demo.dispatcher' }),
      selected = prepared.manifest.orders.find((ref) => ref.scenario === 'inbox')!,
      current = await orders.detail(selected.orderId);
    await orders.update(
      current.id,
      {
        expectedVersion: current.version,
        customerName: 'SYNTHETIC manual edit preserved on demo repeat',
      },
      dispatcher.id,
    );
    const before = await rowsDigest(source, state.schema),
      files = await fileDigest(paths.directory),
      durations: number[] = [];
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      await orders.dashboard();
      durations.push(Math.round((performance.now() - started) * 100) / 100);
    }
    const repeated = await prepareDemo(root, runId, config),
      after = await rowsDigest(source, state.schema),
      afterFiles = await fileDigest(paths.directory);
    if (
      !repeated.repeated ||
      JSON.stringify(repeated.manifest) !== JSON.stringify(prepared.manifest) ||
      JSON.stringify(before) !== JSON.stringify(after) ||
      JSON.stringify(files) !== JSON.stringify(afterFiles)
    )
      throw new Error(
        'The full demo repeat changed data, credentials, manifest or private storage.',
      );
    console.info(
      JSON.stringify({
        synthetic: true,
        runId,
        counts: prepared.manifest.counts,
        observedProgress: prepared.manifest.observedProgress,
        manualEditAndRepeatPreserved: true,
        changedTables: [],
        changedPrivateFiles: [],
        intentionalDashboardReads: 3,
        dashboardReadDurationsMs: durations,
        resources: 'Owned run remains prepared; explicitly demo:cleanup this verification run.',
      }),
    );
  } finally {
    await app.close();
  }
}
if (require.main === module)
  void main().catch(() => {
    console.error(
      'Isolated demo verification failed; retain its owned run for diagnosis and explicit cleanup.',
    );
    process.exitCode = 1;
  });
