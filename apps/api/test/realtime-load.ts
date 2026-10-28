import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { config as loadDotEnv } from 'dotenv';
import type { INestApplication } from '@nestjs/common';
import type {
  AuthResponse,
  AuthUser,
  CrewAssignmentResponse,
  DashboardResponse,
  EvidenceResponse,
  ExecutionNoteResponse,
  OrderListResponse,
} from '@furniture-delivery/contracts';
import { createApplication } from '../src/application';
import type { AppConfig } from '../src/config/environment';
import { cleanupDemo } from '../src/demo/demo-lifecycle';
import { prepareDemo } from '../src/demo/demo-prepare';
import {
  demoPaths,
  demoRunId,
  demoTargetConfig,
  loadDemoState,
  readPrivateJson,
  runConfig,
  writePrivateJson,
} from '../src/demo/demo-run-state';
import type { DemoCredential, DemoRunState } from '../src/demo/demo-types';
import { RealtimeHub } from '../src/realtime/realtime-hub';
import { ApiError } from '../../web/lib/api-client';
import { RealtimeCoordinator } from '../../web/lib/realtime-coordinator';
import { isAuthResponse } from '../../web/lib/session';

type Resource = 'dashboard' | 'orders' | 'evidence';
interface ReadSample {
  resource: Resource;
  phase: 'initial' | 'measurement';
  startedAt: number;
  durationMs: number;
  status: number;
}
interface TransportCounts {
  ready: number;
  invalidate: number;
  accessReset: number;
  failures: number;
  lastFailure: string | null;
}
class LoadFailure extends Error {}
function requireLoad(value: unknown, code: string): asserts value {
  if (!value) throw new LoadFailure(code);
}
const sleep = (milliseconds: number) => new Promise<void>((done) => setTimeout(done, milliseconds));
async function until(predicate: () => boolean, code: string, milliseconds = 8000) {
  const end = performance.now() + milliseconds;
  while (!predicate()) {
    if (performance.now() >= end) throw new LoadFailure(code);
    await sleep(20);
  }
}
const rounded = (value: number) => Math.round(value * 100) / 100;

/** Finite Node HTTP adapter for the actual coordinator; never a browser or a mocked API. */
class HttpEventSource extends EventTarget {
  onerror: ((event: Event) => void) | null = null;
  readonly completion: Promise<void>;
  private readonly controller = new AbortController();
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private closed = false;
  constructor(
    private readonly url: string,
    private readonly cookie: string,
    private readonly counts: TransportCounts,
  ) {
    super();
    this.completion = this.consume().catch((error: unknown) => {
      if (!this.closed) {
        this.counts.failures++;
        this.counts.lastFailure =
          error instanceof LoadFailure ? error.message : 'SSE_HTTP_STREAM_FAILED';
        this.onerror?.(new Event('error'));
      }
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    void this.reader?.cancel().catch(() => undefined);
  }
  private async consume() {
    const startup = setTimeout(() => this.controller.abort(), 5000);
    try {
      const response = await fetch(this.url, {
        signal: this.controller.signal,
        headers: { Cookie: this.cookie, Origin: 'http://127.0.0.1:3000' },
      });
      clearTimeout(startup);
      if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
        await response.body?.cancel();
        throw new LoadFailure('SSE_HANDSHAKE_REJECTED');
      }
      this.reader = response.body?.getReader();
      requireLoad(this.reader, 'SSE_BODY_MISSING');
      const decoder = new TextDecoder();
      let buffer = '';
      while (!this.closed) {
        const next = await this.reader.read();
        if (next.done) break;
        buffer = (buffer + decoder.decode(next.value, { stream: true })).replaceAll('\r\n', '\n');
        requireLoad(buffer.length <= 32768, 'SSE_BUFFER_LIMIT');
        let index: number;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const lines = frame.split('\n'),
            type = lines
              .find((line) => line.startsWith('event:'))
              ?.slice(6)
              .trim(),
            data = lines
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n');
          if (!data || !type) continue;
          requireLoad(data.length <= 2048, 'SSE_PACKET_LIMIT');
          if (type === 'ready') this.counts.ready++;
          if (type === 'invalidate') this.counts.invalidate++;
          if (type === 'access-reset') this.counts.accessReset++;
          this.dispatchEvent(new MessageEvent(type, { data }));
        }
      }
      if (!this.closed) throw new LoadFailure('SSE_ENDED_DURING_MEASUREMENT');
    } finally {
      clearTimeout(startup);
      this.reader?.releaseLock();
    }
  }
}

