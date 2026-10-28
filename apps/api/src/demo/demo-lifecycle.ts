import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { open, lstat, readFile, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppConfig } from '../config/environment';
import type { DemoOwner, DemoProcess, DemoRunState } from './demo-types';
import {
  assertOwner,
  demoPaths,
  hashBytes,
  loadDemoState,
  privateDirectory,
  readDemoManifest,
  readPrivateJson,
  verifyDemoSchema,
  writePrivateJson,
} from './demo-run-state';
import { cleanupDemoSchema } from './demo-prepare';

const execute = promisify(execFile);
async function processCwd(pid: number): Promise<string> {
  if (process.platform === 'linux') return readlink('/proc/' + pid + '/cwd');
  const { stdout } = await execute('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
    timeout: 2000,
    maxBuffer: 16384,
  });
  const path = stdout
    .split('\n')
    .find((line) => line.startsWith('n'))
    ?.slice(1);
  if (!path) throw new Error('The process working directory could not be identified.');
  return path;
}
export async function inspectDemoProcess(pid: number): Promise<DemoProcess | null> {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error('Invalid owned demo PID.');
  try {
    const { stdout } = await execute(
      'ps',
      ['-ww', '-p', String(pid), '-o', 'lstart=', '-o', 'command='],
      { timeout: 2000, maxBuffer: 32768, env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } },
    );
    const match = stdout
      .trim()
      .match(/^([A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(.+)$/);
    if (!match) throw new Error('The process start identity could not be identified.');
    return { pid, startTime: match[1]!, command: match[2]!, cwd: await processCwd(pid) };
  } catch (error) {
    if (
      (error as { code?: unknown }).code === 1 ||
      ((error as NodeJS.ErrnoException).code === 'ENOENT' && process.platform === 'linux')
    )
      return null;
    throw new Error('Process ownership inspection requires ps and /proc or lsof.', {
      cause: error,
    });
  }
}
export function sameDemoProcess(actual: DemoProcess | null, expected: DemoProcess): boolean {
  return (
    !!actual &&
    actual.pid === expected.pid &&
    actual.startTime === expected.startTime &&
    actual.command === expected.command &&
    actual.cwd === expected.cwd
  );
}
async function ensurePortsFree(): Promise<void> {
  for (const port of [3000, 3001])
    await new Promise<void>((resolvePort, reject) => {
      const server = createServer();
      server.once('error', () =>
        reject(
          new Error(
            'Ports 3000/3001 must be free. Stop the ordinary development run explicitly; demo start never kills it.',
          ),
        ),
      );
      server.listen(port, '127.0.0.1', () =>
        server.close((error) => (error ? reject(error) : resolvePort())),
      );
    });
}
async function waitOwnedHttp(url: string, child: ChildProcess): Promise<void> {
  const end = performance.now() + 30000;
  while (performance.now() < end) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('An owned demo process exited during startup.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      /* Startup is bounded; no browser or development-origin QA is performed. */
    }
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error('The owned demo process did not become ready within its startup bound.');
}
async function waitChild(child: ChildProcess): Promise<number> {
  if (child.exitCode !== null && child.stdout?.readableEnded && child.stderr?.readableEnded)
    return child.exitCode;
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
}
async function stopChild(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    await waitChild(child);
    return;
  }
  const done = waitChild(child);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    process.kill(-child.pid, 'SIGTERM');
    await Promise.race([
      done,
      new Promise<void>((resolveGrace) => {
        timer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            try {
              process.kill(-child.pid!, 'SIGKILL');
            } catch {
              /* It may have exited at the grace boundary. */
            }
          }
          resolveGrace();
        }, 5000);
      }),
    ]);
    await done;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
