import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-client';
import { useCommandAttempt } from './use-command-attempt';

interface Input {
  operationKey: string;
  expectedVersion: number;
  summary: string;
  quantities: { delivered: number; assembled: number };
}
interface Result {
  id: string;
  version: number;
}
const payload = (summary = 'Unchanged finish draft'): Input => ({
  operationKey: 'fixed-operation-key',
  expectedVersion: 3,
  summary,
  quantities: { delivered: 2, assembled: 1 },
});
const savedResult: Result = { id: 'assignment-result', version: 4 };
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe('M5 bounded JSON commands retain one frozen attempt across unknown outcomes', () => {
  it('prevents same-tick duplicate submit/retry calls before React has rendered pending state', async () => {
    const result = deferred<Result>(),
      send = vi.fn<(input: Input) => Promise<Result>>().mockReturnValue(result.promise),
      onSaved = vi.fn();
    const { result: hook } = renderHook(() => useCommandAttempt({ send, onSaved }));
    act(() => {
      void hook.current.submit(payload());
      void hook.current.submit(payload('Unintended second click'));
      void hook.current.retry();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(hook.current.pending).toBe(true);
    expect(hook.current.locked).toBe(true);
    await act(async () => result.resolve(savedResult));
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(savedResult);
    expect(hook.current).toMatchObject({
      pending: false,
      unknown: false,
      locked: false,
      error: null,
    });
    await act(async () => {
      await hook.current.retry();
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([0, 503])(
    'retries the identical cloned key/payload and original route after unknown HTTP %s',
    async (status) => {
      const first = deferred<Result>(),
        oldSend = vi
          .fn<(input: Input) => Promise<Result>>()
          .mockReturnValueOnce(first.promise)
          .mockResolvedValueOnce(savedResult),
        newSend = vi.fn<(input: Input) => Promise<Result>>(),
        onSaved = vi.fn();
      const { result, rerender } = renderHook(({ send }) => useCommandAttempt({ send, onSaved }), {
        initialProps: { send: oldSend },
      });
      const input = payload(),
        expected = structuredClone(input);
      act(() => {
        void result.current.submit(input);
      });
      input.summary = 'User changed a different form';
      input.quantities.delivered = 3;
      await act(async () => first.reject(new ApiError(status, 'Unconfirmed save fixture')));
      expect(result.current).toMatchObject({ pending: false, unknown: true, locked: true });
      expect(result.current.error).toBe('Unconfirmed save fixture');
      expect(onSaved).not.toHaveBeenCalled();
      rerender({ send: newSend });
      await act(async () => {
        await result.current.retry();
      });
      expect(oldSend).toHaveBeenCalledTimes(2);
      expect(newSend).not.toHaveBeenCalled();
      expect(oldSend.mock.calls[0]![0]).toEqual(expected);
      expect(oldSend.mock.calls[1]![0]).toEqual(expected);
      expect(oldSend.mock.calls[0]![0]).not.toBe(input);
      expect(onSaved).toHaveBeenCalledExactlyOnceWith(savedResult);
      expect(result.current).toMatchObject({ unknown: false, locked: false });
    },
  );
  it('retains the original attempt when a new submit is accidentally invoked while the previous outcome remains unknown', async () => {
    const send = vi
        .fn<(input: Input) => Promise<Result>>()
        .mockRejectedValueOnce(new Error('Lost response'))
        .mockResolvedValueOnce(savedResult),
      onSaved = vi.fn();
    const { result } = renderHook(() => useCommandAttempt({ send, onSaved }));
    const original = payload();
    await act(async () => {
      await result.current.submit(original);
    });
    expect(result.current.unknown).toBe(true);
    await act(async () => {
      await result.current.submit({
        ...payload('Different assignment draft'),
        operationKey: 'new-operation-key',
      });
    });
    expect(send.mock.calls[1]![0]).toEqual(original);
    expect(send.mock.calls[1]![0].operationKey).toBe('fixed-operation-key');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
  it('treats a definite 409 as an editable stale draft, never changes its expected version and allows an explicit new attempt', async () => {
    const send = vi
        .fn<(input: Input) => Promise<Result>>()
        .mockRejectedValueOnce(new ApiError(409, 'Reload current task version'))
        .mockResolvedValueOnce(savedResult),
      onSaved = vi.fn();
    const { result } = renderHook(() => useCommandAttempt({ send, onSaved }));
    const draft = payload();
    await act(async () => {
      await result.current.submit(draft);
    });
    expect(result.current).toMatchObject({
      pending: false,
      unknown: false,
      locked: false,
      error: 'Reload current task version',
    });
    expect(draft.expectedVersion).toBe(3);
    expect(draft.summary).toBe('Unchanged finish draft');
    expect(onSaved).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.retry();
    });
    expect(send).toHaveBeenCalledTimes(1);
    const reviewed = { ...draft, operationKey: 'explicit-reviewed-new-key', expectedVersion: 5 };
    await act(async () => {
      await result.current.submit(reviewed);
    });
    expect(send.mock.calls[1]![0]).toEqual(reviewed);
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(savedResult);
  });
  it.each([401, 403, 404])(
    'clears the attempt and reports lost access after definite HTTP %s',
    async (status) => {
      const send = vi
          .fn<(input: Input) => Promise<Result>>()
          .mockRejectedValue(new ApiError(status, 'Access unavailable')),
        onSaved = vi.fn(),
        onAccessLost = vi.fn();
      const { result } = renderHook(() => useCommandAttempt({ send, onSaved, onAccessLost }));
      await act(async () => {
        await result.current.submit(payload());
      });
      expect(result.current).toMatchObject({ pending: false, unknown: false, locked: false });
      expect(onAccessLost).toHaveBeenCalledTimes(1);
      expect(onSaved).not.toHaveBeenCalled();
      await act(async () => {
        await result.current.retry();
      });
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it('does not publish late results or access callbacks after the assignment editor unmounts', async () => {
    const completion = deferred<Result>(),
      send = vi.fn<(input: Input) => Promise<Result>>().mockReturnValue(completion.promise),
      onSaved = vi.fn(),
      onAccessLost = vi.fn();
    const { result, unmount } = renderHook(() =>
      useCommandAttempt({ send, onSaved, onAccessLost }),
    );
    act(() => {
      void result.current.submit(payload());
    });
    unmount();
    await act(async () => completion.resolve(savedResult));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onAccessLost).not.toHaveBeenCalled();
    const failure = deferred<Result>(),
      failedSend = vi.fn<(input: Input) => Promise<Result>>().mockReturnValue(failure.promise),
      second = renderHook(() => useCommandAttempt({ send: failedSend, onSaved, onAccessLost }));
    act(() => {
      void second.result.current.submit(payload());
    });
    second.unmount();
    await act(async () => failure.reject(new ApiError(403, 'Old assignment no longer available')));
    expect(onAccessLost).not.toHaveBeenCalled();
  });
});