function platformShim() {
  requireLoad(
    typeof window === 'undefined' && typeof document === 'undefined',
    'NODE_ONLY_PROGRAM',
  );
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'),
    oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: new EventTarget() });
  return () => {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  };
}

async function main() {
  requireLoad(process.versions.node === '24.22.1', 'PINNED_NODE_24_22_1_REQUIRED');
  const root = await realpath(resolve(__dirname, '../../..')),
    args = process.argv.slice(2);
  requireLoad(args.length === 2 && args[0] === '--run', 'EXPLICIT_NEW_RUN_REQUIRED');
  const runId = demoRunId(args[1]!),
    paths = demoPaths(root, runId);
  try {
    await lstat(paths.directory);
    throw new LoadFailure('EXISTING_RUN_REFUSED');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  loadDotEnv({ path: join(root, '.env'), quiet: true });
  let config: AppConfig | undefined,
    state: DemoRunState | undefined,
    app: INestApplication | undefined;
  let coordinator: RealtimeCoordinator | undefined, restorePlatform: (() => void) | undefined;
  let diagnosticMetrics: () => Record<string, unknown> = () => ({});
  let stage = 'prepare',
    failure: unknown,
    result: Record<string, unknown> | undefined;
  const secrets = new Set<string>(),
    sources: HttpEventSource[] = [],
    detach: (() => void)[] = [];
  const counts: TransportCounts = {
    ready: 0,
    invalidate: 0,
    accessReset: 0,
    failures: 0,
    lastFailure: null,
  };
  try {
    config = demoTargetConfig(process.env);
    for (const value of Object.values(config.database))
      if (typeof value === 'string') secrets.add(value);
    const prepared = await prepareDemo(root, runId, config);
    requireLoad(
      !prepared.repeated && prepared.manifest.counts.orders === 40,
      'NEW_40_ORDER_RUN_REQUIRED',
    );
    state = await loadDemoState(root, runId, config);
    secrets.add(state.schema);
    const credentials = await readPrivateJson<{
      version: number;
      synthetic: boolean;
      runId: string;
      accounts: DemoCredential[];
    }>(paths.credentials);
    requireLoad(
      credentials.version === 1 && credentials.synthetic && credentials.runId === runId,
      'PRIVATE_CREDENTIAL_OWNER_MISMATCH',
    );
    for (const account of credentials.accounts) {
      secrets.add(account.username);
      secrets.add(account.password);
    }
    const selected = prepared.manifest.orders.find((entry) => entry.scenario === 'active')!,
      assignment = selected?.crewAssignments[0];
    requireLoad(selected && assignment, 'ACTIVE_SYNTHETIC_ASSIGNMENT_MISSING');
    const dpCredential = credentials.accounts.find((account) => account.role === 'DISPATCHER'),
      crewCredential = credentials.accounts.find(
        (account) => account.role === 'CREW_MEMBER' && account.crewCode === assignment.crewCode,
      );
    requireLoad(dpCredential && crewCredential, 'SYNTHETIC_ACCOUNTS_MISSING');
    app = await createApplication(runConfig(config, state, root));
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl(),
      hub = app.get(RealtimeHub);
    async function http<T>(
      path: string,
      cookie?: string,
      method = 'GET',
      body?: unknown,
      signal?: AbortSignal,
    ) {
      const response = await fetch(base + '/api' + path, {
        method,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
          : AbortSignal.timeout(8000),
        headers: {
          Origin: 'http://127.0.0.1:3000',
          ...(cookie ? { Cookie: cookie } : {}),
          ...(method === 'GET' ? {} : { 'X-CSRF-Protection': '1' }),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ApiError(response.status, 'Load HTTP request rejected.');
      }
      return { value: (await response.json()) as T, response };
    }
    async function login(account: DemoCredential) {
      const response = await http<AuthResponse>('/auth/login', undefined, 'POST', {
        username: account.username,
        password: account.password,
      });
      requireLoad(
        isAuthResponse(response.value) && response.value.user.role === account.role,
        'LOGIN_ROLE_MISMATCH',
      );
      const cookie = response.response.headers.get('set-cookie')?.match(/fd_session=[^;]+/)?.[0];
      requireLoad(cookie, 'LOGIN_COOKIE_MISSING');
      secrets.add(cookie);
      secrets.add(cookie.slice('fd_session='.length));
      return { user: response.value.user, cookie };
    }
    stage = 'login';
    const dispatcher = await login(dpCredential),
      crew = await login(crewCredential);
    const own = (
      await http<CrewAssignmentResponse>(
        '/crew/assignments/' + assignment.assignmentId,
        crew.cookie,
      )
    ).value;
    requireLoad(
      own.assignment.execution.status === 'IN_PROGRESS' && own.assignment.canAppendEvidence,
      'SENDER_NOT_ACTIVE_OWN_ASSIGNMENT',
    );
    const ordersPath = '/orders?page=1&pageSize=50',
      evidencePath = '/orders/' + selected.orderId + '/evidence';
    const resources = new Map<string, Resource>([
      ['/dashboard', 'dashboard'],
      [ordersPath, 'orders'],
      [evidencePath, 'evidence'],
    ]);
    const values = new Map<Resource, unknown>(),
      samples: ReadSample[] = [];
    let phase: ReadSample['phase'] = 'initial',
      sessionReads = 0,
      readFailures = 0,
      accessResets = 0,
      expired = 0,
      inFlight = 0;
    diagnosticMetrics = () => ({
      phase,
      sessionReads,
      readFailures,
      accessResets,
      expired,
      inFlight,
      readSamples: samples,
    });
    restorePlatform = platformShim();
    coordinator = new RealtimeCoordinator({
      initialUser: dispatcher.user,
      onSession: (user: AuthUser) => user.id === dispatcher.user.id && user.role === 'DISPATCHER',
      onAccessReset: () => {
        accessResets++;
      },
      onExpired: () => {
        expired++;
      },
      visible: () => true,
      session: async (signal) => {
        sessionReads++;
        const response = await http<AuthResponse>(
          '/auth/me',
          dispatcher.cookie,
          'GET',
          undefined,
          signal,
        );
        requireLoad(isAuthResponse(response.value), 'INVALID_CANONICAL_SESSION');
        return response.value.user;
      },
      eventSource: (url) => {
        requireLoad(url === '/api/realtime/events', 'UNEXPECTED_STREAM_PATH');
        const source = new HttpEventSource(base + url, dispatcher.cookie, counts);
        sources.push(source);
        return source as unknown as EventSource;
      },
      read: async (path, signal) => {
        const resource = resources.get(path);
        requireLoad(resource, 'UNREGISTERED_RESOURCE_READ');
        const start = performance.now(),
          startedAt = Date.now(),
          readPhase = phase;
        let status = 0;
        inFlight++;
        try {
          const response = await http<unknown>(path, dispatcher.cookie, 'GET', undefined, signal);
          status = response.response.status;
          return response.value;
        } catch (error) {
          if (error instanceof ApiError) status = error.status;
          throw error;
        } finally {
          inFlight--;
          samples.push({
            resource,
            phase: readPhase,
            startedAt,
            durationMs: rounded(performance.now() - start),
            status,
          });
        }
      },
    });
    for (const [path, resource] of resources)
      detach.push(
        coordinator.register(path, {
          pending: () => undefined,
          success: (value) => {
            values.set(resource, value);
          },
          failure: () => {
            readFailures++;
          },
          clear: () => {
            values.delete(resource);
          },
        }),
      );
    stage = 'initial-live-read';
    coordinator.start();
    await until(
      () => values.size === resources.size && coordinator!.getStatus().mode === 'Live',
      'INITIAL_LIVE_READ_TIMEOUT',
    );
    // Let the ready-event queued canonical reread finish before measuring the mutation burst.
    await sleep(5500);
    await until(() => inFlight === 0, 'INITIAL_READS_DID_NOT_SETTLE');
    const initialDashboard = values.get('dashboard') as DashboardResponse,
      initialOrders = values.get('orders') as OrderListResponse,
      initialEvidence = values.get('evidence') as EvidenceResponse,
      initialOrder = initialOrders.orders.find((entry) => entry.id === selected.orderId);
    requireLoad(
      initialOrders.total === 40 && initialOrders.orders.length === 40 && initialOrder,
      'FORTY_CANONICAL_ORDERS_REQUIRED',
    );
    const financial = (dashboard: DashboardResponse) => [
      dashboard.orderTotalCents,
      dashboard.paidCents,
      dashboard.balanceCents,
      dashboard.completedCount,
    ];
    const baselineFinancial = financial(initialDashboard),
      baseVersion = initialOrder.version,
      baseNotes = initialEvidence.notes.length;
    const initialPacketCount = counts.invalidate,
      measurementStart = performance.now(),
      noteIds = new Set<string>();
    phase = 'measurement';
    stage = 'twenty-http-mutations';
    for (let index = 0; index < 20; index++) {
      const note = (
        await http<ExecutionNoteResponse>(
          '/crew/assignments/' + assignment.assignmentId + '/notes',
          crew.cookie,
          'POST',
          { operationKey: randomUUID(), text: 'SYNTHETIC M8 LOAD NOTE ' + String(index + 1) },
        )
      ).value.note;
      requireLoad(note.visibility === 'CREW_VISIBLE', 'NOTE_VISIBILITY_CHANGED');
      noteIds.add(note.id);
    }
    requireLoad(noteIds.size === 20, 'MUTATION_COUNT_MISMATCH');
    stage = 'stream-driven-canonical-settlement';
    await sleep(6000);
    await until(() => {
      const list = values.get('orders') as OrderListResponse | undefined,
        evidence = values.get('evidence') as EvidenceResponse | undefined;
      return (
        list?.orders.find((entry) => entry.id === selected.orderId)?.version === baseVersion + 20 &&
        evidence?.notes.length === baseNotes + 20 &&
        [...noteIds].every((id) => evidence.notes.some((note) => note.id === id)) &&
        samples.some(
          (sample) => sample.phase === 'measurement' && sample.resource === 'dashboard',
        ) &&
        inFlight === 0
      );
    }, 'LIVE_CANONICAL_READ_DID_NOT_REACH_LAST_COMMIT');
    requireLoad(
      counts.invalidate > initialPacketCount && counts.ready >= 1,
      'NO_REAL_STREAM_INVALIDATION',
    );
    requireLoad(
      readFailures === 0 && counts.failures === 0 && accessResets === 0 && expired === 0,
      'LOAD_TRANSPORT_OR_READ_FAILURE',
    );
    requireLoad(
      coordinator.getStatus().mode === 'Live' && coordinator.getStatus().dataLastSyncedAt !== null,
      'FINAL_READ_NOT_LIVE',
    );
    const finalDashboard = values.get('dashboard') as DashboardResponse;
    requireLoad(
      JSON.stringify(financial(finalDashboard)) === JSON.stringify(baselineFinancial),
      'FINANCIAL_OR_COMPLETION_COUNTER_CHANGED',
    );
    const dashboardSamples = samples
        .filter((sample) => sample.resource === 'dashboard')
        .sort((a, b) => a.startedAt - b.startedAt),
      dashboardIntervals = dashboardSamples
        .slice(1)
        .map((sample, index) => sample.startedAt - dashboardSamples[index]!.startedAt);
    requireLoad(
      dashboardIntervals.length >= 2 && dashboardIntervals.every((interval) => interval >= 5000),
      'DASHBOARD_AUTOMATIC_INTERVAL_BELOW_5000_MS',
    );
    const readCounts = (selectedPhase: ReadSample['phase']) => ({
      dashboard: samples.filter(
        (sample) => sample.phase === selectedPhase && sample.resource === 'dashboard',
      ).length,
      orders: samples.filter(
        (sample) => sample.phase === selectedPhase && sample.resource === 'orders',
      ).length,
      evidence: samples.filter(
        (sample) => sample.phase === selectedPhase && sample.resource === 'evidence',
      ).length,
    });
    const burstReads = readCounts('measurement');
    requireLoad(
      Object.values(burstReads).every((count) => count > 0 && count < 20) &&
        Object.values(burstReads).reduce((sum, count) => sum + count, 0) < 20,
      'READS_NOT_COALESCED_BELOW_MUTATION_COUNT',
    );
    result = {
      kind: 'programmatic-http-coordinator-load-not-browser',
      status: 'PASS',
      orders: initialOrders.total,
      mutations: noteIds.size,
      reads: { initial: readCounts('initial'), measurement: burstReads, session: sessionReads },
      httpReadDurationsMs: Object.fromEntries(
        (['dashboard', 'orders', 'evidence'] as const).map((resource) => [
          resource,
          samples
            .filter((sample) => sample.resource === resource)
            .map((sample) => sample.durationMs),
        ]),
      ),
      dashboardAutomaticStartIntervalsMs: dashboardIntervals,
      measurementDurationMs: rounded(performance.now() - measurementStart),
      sse: {
        connections: sources.length,
        ready: counts.ready,
        invalidate: counts.invalidate,
        accessReset: counts.accessReset,
        failures: counts.failures,
      },
      financialSumsChanged: financial(finalDashboard)
        .slice(0, 3)
        .filter((value, index) => value !== baselineFinancial[index]).length,
      completedCountChanged: finalDashboard.completedCount - initialDashboard.completedCount,
      canonicalOrderVersionIncrease:
        (values.get('orders') as OrderListResponse).orders.find(
          (entry) => entry.id === selected.orderId,
        )!.version - baseVersion,
      canonicalNoteIncrease: (values.get('evidence') as EvidenceResponse).notes.length - baseNotes,
    };
    stage = 'transport-cleanup';
    coordinator.stop();
    coordinator = undefined;
    detach.splice(0).forEach((stop) => stop());
    for (const source of sources) source.close();
    await Promise.all(sources.map((source) => source.completion));
    await until(
      () =>
        hub.inspect().connections === 0 &&
        hub.inspect().setups === 0 &&
        hub.inspect().authInFlight === 0 &&
        hub.inspect().timers === 0 &&
        hub.inspect().queuedHints === 0,
      'SSE_CLEANUP_DID_NOT_SETTLE',
    );
  } catch (error) {
    failure = error;
  } finally {
    coordinator?.stop();
    detach.splice(0).forEach((stop) => stop());
    for (const source of sources) source.close();
    await Promise.all(sources.map((source) => source.completion));
    try {
      await app?.close();
    } catch (error) {
      if (!failure) {
        failure = error;
        stage = 'application-cleanup';
      }
    }
    restorePlatform?.();
  }
  if (!failure) {
    stage = 'owned-resource-cleanup';
    try {
      await cleanupDemo(root, runId, config!);
    } catch (error) {
      failure = error;
    }
  }
  if (failure) {
    let message = failure instanceof Error ? failure.message : 'Unknown load failure.';
    for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length))
      message = message.split(secret).join('[REDACTED]');
    message = message
      .replace(/fd_session=[^;\s]+/g, 'fd_session=[REDACTED]')
      .replace(/postgres(?:ql)?:\/\/\S+/gi, '[REDACTED_DATABASE_URL]');
    if (state && config) {
      try {
        const current = await loadDemoState(root, runId, config);
        requireLoad(current.owner.ownerId === state.owner.ownerId, 'DIAGNOSTIC_OWNER_MISMATCH');
        await writePrivateJson(
          join(paths.directory, 'realtime-load-diagnostic.json'),
          {
            kind: 'programmatic-http-coordinator-load-not-browser',
            stage,
            error: message,
            sse: counts,
            metrics: diagnosticMetrics(),
            result: result ?? null,
            ...(failure instanceof ApiError ? { httpStatus: failure.status } : {}),
          },
          true,
        );
      } catch {
        /* Never write into an unverified or already removed fixture. */
      }
    }
    console.error(
      JSON.stringify({
        status: 'FAIL',
        stage,
        error:
          failure instanceof LoadFailure
            ? message
            : 'Inspect private realtime-load-diagnostic.json for the safe error; owned run preserved.',
        ...(failure instanceof ApiError ? { httpStatus: failure.status } : {}),
      }),
    );
    process.exitCode = 1;
    return;
  }
  console.info(JSON.stringify({ ...result, ownedFixtureCleaned: true }));
}
if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        status: 'FAIL',
        stage: 'arguments-or-target',
        error:
          error instanceof LoadFailure
            ? error.message
            : 'Use a new explicit owned --run and the pinned runtime; no existing fixture was adopted.',
      }),
    );
    process.exitCode = 1;
  });