const nextDist = (runId: string) => '.next-demo/' + runId;
async function buildMarker(root: string, state: DemoRunState, create: boolean): Promise<string> {
  const parent = join(root, 'apps/web/.next-demo');
  await privateDirectory(parent, create);
  const marker = join(parent, state.owner.runId + '.owner.json');
  if (create) {
    try {
      assertOwner(await readPrivateJson<DemoOwner>(marker), state.owner);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await writePrivateJson(marker, state.owner, true);
    }
  } else assertOwner(await readPrivateJson<DemoOwner>(marker), state.owner);
  return marker;
}
async function saveOriginalNextEnv(root: string, state: DemoRunState): Promise<void> {
  const path = join(root, 'apps/web/next-env.d.ts'),
    destination = demoPaths(root, state.owner.runId).originalNextEnv;
  let backup: { present: boolean; contents: string };
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 8192)
      throw new Error('The generated Next environment file is not a bounded regular file.');
    backup = { present: true, contents: await readFile(path, 'utf8') };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    backup = { present: false, contents: '' };
  }
  try {
    await lstat(destination);
    await writePrivateJson(destination, backup);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writePrivateJson(destination, backup, true);
  }
}
async function restoreOwnedNextEnv(root: string, state: DemoRunState): Promise<void> {
  if (!state.generatedNextEnvHash) return;
  const path = join(root, 'apps/web/next-env.d.ts');
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return;
    const current = await readFile(path);
    if (
      hashBytes(current) !== state.generatedNextEnvHash ||
      !current.toString('utf8').includes(nextDist(state.owner.runId) + '/types/routes.d.ts')
    )
      return;
    const backup = await readPrivateJson<{ present: boolean; contents: string }>(
      demoPaths(root, state.owner.runId).originalNextEnv,
    );
    if (
      typeof backup.present !== 'boolean' ||
      typeof backup.contents !== 'string' ||
      backup.contents.length > 8192
    )
      throw new Error('Invalid generated-file backup.');
    const latest = await lstat(path);
    if (
      latest.mtimeMs !== info.mtimeMs ||
      hashBytes(await readFile(path)) !== state.generatedNextEnvHash
    )
      return;
    if (backup.present) await writeFile(path, backup.contents);
    else await rm(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function startDemo(
  rootInput: string,
  runId: string,
  config: AppConfig,
): Promise<void> {
  const root = await realpath(rootInput),
    state = await loadDemoState(root, runId, config),
    paths = demoPaths(root, runId);
  if (!['PREPARED', 'STOPPED'].includes(state.status))
    throw new Error('The run must be prepared and stopped before starting.');
  await verifyDemoSchema(config, state);
  await readDemoManifest(root, state);
  await ensurePortsFree();
  const self = await inspectDemoProcess(process.pid);
  if (
    !self ||
    self.cwd !== process.cwd() ||
    !self.command.includes('demo/cli.ts') ||
    !self.command.includes(' start ') ||
    !self.command.includes('--run ' + runId)
  )
    throw new Error('The foreground supervisor identity could not be verified.');
  await buildMarker(root, state, true);
  await saveOriginalNextEnv(root, state);
  const credentials = await readPrivateJson<{ accounts: { password: string }[] }>(
    paths.credentials,
  );
  if (
    !Array.isArray(credentials.accounts) ||
    credentials.accounts.length !== 42 ||
    credentials.accounts.some((account) => typeof account.password !== 'string')
  )
    throw new Error('The private demo credentials metadata is incomplete.');
  const sensitive = [
    config.database.password,
    process.env.DATABASE_PASSWORD,
    ...credentials.accounts.map((account) => account.password),
  ].filter((value): value is string => !!value);
  const redact = (text: string) => {
    for (const secret of sensitive) text = text.split(secret).join('[REDACTED]');
    return text.replace(/fd_session=[^;\s"']+/g, 'fd_session=[REDACTED]');
  };
  const logFile = await open(
      paths.log,
      constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    ),
    logInfo = await logFile.stat();
  if (
    !logInfo.isFile() ||
    (logInfo.mode & 0o077) !== 0 ||
    (process.getuid && logInfo.uid !== process.getuid())
  ) {
    await logFile.close();
    throw new Error('The demo application log must be a private owned regular file.');
  }
  let writes = Promise.resolve();
  const writeLog = (line: string) => {
    writes = writes
      .then(() => logFile.appendFile(line))
      .catch(() => {
        process.exitCode = 1;
      });
  };
  const children = new Set<ChildProcess>();
  let stopping: Promise<void> | undefined;
  function logStream(stream: NodeJS.ReadableStream | null): void {
    if (!stream) return;
    let pending = '';
    stream.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop()!;
      for (const line of lines) writeLog(redact(line) + '\n');
      if (pending.length > 16384) {
        pending = '';
        writeLog('[Oversized application log line omitted]\n');
      }
    });
    stream.on('end', () => {
      if (pending) writeLog(redact(pending) + '\n');
      pending = '';
    });
  }
  function owned(args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    logStream(child.stdout);
    logStream(child.stderr);
    child.once('close', () => children.delete(child));
    return child;
  }
  const shutdown = () =>
    (stopping ??= (async () => {
      await Promise.all([...children].map(stopChild));
      state.status = 'STOPPED';
      state.children = [];
      delete state.supervisor;
      await restoreOwnedNextEnv(root, state);
      await writePrivateJson(paths.state, state);
      await writes;
      await logFile.close();
    })());
  const signal = () => {
    void shutdown().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    state.status = 'RUNNING';
    state.supervisor = self;
    state.children = [];
    await writePrivateJson(paths.state, state);
    const web = join(root, 'apps/web'),
      next = join(web, 'node_modules/next/dist/bin/next'),
      webEnv = {
        ...process.env,
        NODE_ENV: 'production',
        API_ORIGIN: 'http://127.0.0.1:3001',
        FD_NEXT_DIST_DIR: nextDist(runId),
        FD_DEMO_RUN: runId,
      };
    const building = owned([next, 'build'], web, webEnv);
    if ((await waitChild(building)) !== 0)
      throw new Error('The isolated demo web build failed. Inspect the private application log.');
    if (stopping) {
      await stopping;
      return;
    }
    await ensurePortsFree();
    const generated = await readFile(join(web, 'next-env.d.ts'));
    state.generatedNextEnvHash = hashBytes(generated);
    const api = owned(
      ['--import', 'tsx', join(root, 'apps/api/src/demo/demo-server.ts'), runId],
      join(root, 'apps/api'),
      { ...process.env, NODE_ENV: 'test', FD_DEMO_RUN: runId },
    );
    const frontend = owned(
      [next, 'start', '--hostname', '127.0.0.1', '--port', '3000'],
      web,
      webEnv,
    );
    await waitOwnedHttp('http://127.0.0.1:3001/api/health', api);
    await waitOwnedHttp('http://127.0.0.1:3000/login', frontend);
    const apiIdentity = await inspectDemoProcess(api.pid!),
      webIdentity = await inspectDemoProcess(frontend.pid!);
    if (!apiIdentity || !webIdentity)
      throw new Error('The owned demo children could not be identified.');
    state.children = [apiIdentity, webIdentity];
    await writePrivateJson(paths.state, state);
    console.info(
      'DEMO — SYNTHETIC DATA. Owned foreground run started at http://127.0.0.1:3000. Credentials remain in its private local file.',
    );
    await Promise.race([waitChild(api), waitChild(frontend)]);
    if (!stopping)
      throw new Error(
        'An owned demo server stopped unexpectedly; the remaining owned process was stopped.',
      );
  } finally {
    await shutdown();
    process.removeListener('SIGINT', signal);
    process.removeListener('SIGTERM', signal);
  }
}
export async function stopDemo(root: string, runId: string, config: AppConfig): Promise<void> {
  const state = await loadDemoState(root, runId, config);
  if (!state.supervisor) {
    if (state.status === 'RUNNING')
      throw new Error(
        'This run has no verified supervisor. Inspect its private state before any manual recovery.',
      );
    return;
  }
  const actual = await inspectDemoProcess(state.supervisor.pid);
  if (
    !sameDemoProcess(actual, state.supervisor) ||
    !actual!.command.includes('demo/cli.ts') ||
    !actual!.command.includes(' start ') ||
    !actual!.command.includes('--run ' + runId)
  )
    throw new Error(
      'The PID no longer identifies this exact demo supervisor; no process was signalled.',
    );
  process.kill(state.supervisor.pid, 'SIGINT');
  const end = performance.now() + 12000;
  while (performance.now() < end) {
    if (!sameDemoProcess(await inspectDemoProcess(state.supervisor.pid), state.supervisor)) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(
    'The owned demo supervisor did not stop within its bound. No unrelated process was signalled.',
  );
}
async function noSymlinks(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error('Refusing cleanup through a symbolic link.');
  if (info.isDirectory()) {
    const { readdir } = await import('node:fs/promises');
    for (const child of await readdir(path)) await noSymlinks(join(path, child));
  }
}
export async function cleanupDemo(
  rootInput: string,
  runId: string,
  config: AppConfig,
): Promise<void> {
  const root = await realpath(rootInput),
    state = await loadDemoState(root, runId, config),
    paths = demoPaths(root, runId);
  for (const expected of [state.supervisor, ...(state.children ?? [])])
    if (expected && sameDemoProcess(await inspectDemoProcess(expected.pid), expected))
      throw new Error('Stop the verified owned demo processes before cleanup.');
  await noSymlinks(paths.directory);
  await cleanupDemoSchema(root, state, config);
  try {
    const marker = await buildMarker(root, state, false),
      output = join(root, 'apps/web', nextDist(runId));
    try {
      await noSymlinks(output);
      await rm(output, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rm(marker);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await restoreOwnedNextEnv(root, state);
  await rm(paths.directory, { recursive: true });
}
