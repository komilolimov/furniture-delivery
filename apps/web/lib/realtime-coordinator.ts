import { realtimeTopics } from '@furniture-delivery/contracts';
import type { AuthUser, RealtimeTopic } from '@furniture-delivery/contracts';
import { apiRequest, ApiError } from './api-client';
import { isAuthResponse } from './session';
import { resourceKey, resourceTopics } from './realtime-resources';

export interface LiveStatusSnapshot {
  mode: 'Live' | 'Reconnecting' | 'Periodic refresh' | 'Unavailable';
  dataLastSyncedAt: string | null;
  dataChangedAt: string | null;
}
export interface ResourceObserver {
  validate?: (value: unknown) => boolean;
  pending: () => void;
  success: (value: unknown, syncedAt: string | null) => void;
  failure: (error: unknown) => void;
  clear: () => void;
}
interface Entry {
  path: string;
  observers: Set<ResourceObserver>;
  value: unknown;
  hasValue: boolean;
  controller: AbortController | null;
  flight: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
  pending: boolean;
  epoch: number;
  lastStarted: number;
  syncedAt: number | null;
  failures: number;
  changes: number;
}
interface Options {
  initialUser: AuthUser;
  onSession: (user: AuthUser) => boolean | void;
  onAccessReset: () => void;
  onExpired: () => void;
  read?: (path: string, signal: AbortSignal) => Promise<unknown>;
  session?: (signal: AbortSignal) => Promise<AuthUser>;
  eventSource?: ((url: string) => EventSource) | null;
  visible?: () => boolean;
}
export function authScope(user: AuthUser): string {
  return JSON.stringify([user.id, user.role, user.active, [...user.crewIds].sort()]);
}
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const instant = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));

/** One tab-local scheduler for authorized GETs. It never executes business commands. */
export class RealtimeCoordinator {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private source: EventSource | null = null;
  private sourceReady = false;
  private active = false;
  private enabled = false;
  private ended = false;
  private generation = 0;
  private identity: string;
  private reconnectFailures = 0;
  private unavailable = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private controlTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionFlight: Promise<void> | null = null;
  private sessionController: AbortController | null = null;
  private seen = new Set<string>();
  private changedAt: string | null = null;
  private snapshot: LiveStatusSnapshot = {
    mode: 'Reconnecting',
    dataLastSyncedAt: null,
    dataChangedAt: null,
  };
  private readonly read: NonNullable<Options['read']>;
  private readonly session: NonNullable<Options['session']>;
  private readonly factory: Options['eventSource'];
  private readonly visible: NonNullable<Options['visible']>;

