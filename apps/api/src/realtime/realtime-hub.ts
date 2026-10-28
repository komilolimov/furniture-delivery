import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { DataSource } from 'typeorm';
import type { RealtimeTopic } from '@furniture-delivery/contracts';
import { DatabaseService } from '../database/database.service';
import type { ExecutionActor } from '../execution/execution-access';
import { lostRealtimeAccess, readRealtimeScope, type RealtimeScope } from './realtime-access';
import { realtimeChangeKey, registerRealtimePublisher, type RealtimeChange } from './post-commit';

export const REALTIME_ORIGIN = Symbol('REALTIME_ORIGIN');
export const REALTIME_LIMITS = {
  connections: 32,
  perUser: 4,
  pendingHints: 128,
  coalesceMs: 250,
  heartbeatMs: 15000,
  packetBytes: 2048,
  writeBufferBytes: 16384,
} as const;
interface Client {
  id: string;
  actor: ExecutionActor;
  scope: RealtimeScope;
  response: Response;
  pending: Map<string, RealtimeChange>;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  work: Promise<void> | null;
  heartbeatPending: boolean;
  closed: boolean;
  cleanup: () => void;
}
@Injectable()
export class RealtimeHub implements OnModuleDestroy {
  private readonly clients = new Map<string, Client>();
  private readonly setups = new Map<string, number>();
  private readonly pendingResponses = new Set<Response>();
  private readonly setupWork = new Set<Promise<void>>();
  private readonly deliveryWork = new Set<Promise<void>>();
  private source: DataSource | undefined;
  private detach: (() => void) | undefined;
  private stopping = false;
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(REALTIME_ORIGIN) private readonly webOrigin: string,
  ) {}
  inspect() {
    return {
      connections: this.clients.size,
      setups: [...this.setups.values()].reduce((sum, n) => sum + n, 0),
      queuedHints: [...this.clients.values()].reduce((sum, c) => sum + c.pending.size, 0),
      timers: [...this.clients.values()].reduce(
        (sum, c) => sum + Number(!!c.flushTimer) + Number(!!c.heartbeatTimer),
        0,
      ),
      authInFlight: this.deliveryWork.size,
    };
  }
  private safeRequest(request: Request): void {
    if (Object.keys(request.query ?? {}).length)
      throw new ForbiddenException(
        'Realtime subscriptions do not accept client-selected channels.',
      );
    const origin = request.headers.origin,
      site = request.headers['sec-fetch-site'];
    if (
      (origin !== undefined && origin !== this.webOrigin) ||
      (site !== undefined && site !== 'same-origin' && site !== 'none')
    )
      throw new ForbiddenException('Realtime requires a same-origin request.');
  }
  async connect(actor: ExecutionActor, request: Request, response: Response): Promise<void> {
    this.safeRequest(request);
    if (this.stopping) throw new ServiceUnavailableException('Realtime is shutting down.');
    const pending = this.inspect().setups,
      own =
        [...this.clients.values()].filter((client) => client.actor.id === actor.id).length +
        (this.setups.get(actor.id) ?? 0);
    if (
      this.clients.size + pending >= REALTIME_LIMITS.connections ||
      own >= REALTIME_LIMITS.perUser
    )
      throw new HttpException('Realtime connection limit reached. Use periodic refresh.', 429);
    this.setups.set(actor.id, (this.setups.get(actor.id) ?? 0) + 1);
    this.pendingResponses.add(response);
    let finishSetup!: () => void;
    const setupDone = new Promise<void>((resolve) => {
      finishSetup = resolve;
    });
    this.setupWork.add(setupDone);
    let aborted = request.aborted || response.destroyed,
      client: Client | undefined;
    const abort = () => {
      aborted = true;
      if (client) this.close(client, false);
    };
    request.once('aborted', abort);
    response.once('close', abort);
    try {
      const source = await this.database.getDataSource();
      if (aborted || this.stopping || response.destroyed) return;
      if (!this.source) {
        this.source = source;
        this.detach = registerRealtimePublisher(source, (changes) => this.publish(changes));
      }
      const scope = await readRealtimeScope(source, actor);
      if (aborted || this.stopping || response.destroyed) return;
      client = {
        id: randomUUID(),
        actor: { id: actor.id, sessionId: actor.sessionId },
        scope,
        response,
        pending: new Map(),
        heartbeatTimer: null,
        flushTimer: null,
        work: null,
        heartbeatPending: false,
        closed: false,
        cleanup: () => {
          request.off('aborted', abort);
          response.off('close', abort);
        },
      };
      this.clients.set(client.id, client);
      response.status(200);
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store, no-transform');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('X-Accel-Buffering', 'no');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.flushHeaders();
      if (
        !this.write(client, 'retry: 3000\n\n') ||
        !this.event(client, 'ready', { emittedAt: new Date().toISOString() })
      )
        return;
      const active = client;
      active.heartbeatTimer = setInterval(() => {
        void this.pump(active, true);
      }, REALTIME_LIMITS.heartbeatMs);
      active.heartbeatTimer.unref();
    } catch (error) {
      if (client) this.close(client, false);
      else if (!aborted && !response.destroyed) throw error;
    } finally {
      const count = (this.setups.get(actor.id) ?? 1) - 1;
      if (count) this.setups.set(actor.id, count);
      else this.setups.delete(actor.id);
      this.pendingResponses.delete(response);
      this.setupWork.delete(setupDone);
      finishSetup();
      if (!client) {
        request.off('aborted', abort);
        response.off('close', abort);
      }
    }
  }
  publish(changes: readonly RealtimeChange[]): void {
    for (const client of this.clients.values())
      for (const change of changes) {
        if (
          client.scope.role === 'CREW_MEMBER' &&
          !change.crew?.length &&
          !change.listCrewIds?.length &&
          change.userId !== client.actor.id &&
          change.sessionId !== client.actor.sessionId
        )
          continue;
        const key = realtimeChangeKey(change);
        if (!client.pending.has(key) && client.pending.size >= REALTIME_LIMITS.pendingHints)
          client.pending.delete(client.pending.keys().next().value!);
        client.pending.set(key, change);
        this.schedule(client);
      }
  }
  private schedule(client: Client): void {
    if (client.closed || client.flushTimer) return;
    client.flushTimer = setTimeout(() => {
      client.flushTimer = null;
      void this.pump(client, false);
    }, REALTIME_LIMITS.coalesceMs);
    client.flushTimer.unref();
  }
  async flush(): Promise<void> {
    await Promise.all(
      [...this.clients.values()].map((client) => {
        if (client.flushTimer) {
          clearTimeout(client.flushTimer);
          client.flushTimer = null;
        }
        return this.pump(client, false);
      }),
    );
  }
  async heartbeat(): Promise<void> {
    await Promise.all([...this.clients.values()].map((client) => this.pump(client, true)));
  }
  private async pump(client: Client, heartbeat: boolean): Promise<void> {
    if (client.closed) return;
    if (client.work) {
      client.heartbeatPending ||= heartbeat;
      return client.work;
    }
    const changes = [...client.pending.values()];
    client.pending.clear();
    if (!heartbeat && !changes.length) return;
    const work = this.deliver(client, changes, heartbeat)
      .catch(() => this.close(client, false))
      .finally(() => {
        this.deliveryWork.delete(work);
        client.work = null;
        if (client.closed) return;
        if (client.pending.size) this.schedule(client);
        if (client.heartbeatPending) {
          client.heartbeatPending = false;
          void this.pump(client, true);
        }
      });
    this.deliveryWork.add(work);
    client.work = work;
    return work;
  }
  private async deliver(
    client: Client,
    changes: readonly RealtimeChange[],
    heartbeat: boolean,
  ): Promise<void> {
    let scope: RealtimeScope;
    try {
      scope = await readRealtimeScope(this.source!, client.actor);
    } catch (error) {
      if (error instanceof HttpException && [401, 403].includes(error.getStatus())) {
        this.event(client, 'access-reset', {
          eventId: randomUUID(),
          emittedAt: new Date().toISOString(),
          reason: 'SESSION_ENDED',
        });
        this.close(client, true);
      } else this.close(client, false);
      return;
    }
    if (client.closed) return;
    if (lostRealtimeAccess(client.scope, scope)) {
      this.event(client, 'access-reset', {
        eventId: randomUUID(),
        emittedAt: new Date().toISOString(),
        reason: 'SCOPE_CHANGED',
      });
      this.close(client, true);
      return;
    }
    const additions = [...scope.assignmentIds].some((id) => !client.scope.assignmentIds.has(id));
    client.scope = scope;
    const topics = new Set<RealtimeTopic>();
    for (const change of changes) {
      if (scope.role !== 'CREW_MEMBER') {
        for (const topic of change.backoffice)
          if (topic !== 'accounts' || scope.role === 'ADMIN') topics.add(topic);
        continue;
      }
      const teamMatches =
        !change.crewIds?.length || (!!scope.crewId && change.crewIds.includes(scope.crewId));
      const permitted = change.orderId
        ? scope.orderIds.has(change.orderId) && teamMatches
        : !!change.crewIds?.length && teamMatches;
      if (permitted) for (const topic of change.crew ?? []) topics.add(topic);
      if (scope.crewId && change.listCrewIds?.includes(scope.crewId)) topics.add('crew-work');
    }
    if (additions && scope.role === 'CREW_MEMBER') topics.add('crew-work');
    if (topics.size)
      this.event(client, 'invalidate', {
        eventId: randomUUID(),
        emittedAt: new Date().toISOString(),
        topics: [...topics].sort(),
      });
    else if (heartbeat) this.write(client, ': heartbeat\n\n');
  }
  private event(client: Client, name: string, data: object): boolean {
    return this.write(client, `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  private write(client: Client, packet: string): boolean {
    if (client.closed) return false;
    if (
      Buffer.byteLength(packet) > REALTIME_LIMITS.packetBytes ||
      client.response.destroyed ||
      client.response.writableEnded ||
      client.response.writableLength > REALTIME_LIMITS.writeBufferBytes
    ) {
      this.close(client, false);
      return false;
    }
    try {
      if (client.response.write(packet) === false) {
        this.close(client, false);
        return false;
      }
      return true;
    } catch {
      this.close(client, false);
      return false;
    }
  }
  private close(client: Client, graceful: boolean): void {
    if (client.closed) return;
    client.closed = true;
    client.cleanup();
    this.clients.delete(client.id);
    client.pending.clear();
    if (client.flushTimer) clearTimeout(client.flushTimer);
    if (client.heartbeatTimer) clearInterval(client.heartbeatTimer);
    client.flushTimer = null;
    client.heartbeatTimer = null;
    try {
      if (graceful) client.response.end();
      else client.response.destroy();
    } catch {
      /* disconnected sockets carry no business effect */
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.detach?.();
    this.detach = undefined;
    for (const response of this.pendingResponses)
      try {
        response.destroy();
      } catch {
        /* setup socket already gone */
      }
    this.pendingResponses.clear();
    for (const client of this.clients.values()) this.close(client, false);
    // Responses are already closed. Only the existing short authorization transactions remain;
    // let them release their connections before the database provider shuts down.
    await Promise.allSettled([...this.setupWork, ...this.deliveryWork]);
  }
}
