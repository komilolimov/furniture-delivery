import type { AuthUser } from '@furniture-delivery/contracts';
export const realtimeUser: AuthUser = {
  id: 'realtime-user',
  username: 'fixture.dispatcher',
  displayName: 'Fixture dispatcher',
  role: 'DISPATCHER',
  active: true,
  crewIds: [],
};
export class FakeEventSource extends EventTarget {
  onerror: ((event: Event) => void) | null = null;
  closeCount = 0;
  constructor(readonly url: string) {
    super();
  }
  close() {
    this.closeCount++;
  }
  emit(name: string, data: object) {
    this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }));
  }
  error() {
    this.onerror?.(new Event('error'));
  }
  invalidate(topics: string[], id = crypto.randomUUID()) {
    this.emit('invalidate', { eventId: id, emittedAt: new Date().toISOString(), topics });
  }
  ready() {
    this.emit('ready', { emittedAt: new Date().toISOString() });
  }
}
export const settle = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
