import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-client';
import { RealtimeCoordinator, type ResourceObserver } from './realtime-coordinator';
import { resourceTopics } from './realtime-resources';
import { deferred, FakeEventSource, realtimeUser, settle } from '../test/realtime-fixture';

const active: RealtimeCoordinator[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2030-01-07T09:00:00.000Z'));
});
afterEach(() => {
  active.splice(0).forEach((coordinator) => coordinator.stop());
  vi.useRealTimers();
});
function setup() {
  let visible = true;
  const sources: FakeEventSource[] = [],
    read = vi.fn<(path: string, signal: AbortSignal) => Promise<unknown>>(async () => ({
      value: 1,
    })),
    session = vi.fn<(signal: AbortSignal) => Promise<typeof realtimeUser>>(
      async () => realtimeUser,
    );
  const onExpired = vi.fn(),
    onAccessReset = vi.fn(),
    onSession = vi.fn();
  const coordinator = new RealtimeCoordinator({
    initialUser: realtimeUser,
    read,
    session,
    visible: () => visible,
    eventSource: (url) => {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source as unknown as EventSource;
    },
    onExpired,
    onAccessReset,
    onSession,
  });
  active.push(coordinator);
  const observer = () => ({
    pending: vi.fn<ResourceObserver['pending']>(),
    success: vi.fn<ResourceObserver['success']>(),
    failure: vi.fn<ResourceObserver['failure']>(),
    clear: vi.fn<ResourceObserver['clear']>(),
  });
  return {
    coordinator,
    read,
    session,
    sources,
    observer,
    onExpired,
    onAccessReset,
    onSession,
    setVisible: (value: boolean) => {
      visible = value;
      document.dispatchEvent(new Event('visibilitychange'));
    },
  };
}
describe('M8 bounded resource coordinator', () => {
  it('treats a previously readable record 404 as scope loss and rejects another old in-flight result', async () => {
    const h = setup(),
      old = deferred<unknown>(),
      observer = h.observer();
    let aReads = 0,
      bReads = 0;
    h.read.mockImplementation(async (path) => {
      if (path === '/crew/assignments/a') {
        if (++aReads === 1) return { value: 'authorized first result' };
        throw new ApiError(404, 'Record unavailable');
      }
      if (++bReads === 1) return old.promise;
      return { value: 'fresh permitted data' };
    });
    h.coordinator.register('/crew/assignments/a', h.observer());
    h.coordinator.register('/crew/assignments/b/acceptance', observer);
    h.coordinator.start();
    await settle();
    h.sources[0]!.invalidate(['crew-work']);
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(h.onAccessReset).toHaveBeenCalledTimes(1);
    expect(observer.clear).toHaveBeenCalled();
    old.resolve({ value: 'late private old assignment' });
    await settle();
    expect(observer.success).toHaveBeenLastCalledWith(
      { value: 'fresh permitted data' },
      expect.any(String),
    );
    expect(
      observer.success.mock.calls.some(
        ([value]) => (value as { value: string }).value === 'late private old assignment',
      ),
    ).toBe(false);
  });
  it('does not reset access repeatedly for an initial not-found URL', async () => {
    const h = setup();
    h.read.mockRejectedValue(new ApiError(404, 'Record unavailable'));
    h.coordinator.register('/crew/assignments/not-found', h.observer());
    h.coordinator.start();
    await settle();
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.onAccessReset).not.toHaveBeenCalled();
    expect(h.read).toHaveBeenCalledTimes(1);
  });
  it('ignores repeated packet IDs and unknown topics after a completed refresh', async () => {
    const h = setup();
    h.coordinator.register('/orders/a', h.observer());
    h.coordinator.start();
    await settle();
    h.sources[0]!.invalidate(['orders'], 'same-packet');
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.read).toHaveBeenCalledTimes(2);
    h.sources[0]!.invalidate(['orders'], 'same-packet');
    h.sources[0]!.invalidate(['not-a-topic']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.read).toHaveBeenCalledTimes(2);
  });
  it('validates session before initial reads, uses one stream and closes the initial GET/ready race', async () => {
    const h = setup(),
      auth = deferred<typeof realtimeUser>(),
      first = deferred<unknown>();
    h.session.mockReturnValueOnce(auth.promise);
    h.read.mockReturnValueOnce(first.promise);
    h.coordinator.register('/orders/a', h.observer());
    h.coordinator.start();
    await settle();
    expect(h.read).not.toHaveBeenCalled();
    auth.resolve(realtimeUser);
    await settle();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.sources).toHaveLength(1);
    expect(h.sources[0]!.url).toBe('/api/realtime/events');
    h.sources[0]!.ready();
    expect(h.coordinator.getStatus().mode).toBe('Live');
    expect(h.coordinator.getStatus().dataLastSyncedAt).toBeNull();
    first.resolve({ value: 1 });
    await settle();
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.coordinator.getStatus().dataLastSyncedAt).not.toBeNull();
  });
  it('coalesces storms without starvation, keeps one read in flight and exactly one pending repeat', async () => {
    const h = setup(),
      next = deferred<unknown>();
    h.coordinator.register('/orders/a', h.observer());
    h.coordinator.start();
    await settle();
    h.read.mockReturnValueOnce(next.promise);
    for (let i = 0; i < 100; i++) h.sources[0]!.invalidate(['orders']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.read).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 100; i++) {
      h.sources[0]!.invalidate(['orders']);
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(h.read).toHaveBeenCalledTimes(2);
    next.resolve({ value: 2 });
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    expect(h.read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.read).toHaveBeenCalledTimes(3);
  });
  it('throttles dashboard at 5 seconds and does not refetch unrelated active resources', async () => {
    const h = setup();
    ['/orders/a', '/dashboard', '/crews'].forEach((path) =>
      h.coordinator.register(path, h.observer()),
    );
    h.coordinator.start();
    await settle();
    h.sources[0]!.invalidate(['orders', 'dashboard']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.read.mock.calls.filter(([path]) => path === '/orders/a')).toHaveLength(2);
    expect(h.read.mock.calls.filter(([path]) => path === '/dashboard')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.read.mock.calls.filter(([path]) => path === '/dashboard')).toHaveLength(2);
    expect(h.read.mock.calls.filter(([path]) => path === '/crews')).toHaveLength(1);
    expect(resourceTopics('/crew/assignments/a/acceptance')).toContain('acceptance');
    expect(resourceTopics('/users')).not.toContain('orders');
  });
  it('deduplicates identical resource keys and joins manual refresh instead of duplicating a read', async () => {
    const h = setup(),
      read = deferred<unknown>(),
      a = h.observer(),
      b = h.observer();
    h.read.mockReturnValueOnce(read.promise);
    h.coordinator.register('/orders?page=1&search=x', a);
    h.coordinator.register('/orders?search=x&page=1', b);
    h.coordinator.start();
    await settle();
    const first = h.coordinator.refresh('/orders?page=1&search=x'),
      second = h.coordinator.refresh('/orders?search=x&page=1');
    expect(h.read).toHaveBeenCalledTimes(1);
    read.resolve({ value: 3 });
    await Promise.all([first, second]);
    expect(a.success).toHaveBeenCalledWith({ value: 3 }, expect.any(String));
    expect(b.success).toHaveBeenCalledWith({ value: 3 }, expect.any(String));
  });
  it('does not advance data timestamps from ready, heartbeat or failed GET and retries with bounded backoff', async () => {
    const h = setup();
    h.read.mockRejectedValue(new ApiError(503, 'Unavailable'));
    h.coordinator.register('/orders/a', h.observer());
    h.coordinator.start();
    await settle();
    h.sources[0]!.ready();
    expect(h.coordinator.getStatus()).toMatchObject({
      mode: 'Unavailable',
      dataLastSyncedAt: null,
    });
    h.sources[0]!.emit('heartbeat', { emittedAt: new Date().toISOString() });
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(h.read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.read).toHaveBeenCalledTimes(3);
    expect(h.coordinator.getStatus().dataLastSyncedAt).toBeNull();
    expect(h.onExpired).not.toHaveBeenCalled();
  });
  it('has one controlled reconnect loop, revalidates session and recovers canonical data', async () => {
    const h = setup();
    h.coordinator.register('/orders/a', h.observer());
    h.coordinator.start();
    await settle();
    const old = h.sources[0]!;
    old.error();
    old.error();
    expect(old.closeCount).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(h.sources).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sources).toHaveLength(2);
    expect(h.session).toHaveBeenCalledTimes(2);
    h.sources[1]!.ready();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.read).toHaveBeenCalledTimes(2);
    old.invalidate(['orders']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.read).toHaveBeenCalledTimes(2);
  });
  it('distinguishes unavailable session checks from confirmed expiry and stops retries after 401', async () => {
    const h = setup();
    h.session.mockRejectedValueOnce(new ApiError(503, 'Offline'));
    h.coordinator.start();
    await settle();
    expect(h.coordinator.getStatus().mode).toBe('Unavailable');
    expect(h.onExpired).not.toHaveBeenCalled();
    h.session.mockRejectedValueOnce(new ApiError(401, 'Expired'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.onExpired).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120000);
    expect(h.session).toHaveBeenCalledTimes(2);
    expect(h.sources).toHaveLength(0);
  });
  it('performs rare control sync even while healthy and pauses reads for a hidden tab', async () => {
    const h = setup();
    h.coordinator.register('/crew/assignments?view=today', h.observer());
    h.coordinator.start();
    await settle();
    h.sources[0]!.ready();
    await vi.advanceTimersByTimeAsync(2000);
    const before = h.read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(58000);
    await vi.advanceTimersByTimeAsync(250);
    expect(h.session).toHaveBeenCalledTimes(2);
    expect(h.read.mock.calls.length).toBe(before + 1);
    h.setVisible(false);
    const hidden = h.read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(180000);
    expect(h.read).toHaveBeenCalledTimes(hidden);
    h.setVisible(true);
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    expect(h.session).toHaveBeenCalledTimes(3);
    expect(h.read.mock.calls.length).toBe(hidden + 1);
  });
  it('ignores late data from an old access generation and clears before reading the new scope', async () => {
    const h = setup(),
      old = deferred<unknown>(),
      observer = h.observer();
    h.read.mockReturnValueOnce(old.promise).mockResolvedValue({ value: 'new scope' });
    h.coordinator.register('/orders/a', observer);
    h.coordinator.start();
    await settle();
    const signal = h.read.mock.calls[0]![1];
    h.session.mockResolvedValue({ ...realtimeUser, crewIds: ['new-team'] });
    await h.coordinator.synchronize();
    await settle();
    expect(signal.aborted).toBe(true);
    expect(observer.clear).toHaveBeenCalled();
    expect(h.onAccessReset).toHaveBeenCalledTimes(1);
    old.resolve({ value: 'private old scope' });
    await settle();
    expect(observer.success).toHaveBeenLastCalledWith({ value: 'new scope' }, expect.any(String));
    expect(
      observer.success.mock.calls.some(
        ([value]) => (value as { value: string }).value === 'private old scope',
      ),
    ).toBe(false);
  });
  it('cannot restore old data after logout and cleans all stream/timer/listener work on stop/start', async () => {
    const h = setup(),
      old = deferred<unknown>(),
      observer = h.observer();
    h.read.mockReturnValueOnce(old.promise);
    h.coordinator.register('/orders/a', observer);
    h.coordinator.start();
    await settle();
    h.coordinator.expire();
    old.resolve({ value: 'old' });
    await settle();
    expect(observer.success).not.toHaveBeenCalled();
    expect(h.sources[0]!.closeCount).toBe(1);
    h.coordinator.stop();
    h.coordinator.start();
    await settle();
    const count = h.session.mock.calls.length;
    h.coordinator.stop();
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(120000);
    expect(h.session).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps a canonical mutation response newer than an older pending read', async () => {
    const h = setup(),
      old = deferred<unknown>(),
      observer = h.observer();
    h.read.mockReturnValueOnce(old.promise);
    h.coordinator.register('/orders/a', observer);
    h.coordinator.start();
    await settle();
    h.coordinator.publish('/orders/a', { value: 'saved canonical response' });
    old.resolve({ value: 'old read' });
    await settle();
    expect(observer.success).toHaveBeenLastCalledWith({ value: 'saved canonical response' }, null);
    expect(observer.success).toHaveBeenCalledTimes(1);
  });
});
