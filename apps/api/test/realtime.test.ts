import { EventEmitter } from 'node:events';
import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { DataSource, EntityManager, QueryRunner, TransactionStartEvent } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import {
  MAX_TRANSACTION_HINTS,
  RealtimeCommitSubscriber,
  markRealtime,
  registerRealtimePublisher,
} from '../src/realtime/post-commit';
import { REALTIME_LIMITS, RealtimeHub } from '../src/realtime/realtime-hub';
import {
  lostRealtimeAccess,
  readRealtimeScope,
  type RealtimeScope,
} from '../src/realtime/realtime-access';

vi.mock('../src/realtime/realtime-access', async (original) => ({
  ...(await original<typeof import('../src/realtime/realtime-access')>()),
  readRealtimeScope: vi.fn(),
}));

describe('M8 outer transaction publication', () => {
  const subscriber = new RealtimeCommitSubscriber();
  let source: DataSource, runner: QueryRunner, manager: EntityManager;
  let runnerState: { isTransactionActive: boolean };
  const event = () =>
    ({ connection: source, queryRunner: runner, manager }) as TransactionStartEvent;
  beforeEach(() => {
    source = {} as DataSource;
    runnerState = { isTransactionActive: true };
    runner = runnerState as QueryRunner;
    manager = { queryRunner: runner } as EntityManager;
  });
  const drain = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  it('publishes only after the actual outer commit and keeps targeting internal', async () => {
    const publish = vi.fn();
    registerRealtimePublisher(source, publish);
    subscriber.afterTransactionStart(event());
    markRealtime(manager, {
      backoffice: ['orders'],
      crew: ['crew-work'],
      orderId: 'private-order',
    });
    expect(publish).not.toHaveBeenCalled();
    runnerState.isTransactionActive = false;
    subscriber.afterTransactionCommit(event());
    expect(publish).not.toHaveBeenCalled();
    await drain();
    expect(publish).toHaveBeenCalledWith([
      { backoffice: ['orders'], crew: ['crew-work'], orderId: 'private-order' },
    ]);
  });
  it('merges a released savepoint without publishing before the outer commit', async () => {
    const publish = vi.fn();
    registerRealtimePublisher(source, publish);
    subscriber.afterTransactionStart(event());
    markRealtime(manager, { backoffice: ['orders'] });
    subscriber.afterTransactionStart(event());
    markRealtime(manager, { backoffice: ['planning'] });
    subscriber.afterTransactionCommit(event());
    await drain();
    expect(publish).not.toHaveBeenCalled();
    runnerState.isTransactionActive = false;
    subscriber.afterTransactionCommit(event());
    await drain();
    expect(publish.mock.calls[0]?.[0]).toEqual([
      { backoffice: ['orders'] },
      { backoffice: ['planning'] },
    ]);
  });
  it('discards a rolled back savepoint while preserving its outer transaction', async () => {
    const publish = vi.fn();
    registerRealtimePublisher(source, publish);
    subscriber.afterTransactionStart(event());
    markRealtime(manager, { backoffice: ['orders'] });
    subscriber.afterTransactionStart(event());
    markRealtime(manager, { backoffice: ['planning'] });
    subscriber.afterTransactionRollback(event());
    runnerState.isTransactionActive = false;
    subscriber.afterTransactionCommit(event());
    await drain();
    expect(publish).toHaveBeenCalledWith([{ backoffice: ['orders'] }]);
  });
  it('discards outer rollback and reused-runner marks from the previous transaction', async () => {
    const publish = vi.fn();
    registerRealtimePublisher(source, publish);
    subscriber.afterTransactionStart(event());
    markRealtime(manager, { backoffice: ['orders'] });
    runnerState.isTransactionActive = false;
    subscriber.afterTransactionRollback(event());
    runnerState.isTransactionActive = true;
    subscriber.afterTransactionStart(event());
    markRealtime(manager, { backoffice: ['planning'] });
    runnerState.isTransactionActive = false;
    subscriber.afterTransactionCommit(event());
    await drain();
    expect(publish).toHaveBeenCalledWith([{ backoffice: ['planning'] }]);
  });
  it('ignores autocommit writes, untracked runners and unexpected nested lifecycle', async () => {
    const publish = vi.fn();
    registerRealtimePublisher(source, publish);
    markRealtime(manager, { backoffice: ['orders'] });
    subscriber.afterTransactionCommit(event());
    runnerState.isTransactionActive = false;
    markRealtime(manager, { backoffice: ['orders'] });
    await drain();
    expect(publish).not.toHaveBeenCalled();
  });
  it('deduplicates transaction marks, bounds retained hints and isolates publisher failure', async () => {
    const publish = vi.fn<(changes: readonly unknown[]) => void>(() => {
      throw new Error('delivery unavailable');
    });
    registerRealtimePublisher(source, publish);
    subscriber.afterTransactionStart(event());
    for (let n = 0; n < MAX_TRANSACTION_HINTS + 20; n++)
      markRealtime(manager, { backoffice: ['orders'], orderId: String(n) });
    markRealtime(manager, { backoffice: ['orders'], orderId: String(MAX_TRANSACTION_HINTS + 19) });
    runnerState.isTransactionActive = false;
    expect(() => subscriber.afterTransactionCommit(event())).not.toThrow();
    await drain();
    expect(publish.mock.calls[0]?.[0]).toHaveLength(MAX_TRANSACTION_HINTS);
  });
});

class FakeResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writableLength = 0;
  statusCode = 0;
  headers = new Map<string, string>();
  packets: string[] = [];
  acceptWrites = true;
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }
  flushHeaders() {}
  write(packet: string) {
    this.packets.push(packet);
    return this.acceptWrites;
  }
  end() {
    this.writableEnded = true;
    this.emit('close');
    return this;
  }
  destroy() {
    this.destroyed = true;
    this.emit('close');
    return this;
  }
}
function scope(
  role: RealtimeScope['role'] = 'CREW_MEMBER',
  crewId: string | null = 'crew-a',
  assignmentIds: string[] = ['a'],
  orderIds: string[] = ['o'],
): RealtimeScope {
  return { role, crewId, assignmentIds: new Set(assignmentIds), orderIds: new Set(orderIds) };
}
function request() {
  return Object.assign(new EventEmitter(), {
    headers: { origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' },
    query: {},
    aborted: false,
  }) as unknown as Request;
}
const reader = vi.mocked(readRealtimeScope);
describe('M8 bounded private SSE transport', () => {
  let hub: RealtimeHub;
  beforeEach(() => {
    vi.useFakeTimers();
    reader.mockReset();
    reader.mockResolvedValue(scope());
    hub = new RealtimeHub(
      { getDataSource: async () => ({}) } as unknown as DatabaseService,
      'http://127.0.0.1:3000',
    );
  });
  afterEach(async () => {
    await hub.onModuleDestroy();
    vi.useRealTimers();
  });
  async function connect(user = 'user', req = request(), res = new FakeResponse()) {
    await hub.connect({ id: user, sessionId: `session-${user}` }, req, res as unknown as Response);
    return { req, res };
  }
  it('sends the minimal ready packet, no-store headers and a real 15-second fresh-auth heartbeat', async () => {
    const { res } = await connect();
    expect(res.statusCode).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-transform');
    expect(res.packets.join('')).toContain('event: ready\ndata: {"emittedAt":');
    expect(res.packets.join('')).not.toContain('session-user');
    await vi.advanceTimersByTimeAsync(REALTIME_LIMITS.heartbeatMs);
    expect(reader).toHaveBeenCalledTimes(2);
    expect(res.packets.at(-1)).toBe(': heartbeat\n\n');
  });
  it('coalesces order-authorized hints into topics without IDs or private payloads', async () => {
    const { res } = await connect();
    hub.publish([
      { backoffice: ['dashboard'], crew: ['crew-work'], orderId: 'o' },
      { backoffice: ['orders'], crew: ['evidence'], orderId: 'o' },
      { backoffice: ['dashboard'], crew: ['crew-work'], orderId: 'o' },
    ]);
    expect(hub.inspect().queuedHints).toBe(2);
    await vi.advanceTimersByTimeAsync(REALTIME_LIMITS.coalesceMs);
    const packets = res.packets.filter((p) => p.includes('event: invalidate'));
    expect(packets).toHaveLength(1);
    expect(packets[0]).toContain('"topics":["crew-work","evidence"]');
    const parsed = JSON.parse(packets[0]!.split('data: ')[1]!.trim()) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['emittedAt', 'eventId', 'topics']);
  });
  it('does not notify crews about finances, private evidence, another order or another staff exception', async () => {
    const { res } = await connect();
    hub.publish([
      { backoffice: ['dashboard', 'orders'] },
      { backoffice: ['evidence'] },
      { backoffice: ['orders'], crew: ['crew-work'], orderId: 'other' },
      { backoffice: ['acceptance'], crew: ['acceptance'], orderId: 'o', crewIds: ['crew-b'] },
    ]);
    await hub.flush();
    expect(res.packets.some((p) => p.includes('event: invalidate'))).toBe(false);
  });
  it('delivers all safe backoffice topics without leaking internal targeting', async () => {
    reader.mockResolvedValue(scope('DISPATCHER', null, [], []));
    const { res } = await connect();
    hub.publish([
      { backoffice: ['dashboard', 'orders'], orderId: 'secret-id', crewIds: ['secret-crew'] },
    ]);
    await hub.flush();
    expect(res.packets.at(-1)).toContain('"topics":["dashboard","orders"]');
    expect(res.packets.at(-1)).not.toContain('secret');
  });
  it('keeps account-only changes private to administrators', async () => {
    reader.mockResolvedValue(scope('DISPATCHER', null, [], []));
    const dispatcher = await connect('dispatcher');
    reader.mockResolvedValue(scope('ADMIN', null, [], []));
    const admin = await connect('admin');
    reader.mockImplementation(async (_source, actor) =>
      scope(actor.id === 'admin' ? 'ADMIN' : 'DISPATCHER', null, [], []),
    );
    hub.publish([{ backoffice: ['accounts'] }]);
    await hub.flush();
    expect(dispatcher.res.packets.some((p) => p.includes('event: invalidate'))).toBe(false);
    expect(admin.res.packets.at(-1)).toContain('"topics":["accounts"]');
  });
  it('rechecks additions and emits a generic list refresh for the newly authorized team', async () => {
    reader.mockResolvedValueOnce(scope('CREW_MEMBER', 'crew-a', [], []));
    const { res } = await connect();
    reader.mockResolvedValue(scope());
    await hub.heartbeat();
    expect(res.packets.at(-1)).toContain('"topics":["crew-work"]');
    expect(res.packets.at(-1)).not.toContain('assignmentId');
  });
  it('resets private state before delivering a pending hint when any assignment is removed', async () => {
    const { res } = await connect();
    reader.mockResolvedValue(scope('CREW_MEMBER', 'crew-a', [], []));
    hub.publish([{ backoffice: ['orders'], crew: ['crew-work'], orderId: 'o' }]);
    await hub.flush();
    expect(res.packets.at(-1)).toContain('"reason":"SCOPE_CHANGED"');
    expect(res.packets.some((p) => p.includes('event: invalidate'))).toBe(false);
    expect(res.writableEnded).toBe(true);
    expect(hub.inspect()).toMatchObject({
      connections: 0,
      timers: 0,
      queuedHints: 0,
      authInFlight: 0,
    });
  });
  it('closes revoked/expired sessions on idle auth recheck and never labels DB failure as logout', async () => {
    const first = await connect();
    reader.mockRejectedValue(new UnauthorizedException());
    await hub.heartbeat();
    expect(first.res.packets.at(-1)).toContain('"reason":"SESSION_ENDED"');
    reader.mockResolvedValue(scope());
    const second = await connect();
    reader.mockRejectedValue(new Error('database unavailable'));
    await hub.heartbeat();
    expect(second.res.destroyed).toBe(true);
    expect(second.res.packets.some((p) => p.includes('access-reset'))).toBe(false);
  });
  it('rejects cross-origin and client-selected channels before headers', async () => {
    const req = request();
    req.headers.origin = 'https://other.example';
    const res = new FakeResponse();
    await expect(connect('user', req, res)).rejects.toThrow('same-origin');
    expect(res.headers.size).toBe(0);
    const withRoom = request();
    withRoom.query = { orderId: 'o' };
    await expect(connect('user', withRoom)).rejects.toThrow('client-selected');
    expect(hub.inspect().connections).toBe(0);
  });
  it('bounds per-user and global connections and releases capacity after disconnect', async () => {
    const opened = [];
    for (let n = 0; n < REALTIME_LIMITS.perUser; n++) opened.push(await connect());
    await expect(connect()).rejects.toMatchObject({ status: 429 });
    opened[0]!.res.destroy();
    await connect();
    for (let n = 1; n <= REALTIME_LIMITS.connections - REALTIME_LIMITS.perUser; n++)
      await connect(`user-${n}`);
    await expect(connect('overflow')).rejects.toMatchObject({ status: 429 });
    expect(hub.inspect().connections).toBe(REALTIME_LIMITS.connections);
  });
  it('closes a slow socket instead of accumulating an unbounded output queue', async () => {
    const { res } = await connect();
    res.acceptWrites = false;
    hub.publish([{ backoffice: [], crew: ['crew-work'], orderId: 'o' }]);
    await hub.flush();
    expect(res.destroyed).toBe(true);
    expect(hub.inspect()).toMatchObject({ connections: 0, timers: 0, queuedHints: 0 });
  });
  it('bounds pending hint memory and cleans all queues and timers on shutdown', async () => {
    await connect();
    for (let n = 0; n < REALTIME_LIMITS.pendingHints + 100; n++)
      hub.publish([{ backoffice: ['orders'], crew: ['crew-work'], orderId: String(n) }]);
    expect(hub.inspect().queuedHints).toBeLessThanOrEqual(REALTIME_LIMITS.pendingHints);
    await hub.onModuleDestroy();
    expect(hub.inspect()).toMatchObject({ connections: 0, timers: 0, queuedHints: 0 });
  });
  it('removes aborted asynchronous setup before sending any private packet', async () => {
    let release!: (scope: RealtimeScope) => void;
    reader.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const req = request(),
      res = new FakeResponse(),
      work = connect('user', req, res);
    await Promise.resolve();
    req.emit('aborted');
    release(scope());
    await work;
    expect(res.headers.size).toBe(0);
    expect(res.packets).toEqual([]);
    expect(hub.inspect()).toMatchObject({ connections: 0, setups: 0, timers: 0 });
  });
  it('destroys a pending setup socket at shutdown and releases its short auth work when it settles', async () => {
    let release!: (scope: RealtimeScope) => void;
    reader.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const req = request(),
      res = new FakeResponse(),
      work = connect('user', req, res);
    await Promise.resolve();
    const shutdown = hub.onModuleDestroy();
    expect(res.destroyed).toBe(true);
    let stopped = false;
    void shutdown.then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release(scope());
    await work;
    await shutdown;
    expect(res.headers.size).toBe(0);
    expect(res.packets).toEqual([]);
    expect(hub.inspect()).toMatchObject({ connections: 0, setups: 0, timers: 0, authInFlight: 0 });
  });
  it('continues counting fresh authorization after its socket disconnects', async () => {
    const { res } = await connect();
    let release!: (scope: RealtimeScope) => void;
    reader.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const work = hub.heartbeat();
    res.destroy();
    expect(hub.inspect()).toMatchObject({ connections: 0, authInFlight: 1, timers: 0 });
    release(scope());
    await work;
    expect(hub.inspect().authInFlight).toBe(0);
    expect(res.packets.some((packet) => packet.includes('event: invalidate'))).toBe(false);
  });
  it('awaits authorization already in flight at shutdown after closing sockets first', async () => {
    const { res } = await connect();
    let release!: (scope: RealtimeScope) => void;
    reader.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const work = hub.heartbeat(),
      shutdown = hub.onModuleDestroy();
    expect(res.destroyed).toBe(true);
    expect(hub.inspect()).toMatchObject({ connections: 0, authInFlight: 1, timers: 0 });
    let stopped = false;
    void shutdown.then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release(scope());
    await work;
    await shutdown;
    expect(stopped).toBe(true);
    expect(hub.inspect()).toMatchObject({
      connections: 0,
      authInFlight: 0,
      timers: 0,
      queuedHints: 0,
    });
  });
  it('serializes fresh authorization per socket while bounding queued work during an auth wait', async () => {
    await connect();
    let release!: (scope: RealtimeScope) => void;
    reader.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    hub.publish([{ backoffice: [], crew: ['crew-work'], orderId: 'o' }]);
    const work = hub.flush();
    const concurrent = hub.heartbeat();
    expect(hub.inspect().authInFlight).toBe(1);
    release(scope());
    await work;
    await concurrent;
    await Promise.resolve();
    expect(reader.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

describe('M8 scope loss classification', () => {
  it('resets on role, team and assignment removals, while additions retain drafts', () => {
    expect(lostRealtimeAccess(scope(), scope('ADMIN', null, [], []))).toBe(true);
    expect(lostRealtimeAccess(scope(), scope('CREW_MEMBER', 'crew-b'))).toBe(true);
    expect(lostRealtimeAccess(scope(), scope('CREW_MEMBER', 'crew-a', [], []))).toBe(true);
    expect(
      lostRealtimeAccess(scope(), scope('CREW_MEMBER', 'crew-a', ['a', 'b'], ['o', 'p'])),
    ).toBe(false);
  });
});
