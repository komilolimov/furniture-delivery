import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OrderResponse } from '@furniture-delivery/contracts';
import { RealtimeHub } from '../src/realtime/realtime-hub';
import {
  createEvidenceFixture,
  evidenceJson as json,
  type EvidenceFixture,
} from './evidence-fixture';
import { connectTestStream, untilTestCondition } from './stream-client';

describe('M8 real production Next proxy streaming in a fenced HTTP harness, not browser QA', () => {
  let f: EvidenceFixture, next: ChildProcess, base: string;
  let nextClosed: Promise<void> | undefined;
  const streams: Awaited<ReturnType<typeof connectTestStream>>[] = [];
  const web = resolve(__dirname, '../../web');
  beforeAll(async () => {
    const apiPort = Number(process.env.M8_PROXY_API_PORT),
      webPort = Number(process.env.M8_PROXY_WEB_PORT);
    const dist = process.env.M8_PROXY_DIST_DIR;
    const logDirectory = process.env.M8_PROXY_LOG_DIR;
    if (
      ![apiPort, webPort].every((port) => Number.isInteger(port) && port > 1024 && port < 65536) ||
      apiPort === webPort ||
      !dist?.match(/^\.next-test\/proxy_[a-f0-9]{32}$/)
    )
      throw new Error('Run this check through the versioned test:proxy preparation command.');
    if (
      !logDirectory ||
      !logDirectory.startsWith(resolve(__dirname, '../../../.tmp/m8-proxy') + '/') ||
      (await realpath(logDirectory)) !== logDirectory
    )
      throw new Error('Proxy fixture logs require the owned private preparation directory.');
    const owner = JSON.parse(await readFile(resolve(logDirectory, 'owner.json'), 'utf8')) as {
      relative: string;
      apiPort: number;
      webPort: number;
    };
    if (owner.relative !== dist || owner.apiPort !== apiPort || owner.webPort !== webPort)
      throw new Error('Proxy fixture preparation ownership does not match.');
    base = 'http://127.0.0.1:' + webPort;
    f = await createEvidenceFixture(
      'm8_realtime',
      (config, root) => ({
        ...config,
        auth: { ...config.auth, webOrigin: base },
        storage: { ...config.storage, root },
      }),
      { listenPort: apiPort },
    );
    next = spawn(
      process.execPath,
      [
        resolve(web, 'node_modules/next/dist/bin/next'),
        'start',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(webPort),
      ],
      {
        cwd: web,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          FD_NEXT_DIST_DIR: dist,
          API_ORIGIN: 'http://127.0.0.1:' + apiPort,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const startedAtUTC = new Date().toISOString();
    const log = createWriteStream(resolve(logDirectory, 'next.log'), { flags: 'wx', mode: 0o600 });
    next.stdout!.on('data', (chunk: Buffer) => log.write(chunk));
    next.stderr!.on('data', (chunk: Buffer) => log.write(chunk));
    nextClosed = new Promise<void>((yes, no) => {
      next.once('close', (exitCode, signal) => {
        log.end(() => {
          void writeFile(
            resolve(logDirectory, 'next-process.json'),
            JSON.stringify(
              {
                pid: next.pid,
                startedAtUTC,
                finishedAtUTC: new Date().toISOString(),
                exitCode,
                signal,
                cwd: web,
              },
              null,
              2,
            ) + '\n',
            { mode: 0o600 },
          ).then(yes, no);
        });
      });
      log.once('error', no);
    });
    void nextClosed.catch(() => undefined);
    await new Promise<void>((yes, no) => {
      const timer = setTimeout(() => no(new Error('Bounded fixture Next startup failed.')), 8000);
      const finish = (failure?: Error) => {
        clearTimeout(timer);
        next.off('error', onError);
        next.off('exit', onExit);
        if (failure) no(failure);
        else yes();
      };
      const onError = () => finish(new Error('Fixture Next spawn failed.'));
      const onExit = () => finish(new Error('Fixture Next exited before readiness.'));
      let tail = '';
      const receive = (chunk: Buffer) => {
        tail = (tail + chunk.toString()).slice(-8192);
        if (tail.includes('Ready in')) finish();
      };
      next.stdout!.on('data', receive);
      next.stderr!.on('data', receive);
      next.once('error', onError);
      next.once('exit', onExit);
    });
  });
  afterEach(async () => {
    await Promise.all(streams.splice(0).map((stream) => stream.close()));
  });
  afterAll(async () => {
    try {
      if (next && next.exitCode === null && next.signalCode === null) {
        next.kill('SIGINT');
        await new Promise<void>((yes, no) => {
          const timer = setTimeout(() => {
            if (next.exitCode === null && next.signalCode === null) next.kill('SIGKILL');
            no(new Error('Owned fixture Next required forced shutdown.'));
          }, 5000);
          next.once('exit', () => {
            clearTimeout(timer);
            yes();
          });
        });
      }
      await nextClosed;
    } finally {
      await f?.close();
    }
  });
  const headers = () => ({ Cookie: f.dispatcher.cookie, Origin: base, 'X-CSRF-Protection': '1' });

  it('forwards the first event before close and the next committed event on the same connection, preserving cookie authorization and canonical reads', async () => {
    const ctx = await f.context();
    const stream = await connectTestStream(base, f.dispatcher.cookie, { origin: base });
    streams.push(stream);
    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get('content-type')).toContain('text/event-stream');
    expect(stream.response.headers.get('cache-control')).toContain('no-transform');
    expect(stream.response.headers.has('set-cookie')).toBe(false);
    expect(stream.response.headers.has('access-control-allow-origin')).toBe(false);
    expect(await stream.take('ready')).toBeDefined();
    expect(stream.ended).toBe(false);
    const saved = await json<OrderResponse>(
      await fetch(base + '/api/orders/' + ctx.order.id, {
        method: 'PATCH',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: ctx.order.version,
          contactName: 'Synthetic proxy contact change',
        }),
      }),
    );
    await f.app.get(RealtimeHub).flush();
    expect((await stream.take('invalidate'))?.data.topics).toContain('orders');
    expect(stream.ended).toBe(false);
    const current = await json<OrderResponse>(
      await fetch(base + '/api/orders/' + ctx.order.id, { headers: headers() }),
    );
    expect(current.order.contactName).toBe(saved.order.contactName);
    expect(current.order.version).toBe(saved.order.version);
  });
  it('keeps handshake Origin/session rules and terminates a revoked stream through the real proxy', async () => {
    const anonymous = await fetch(base + '/api/realtime/events');
    expect(anonymous.status).toBe(401);
    await anonymous.body?.cancel();
    const foreign = await fetch(base + '/api/realtime/events', {
      headers: { Cookie: f.dispatcher.cookie, Origin: 'https://forbidden.example' },
    });
    expect(foreign.status).toBe(403);
    await foreign.body?.cancel();
    const stream = await connectTestStream(base, f.dispatcher.cookie, { origin: base });
    streams.push(stream);
    expect(await stream.take('ready')).toBeDefined();
    const logout = await fetch(base + '/api/auth/logout', { method: 'POST', headers: headers() });
    expect(logout.status).toBe(200);
    expect(logout.headers.has('set-cookie')).toBe(true);
    await logout.body?.cancel();
    await f.app.get(RealtimeHub).flush();
    expect((await stream.take('access-reset'))?.data.reason).toBe('SESSION_ENDED');
    await untilTestCondition(() => stream.ended);
    const old = await fetch(base + '/api/auth/me', { headers: headers() });
    expect(old.status).toBe(401);
    await old.body?.cancel();
  });
});
