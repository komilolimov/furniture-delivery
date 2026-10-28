import { performance } from 'node:perf_hooks';

export interface TestStreamEvent {
  type: string;
  data: Record<string, unknown>;
}

/** HTTP streaming test client only: never drives a browser or prints a session cookie. */
export async function connectTestStream(
  base: string,
  cookie: string,
  options: { origin?: string; headers?: Record<string, string> } = {},
) {
  const controller = new AbortController();
  const response = await fetch(base + '/api/realtime/events', {
    signal: controller.signal,
    headers: {
      Cookie: cookie,
      Origin: options.origin ?? 'http://127.0.0.1:3000',
      ...options.headers,
    },
  });
  const queue: TestStreamEvent[] = [];
  const waiters = new Set<{
    type: string;
    resolve: (event: TestStreamEvent | undefined) => void;
  }>();
  let ended = false;
  let buffer = '';
  const reader = response.body?.getReader();
  function accept(frame: string) {
    let type = 'message';
    const data: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    const parsed: unknown = JSON.parse(data.join('\n'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new Error('Stream returned a non-object packet.');
    const event = { type, data: parsed as Record<string, unknown> };
    const waiter = [...waiters].find((entry) => entry.type === type);
    if (waiter) {
      waiters.delete(waiter);
      waiter.resolve(event);
    } else {
      if (queue.length >= 64) throw new Error('Test stream queue exceeded its bound.');
      queue.push(event);
    }
  }
  const completion = (async () => {
    if (!reader) return;
    const decoder = new TextDecoder();
    try {
      while (!controller.signal.aborted) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch {
          // A fail-closed server may terminate the socket. This is transport closure,
          // while malformed packets below still reject completion and fail the test.
          break;
        }
        if (chunk.done) break;
        buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replaceAll('\r\n', '\n');
        if (buffer.length > 32768) throw new Error('Stream frame exceeded test bound.');
        let index: number;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          accept(frame);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      ended = true;
      for (const waiter of waiters) waiter.resolve(undefined);
      waiters.clear();
    }
  })();
  // Preserve a rejection for close(), while avoiding an unhandled rejection during assertions.
  void completion.catch(() => undefined);
  async function take(type: string, milliseconds = 1600): Promise<TestStreamEvent | undefined> {
    const index = queue.findIndex((entry) => entry.type === type);
    if (index >= 0) return queue.splice(index, 1)[0];
    if (ended) return undefined;
    return new Promise((resolve) => {
      const waiter = {
        type,
        resolve: (event: TestStreamEvent | undefined) => {
          clearTimeout(timer);
          resolve(event);
        },
      };
      const timer = setTimeout(() => {
        waiters.delete(waiter);
        resolve(undefined);
      }, milliseconds);
      waiters.add(waiter);
    });
  }
  return {
    response,
    take,
    get ended() {
      return ended;
    },
    async close() {
      controller.abort();
      await reader?.cancel().catch(() => undefined);
      await completion;
    },
  };
}

export async function untilTestCondition(predicate: () => boolean, milliseconds = 1200) {
  const end = performance.now() + milliseconds;
  while (!predicate()) {
    if (performance.now() >= end) throw new Error('Bounded streaming cleanup did not complete.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
