import { EventSubscriber } from 'typeorm';
import type {
  DataSource,
  EntityManager,
  EntitySubscriberInterface,
  QueryRunner,
  TransactionCommitEvent,
  TransactionRollbackEvent,
  TransactionStartEvent,
} from 'typeorm';
import type { RealtimeTopic } from '@furniture-delivery/contracts';

/** Internal targeting information. Never serialize this object to an SSE response. */
export interface RealtimeChange {
  backoffice: readonly RealtimeTopic[];
  crew?: readonly RealtimeTopic[];
  orderId?: string;
  crewIds?: readonly string[];
  listCrewIds?: readonly string[];
  userId?: string;
  sessionId?: string;
}
export const MAX_TRANSACTION_HINTS = 256;
const frames = new WeakMap<QueryRunner, Map<string, RealtimeChange>[]>();
const publishers = new WeakMap<
  DataSource,
  (changes: readonly RealtimeChange[]) => void | Promise<void>
>();
export function realtimeChangeKey(change: RealtimeChange): string {
  return JSON.stringify([
    change.orderId,
    change.crewIds,
    change.listCrewIds,
    change.userId,
    change.sessionId,
    change.backoffice,
    change.crew,
  ]);
}
function put(frame: Map<string, RealtimeChange>, change: RealtimeChange): void {
  const key = realtimeChangeKey(change);
  if (!frame.has(key) && frame.size >= MAX_TRANSACTION_HINTS)
    frame.delete(frame.keys().next().value!);
  frame.set(key, change);
}
/** Marks are explicitly made by effective business mutations inside their existing transaction. */
export function markRealtime(manager: EntityManager, change: RealtimeChange): void {
  const runner = manager.queryRunner;
  if (!runner?.isTransactionActive) return;
  const frame = frames.get(runner)?.at(-1);
  if (!frame) return;
  put(frame, {
    ...change,
    backoffice: [...change.backoffice],
    ...(change.crew ? { crew: [...change.crew] } : {}),
    ...(change.crewIds ? { crewIds: [...change.crewIds].sort() } : {}),
    ...(change.listCrewIds ? { listCrewIds: [...change.listCrewIds].sort() } : {}),
  });
}

export function registerRealtimePublisher(
  source: DataSource,
  publish: (changes: readonly RealtimeChange[]) => void | Promise<void>,
): () => void {
  publishers.set(source, publish);
  return () => {
    if (publishers.get(source) === publish) publishers.delete(source);
  };
}
@EventSubscriber()
export class RealtimeCommitSubscriber implements EntitySubscriberInterface {
  afterTransactionStart(event: TransactionStartEvent): void {
    const stack = frames.get(event.queryRunner) ?? [];
    stack.push(new Map());
    frames.set(event.queryRunner, stack);
  }
  afterTransactionRollback(event: TransactionRollbackEvent): void {
    const stack = frames.get(event.queryRunner);
    if (!stack) return;
    stack.pop();
    if (!event.queryRunner.isTransactionActive || !stack.length) frames.delete(event.queryRunner);
  }
  afterTransactionCommit(event: TransactionCommitEvent): void {
    const runner = event.queryRunner,
      stack = frames.get(runner);
    if (!stack) return;
    const frame = stack.pop();
    if (runner.isTransactionActive) {
      const parent = stack.at(-1);
      if (!parent) {
        frames.delete(runner);
        return;
      }
      for (const change of frame?.values() ?? []) put(parent, change);
      return;
    }
    frames.delete(runner);
    // isTransactionActive becomes false only after the outer PostgreSQL COMMIT.
    // An unexpected lifecycle stack is fail-closed rather than publishing an uncommitted scope.
    if (stack.length) return;
    const publisher = publishers.get(event.connection),
      changes = [...(frame?.values() ?? [])];
    // Never hold the business QueryRunner while waiting for subscriber authorization/network I/O.
    if (publisher && changes.length)
      queueMicrotask(() => {
        try {
          void Promise.resolve(publisher(changes)).catch(() => undefined);
        } catch {
          /* best-effort delivery */
        }
      });
  }
}