  constructor(private readonly options: Options) {
    this.identity = authScope(options.initialUser);
    this.read = options.read ?? ((path, signal) => apiRequest(path, { signal }));
    this.session =
      options.session ??
      (async (signal) => (await apiRequest('/auth/me', { signal, validate: isAuthResponse })).user);
    this.factory =
      options.eventSource === undefined
        ? typeof EventSource === 'undefined'
          ? null
          : (url) => new EventSource(url)
        : options.eventSource;
    this.visible =
      options.visible ??
      (() => document.visibilityState !== 'hidden' && navigator.onLine !== false);
  }
  getStatus = () => this.snapshot;
  subscribeStatus = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private status() {
    const entries = [...this.entries.values()];
    const times = entries.map((entry) => entry.syncedAt);
    const synced =
      times.length && times.every((time) => time !== null)
        ? new Date(Math.min(...(times as number[]))).toISOString()
        : null;
    const mode =
      this.ended || this.unavailable || entries.some((entry) => entry.failures > 0)
        ? 'Unavailable'
        : this.sourceReady
          ? 'Live'
          : !this.factory || this.reconnectFailures >= 3
            ? 'Periodic refresh'
            : 'Reconnecting';
    if (
      this.snapshot.mode !== mode ||
      this.snapshot.dataLastSyncedAt !== synced ||
      this.snapshot.dataChangedAt !== this.changedAt
    )
      this.snapshot = { mode, dataLastSyncedAt: synced, dataChangedAt: this.changedAt };
    this.listeners.forEach((listener) => listener());
  }
  register(path: string, observer: ResourceObserver): () => void {
    const key = resourceKey(path);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        path,
        observers: new Set(),
        value: undefined,
        hasValue: false,
        controller: null,
        flight: null,
        timer: null,
        pending: true,
        epoch: 0,
        lastStarted: -Infinity,
        syncedAt: null,
        failures: 0,
        changes: 0,
      };
      this.entries.set(key, entry);
    }
    entry.observers.add(observer);
    if (entry.hasValue)
      observer.success(
        entry.value,
        entry.syncedAt === null ? null : new Date(entry.syncedAt).toISOString(),
      );
    else observer.pending();
    if (!entry.flight && !entry.hasValue) void this.refresh(path);
    return () => {
      entry!.observers.delete(observer);
      if (!entry!.observers.size) {
        entry!.controller?.abort();
        entry!.epoch++;
        if (entry!.timer) clearTimeout(entry!.timer);
        this.entries.delete(key);
        this.status();
      }
    };
  }
  publish(path: string, value: unknown | ((current: unknown | null) => unknown)) {
    const entry = this.entries.get(resourceKey(path));
    if (!entry) return;
    entry.epoch++;
    entry.controller?.abort();
    entry.controller = null;
    entry.flight = null;
    const next = typeof value === 'function' ? value(entry.hasValue ? entry.value : null) : value;
    if (entry.hasValue && next !== null && JSON.stringify(entry.value) !== JSON.stringify(next)) {
      entry.changes++;
      this.changedAt = new Date().toISOString();
    }
    entry.value = next;
    entry.hasValue = next !== null;
    entry.observers.forEach((observer) =>
      next === null ? observer.clear() : observer.success(next, null),
    );
    if (entry.pending) this.schedule(entry);
    this.status();
  }
  changeStamp(paths: readonly string[]): string {
    return paths.map((path) => this.entries.get(resourceKey(path))?.changes ?? 0).join(':');
  }
  async refresh(path: string): Promise<void> {
    const entry = this.entries.get(resourceKey(path));
    if (!entry) return;
    if (entry.flight) return entry.flight;
    if (!this.active || this.ended) {
      entry.pending = true;
      return;
    }
    if (!this.enabled) {
      entry.pending = true;
      await this.synchronize();
      if (!this.enabled || this.entries.get(resourceKey(path)) !== entry) return;
      if (entry.flight) return entry.flight;
    }
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    return this.run(entry);
  }
  async readCanonical<T>(path: string, validate: (value: unknown) => value is T): Promise<T> {
    const detach = this.register(path, {
      validate,
      pending: () => undefined,
      success: () => undefined,
      failure: () => undefined,
      clear: () => undefined,
    });
    try {
      await this.refresh(path);
      const entry = this.entries.get(resourceKey(path));
      if (!entry?.hasValue || entry.failures > 0 || !validate(entry.value))
        throw new ApiError(0, 'Current data could not be read.');
      return entry.value;
    } finally {
      detach();
    }
  }
  invalidate(topics?: readonly RealtimeTopic[]) {
    for (const entry of this.entries.values()) {
      if (topics && !resourceTopics(entry.path).some((topic) => topics.includes(topic))) continue;
      entry.pending = true;
      this.schedule(entry);
    }
  }
  private schedule(entry: Entry, retryDelay = 0) {
    if (
      entry.timer ||
      entry.flight ||
      !this.active ||
      !this.enabled ||
      this.ended ||
      !this.visible()
    )
      return;
    const interval = resourceKey(entry.path) === '/dashboard' ? 5000 : 2000;
    const due = Math.max(Date.now() + Math.max(250, retryDelay), entry.lastStarted + interval);
    entry.timer = setTimeout(
      () => {
        entry.timer = null;
        if (entry.pending && this.visible()) void this.run(entry);
      },
      Math.max(0, due - Date.now()),
    );
  }
  private run(entry: Entry): Promise<void> {
    if (entry.flight) return entry.flight;
    if (!this.active || !this.enabled || this.ended || !this.visible()) {
      entry.pending = true;
      return Promise.resolve();
    }
    const key = resourceKey(entry.path),
      epoch = ++entry.epoch,
      generation = this.generation;
    const controller = new AbortController();
    entry.controller = controller;
    entry.pending = false;
    entry.lastStarted = Date.now();
    entry.observers.forEach((observer) => observer.pending());
    const current = () =>
      this.active &&
      this.generation === generation &&
      this.entries.get(key) === entry &&
      entry.epoch === epoch &&
      !controller.signal.aborted;
    const flight = Promise.resolve()
      .then(() => this.read(entry.path, controller.signal))
      .then((value) => {
        if (!current()) return;
        if ([...entry.observers].some((observer) => observer.validate && !observer.validate(value)))
          throw new ApiError(0, 'The service returned an invalid response.');
        if (entry.hasValue && JSON.stringify(entry.value) !== JSON.stringify(value)) {
          entry.changes++;
          this.changedAt = new Date().toISOString();
        }
        entry.value = value;
        entry.hasValue = true;
        entry.syncedAt = Date.now();
        entry.failures = 0;
        entry.observers.forEach((observer) =>
          observer.success(value, new Date(entry.syncedAt!).toISOString()),
        );
      })
      .catch((error: unknown) => {
        if (!current()) return;
        if (error instanceof ApiError && error.status === 401) {
          this.expire();
          return;
        }
        if (
          error instanceof ApiError &&
          (error.status === 403 || (error.status === 404 && entry.hasValue))
        ) {
          this.accessReset();
          return;
        }
        entry.failures++;
        entry.pending = !(error instanceof ApiError && error.status === 404);
        entry.observers.forEach((observer) => observer.failure(error));
      })
      .finally(() => {
        if (!current()) return;
        entry.flight = null;
        entry.controller = null;
        if (entry.pending)
          this.schedule(
            entry,
            entry.failures ? Math.min(60000, 2000 * 2 ** Math.min(entry.failures - 1, 5)) : 0,
          );
        this.status();
      });
    entry.flight = flight;
    return flight;
  }
  private closeSource() {
    this.source?.close();
    this.source = null;
    this.sourceReady = false;
  }
  private clearReads() {
    this.generation++;
    this.enabled = false;
    for (const entry of this.entries.values()) {
      entry.epoch++;
      entry.controller?.abort();
      entry.controller = null;
      entry.flight = null;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      entry.value = undefined;
      entry.hasValue = false;
      entry.syncedAt = null;
      entry.pending = true;
      entry.failures = 0;
      entry.changes = 0;
      entry.observers.forEach((observer) => observer.clear());
    }
    this.changedAt = null;
  }
  accessReset() {
    if (!this.active || this.ended) return;
    this.closeSource();
    this.clearReads();
    this.sessionController?.abort();
    this.sessionFlight = null;
    this.options.onAccessReset();
    this.status();
    void this.synchronize();
  }
  expire() {
    if (this.ended) return;
    this.ended = true;
    this.closeSource();
    this.clearReads();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.controlTimer) clearTimeout(this.controlTimer);
    this.controlTimer = null;
    this.sessionController?.abort();
    this.options.onExpired();
    this.status();
  }
  private packet(data: unknown): Record<string, unknown> | null {
    if (typeof data !== 'string' || data.length > 2048) return null;
    try {
      const value: unknown = JSON.parse(data);
      return isRecord(value) && instant(value.emittedAt) ? value : null;
    } catch {
      return null;
    }
  }
  private connect() {
    if (!this.factory || this.source || !this.active || this.ended || !this.visible()) return;
    const source = this.factory('/api/realtime/events');
    this.source = source;
    source.addEventListener('ready', (event) => {
      if (this.source !== source || !this.packet((event as MessageEvent).data)) return;
      this.sourceReady = true;
      this.reconnectFailures = 0;
      this.status();
      // The initial GET may have overlapped the handshake. One queued reread closes that gap.
      this.invalidate();
    });
    source.addEventListener('invalidate', (event) => {
      if (this.source !== source) return;
      const packet = this.packet((event as MessageEvent).data);
      if (
        !packet ||
        typeof packet.eventId !== 'string' ||
        packet.eventId.length > 100 ||
        !Array.isArray(packet.topics) ||
        !packet.topics.length ||
        packet.topics.length > realtimeTopics.length ||
        !packet.topics.every((topic) => realtimeTopics.includes(topic as RealtimeTopic)) ||
        this.seen.has(packet.eventId)
      )
        return;
      this.seen.add(packet.eventId);
      if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value!);
      this.invalidate(packet.topics as RealtimeTopic[]);
    });
    source.addEventListener('access-reset', (event) => {
      if (this.source !== source) return;
      const packet = this.packet((event as MessageEvent).data);
      if (!packet || (packet.reason !== 'SESSION_ENDED' && packet.reason !== 'SCOPE_CHANGED'))
        return;
      if (packet.reason === 'SESSION_ENDED') this.expire();
      else this.accessReset();
    });
    source.onerror = () => {
      if (this.source !== source) return;
      this.closeSource();
      this.reconnectFailures++;
      this.enabled = false;
      this.status();
      this.retry();
    };
  }
  private retry() {
    if (this.retryTimer || !this.active || this.ended || !this.visible()) return;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(Math.max(0, this.reconnectFailures - 1), 5));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.synchronize();
    }, delay);
  }
  async synchronize(): Promise<void> {
    if (this.sessionFlight) return this.sessionFlight;
    if (!this.active || this.ended || !this.visible()) return;
    const controller = new AbortController();
    this.sessionController = controller;
    const generation = this.generation;
    const flight = Promise.resolve()
      .then(() => this.session(controller.signal))
      .then((user) => {
        if (
          !this.active ||
          this.ended ||
          controller.signal.aborted ||
          generation !== this.generation
        )
          return;
        const identity = authScope(user);
        if (identity !== this.identity) {
          this.clearReads();
          this.closeSource();
          this.identity = identity;
          this.options.onAccessReset();
        }
        if (this.options.onSession(user) === false) {
          this.enabled = false;
          this.closeSource();
          return;
        }
        this.enabled = true;
        this.unavailable = false;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.connect();
        for (const entry of this.entries.values()) {
          if (!entry.hasValue) void this.refresh(entry.path);
          else {
            entry.pending = true;
            this.schedule(entry);
          }
        }
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('fd:clock-sync'));
      })
      .catch((error: unknown) => {
        if (!this.active || this.ended || controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) this.expire();
        else {
          this.enabled = false;
          this.unavailable = true;
          this.reconnectFailures++;
          this.retry();
        }
      })
      .finally(() => {
        if (this.sessionController === controller) this.sessionController = null;
        if (this.sessionFlight === flight) this.sessionFlight = null;
        this.status();
      });
    this.sessionFlight = flight;
    return flight;
  }
  private control = () => {
    if (this.controlTimer) clearTimeout(this.controlTimer);
    this.controlTimer = null;
    if (!this.active || this.ended || !this.visible()) return;
    this.controlTimer = setTimeout(() => {
      this.controlTimer = null;
      void this.synchronize();
      this.control();
    }, 60000);
  };
  private resume = () => {
    if (!this.visible()) {
      this.closeSource();
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      if (this.controlTimer) clearTimeout(this.controlTimer);
      this.controlTimer = null;
      return;
    }
    this.control();
    void this.synchronize();
  };
  private localOrders = () =>
    this.invalidate([
      'orders',
      'dashboard',
      'crew-work',
      'evidence',
      'returns',
      'acceptance',
      'completion',
    ]);
  private localPlanning = () =>
    this.invalidate(['planning', 'orders', 'dashboard', 'crew-work', 'returns', 'completion']);
  start() {
    this.active = true;
    this.ended = false;
    window.addEventListener('focus', this.resume);
    window.addEventListener('online', this.resume);
    window.addEventListener('offline', this.resume);
    document.addEventListener('visibilitychange', this.resume);
    window.addEventListener('fd:orders-changed', this.localOrders);
    window.addEventListener('fd:planning-changed', this.localPlanning);
    this.control();
    void this.synchronize();
  }
  stop() {
    this.active = false;
    this.closeSource();
    this.clearReads();
    this.sessionController?.abort();
    this.sessionFlight = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.controlTimer) clearTimeout(this.controlTimer);
    this.retryTimer = null;
    this.controlTimer = null;
    window.removeEventListener('focus', this.resume);
    window.removeEventListener('online', this.resume);
    window.removeEventListener('offline', this.resume);
    document.removeEventListener('visibilitychange', this.resume);
    window.removeEventListener('fd:orders-changed', this.localOrders);
    window.removeEventListener('fd:planning-changed', this.localPlanning);
  }
}
