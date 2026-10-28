import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { readIntegrationConfig } from '../src/config/environment';

/** Build a separate real production Next proxy; never target the development API. */
async function main() {
  const config = readIntegrationConfig();
  if (config.nodeEnv !== 'test' || !config.database.name.endsWith('_test'))
    throw new Error('Proxy verification requires the dedicated test target.');
  const api = resolve(__dirname, '..'),
    web = resolve(api, '../web');
  const id = 'proxy_' + randomUUID().replaceAll('-', '');
  const relative = '.next-test/' + id,
    directory = resolve(web, relative);
  const generated = resolve(web, 'next-env.d.ts');
  const original = existsSync(generated) ? await readFile(generated) : null;
  const parent = resolve(web, '.next-test');
  if (existsSync(parent) && (await lstat(parent)).isSymbolicLink())
    throw new Error('Refusing a symlink proxy build parent.');
  await mkdir(parent, { recursive: true });
  if ((await realpath(parent)) !== parent || existsSync(directory))
    throw new Error('Proxy artifact ownership check failed.');
  const freePort = () =>
    new Promise<number>((yes, no) => {
      const server = createServer();
      server.once('error', no);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          server.close();
          no(new Error('No fixture port.'));
          return;
        }
        server.close((error) => (error ? no(error) : yes(address.port)));
      });
    });
  const apiPort = await freePort();
  let webPort = await freePort();
  while (webPort === apiPort) webPort = await freePort();
  const logDirectory = resolve(api, '../../.tmp/m8-proxy', id);
  await mkdir(logDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(logDirectory, 'owner.json'),
    JSON.stringify({ id, relative, apiPort, webPort }) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    FD_NEXT_DIST_DIR: relative,
    API_ORIGIN: 'http://127.0.0.1:' + apiPort,
    M8_PROXY_API_PORT: String(apiPort),
    M8_PROXY_WEB_PORT: String(webPort),
    M8_PROXY_DIST_DIR: relative,
    M8_PROXY_LOG_DIR: logDirectory,
  };
  delete env.FD_DEMO_RUN;
  const run = async (args: string[], cwd: string, childEnv = env) => {
    console.info('Proxy fixture stage: ' + args[1]);
    const child = spawn(process.execPath, args, { cwd, env: childEnv, stdio: 'inherit' });
    const code = await new Promise<number>((yes, no) => {
      child.once('error', no);
      child.once('exit', (code) => yes(code ?? 1));
    });
    if (code) throw new Error('Proxy fixture process failed with exit ' + code + '.');
  };
  try {
    await run([resolve(web, 'node_modules/next/dist/bin/next'), 'build'], web, {
      ...env,
      NODE_ENV: 'production',
    });
    const routes = JSON.parse(
      await readFile(resolve(directory, 'routes-manifest.json'), 'utf8'),
    ) as {
      rewrites:
        | { afterFiles?: { source: string; destination: string }[] }
        | { source: string; destination: string }[];
    };
    await writeFile(
      resolve(logDirectory, 'routes-manifest.json'),
      JSON.stringify(routes, null, 2) + '\n',
      { mode: 0o600 },
    );
    const rewrites = Array.isArray(routes.rewrites)
      ? routes.rewrites
      : (routes.rewrites.afterFiles ?? []);
    if (
      !rewrites.some(
        (route) =>
          route.source === '/api/:path*' && route.destination === env.API_ORIGIN + '/api/:path*',
      )
    )
      throw new Error('Built proxy is not fenced to this test API.');
    await run(
      [resolve(api, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.proxy.config.ts'],
      api,
    );
    console.info('Proxy fixture logs: ' + logDirectory);
  } finally {
    // This random directory was absent before our build; no other dist folders are touched.
    if (
      existsSync(directory) &&
      !(await lstat(directory)).isSymbolicLink() &&
      (await realpath(directory)).startsWith(parent + '/')
    )
      await rm(directory, { recursive: true });
    const current = existsSync(generated) ? await readFile(generated, 'utf8') : '';
    if (current.includes(relative + '/')) {
      if (original) await writeFile(generated, original);
      else await rm(generated, { force: true });
    }
  }
}
void main().catch(() => {
  console.error('Isolated production proxy verification failed. No development target was used.');
  process.exitCode = 1;
});
