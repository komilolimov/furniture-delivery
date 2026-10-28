import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from './api-client';
import { useApiResource } from './use-api-resource';
import { useOrderResource } from './use-order-resource';

vi.mock('./api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api-client')>()),
  apiRequest: vi.fn(),
}));
const apiMock = vi.mocked(apiRequest);
interface Fixture {
  id: string;
  value: string;
}
const value = (text: string): Fixture => ({ id: 'fixture-assignment', value: text });
const valid = (input: unknown): input is Fixture =>
  typeof input === 'object' &&
  input !== null &&
  'id' in input &&
  typeof input.id === 'string' &&
  'value' in input &&
  typeof input.value === 'string';
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function RetainedProbe() {
  const resource = useOrderResource('/fixture', valid, { retainDataOnRefresh: true });
  return (
    <>
      <span role="status">{resource.pending ? 'Refreshing' : 'Ready'}</span>
      {resource.error && <p role="alert">{resource.error}</p>}
      {resource.data && (
        <>
          <p>{resource.data.value}</p>
          <input aria-label="Finish draft" defaultValue="Initial draft" />
        </>
      )}
      <button
        onClick={() => {
          void resource.refresh();
        }}
      >
        Refresh fixture
      </button>
    </>
  );
}
beforeEach(() => {
  apiMock.mockReset();
});

describe('M5 resources preserve current drafts while strictly scoping protected server data', () => {
  it('starts empty, accepts validated data and exposes bounded request cancellation on unmount', async () => {
    const read = deferred<Fixture>(),
      refresh = deferred<Fixture>();
    apiMock.mockReturnValueOnce(read.promise).mockReturnValueOnce(refresh.promise);
    const { result, unmount } = renderHook(() => useApiResource('/assignment/a', valid));
    expect(result.current).toMatchObject({ data: null, pending: true, error: null });
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    const signal = apiMock.mock.calls[0]![1]!.signal;
    expect(signal?.aborted).toBe(false);
    await act(async () => read.resolve(value('First canonical result')));
    expect(result.current).toMatchObject({
      data: value('First canonical result'),
      pending: false,
      error: null,
    });
    act(() => {
      void result.current.refresh();
    });
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    const activeSignal = apiMock.mock.calls[1]![1]?.signal;
    unmount();
    expect(activeSignal?.aborted).toBe(true);
  });
  it('never exposes old path data during the render before effects and ignores a late response after switching assignments', async () => {
    const old = deferred<Fixture>(),
      current = deferred<Fixture>(),
      renders: { path: string; data: Fixture | null }[] = [];
    apiMock
      .mockResolvedValueOnce(value('Loaded old assignment'))
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    const { result, rerender } = renderHook(
      ({ path }) => {
        const state = useApiResource(path, valid, { retainDataOnRefresh: true });
        renders.push({ path, data: state.data });
        return state;
      },
      { initialProps: { path: '/assignment/a' } },
    );
    await waitFor(() => expect(result.current.data?.value).toBe('Loaded old assignment'));
    act(() => {
      void result.current.refresh();
    });
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    const oldSignal = apiMock.mock.calls[1]![1]?.signal;
    rerender({ path: '/assignment/b' });
    expect(result.current.data).toBeNull();
    expect(result.current.pending).toBe(true);
    expect(oldSignal?.aborted).toBe(true);
    expect(renders.filter((r) => r.path === '/assignment/b').every((r) => r.data === null)).toBe(
      true,
    );
    await act(async () => current.resolve(value('Current assignment B')));
    await act(async () => old.resolve(value('Late assignment A response')));
    expect(result.current.data).toEqual(value('Current assignment B'));
    expect(
      renders.some((r) => r.path === '/assignment/b' && r.data?.value === 'Loaded old assignment'),
    ).toBe(false);
  });
  it.each([0, 503])(
    'retains same-path data and mounted draft on failure %s, then retries without turning failure into success',
    async (status) => {
      const failure = deferred<Fixture>();
      apiMock
        .mockResolvedValueOnce(value('Persisted assignment'))
        .mockReturnValueOnce(failure.promise)
        .mockResolvedValueOnce(value('Refreshed assignment'));
      render(<RetainedProbe />);
      await screen.findByText('Persisted assignment');
      const draft = screen.getByLabelText('Finish draft');
      fireEvent.change(draft, { target: { value: 'Unsaved finish explanation' } });
      fireEvent.click(screen.getByRole('button', { name: 'Refresh fixture' }));
      expect(screen.getByRole('status')).toHaveTextContent('Refreshing');
      expect(screen.getByLabelText('Finish draft')).toBe(draft);
      await act(async () => failure.reject(new ApiError(status, 'Server unavailable fixture')));
      expect(screen.getByRole('alert')).toHaveTextContent('Server unavailable');
      expect(screen.getByLabelText('Finish draft')).toHaveValue('Unsaved finish explanation');
      expect(screen.getByText('Persisted assignment')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Refresh fixture' }));
      await screen.findByText('Refreshed assignment');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Finish draft')).toBe(draft);
      expect(draft).toHaveValue('Unsaved finish explanation');
      expect(
        apiMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
      ).toBe(true);
    },
  );
  it.each([401, 403, 404])(
    'clears protected data after %s even when retaining failed background reads is requested',
    async (status) => {
      apiMock
        .mockResolvedValueOnce(value('Protected assignment'))
        .mockRejectedValueOnce(new ApiError(status, 'Access fixture failure'));
      const { result } = renderHook(() =>
        useApiResource('/assignment/a', valid, { retainDataOnRefresh: true }),
      );
      await waitFor(() => expect(result.current.data).not.toBeNull());
      await act(async () => {
        await result.current.refresh();
      });
      expect(result.current.data).toBeNull();
      expect(result.current.pending).toBe(false);
      expect(result.current.error).toBeTruthy();
      if (status === 403) expect(result.current.error).toMatch(/Access denied/i);
    },
  );
  it('keeps default behavior conservative: failed reads clear old data unless retention is explicitly requested', async () => {
    apiMock
      .mockResolvedValueOnce(value('Old response'))
      .mockRejectedValueOnce(new ApiError(503, 'Failed current request'));
    const { result } = renderHook(() => useApiResource('/assignment/a', valid));
    await waitFor(() => expect(result.current.data).toEqual(value('Old response')));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('Failed current request');
  });
  it('invalidates a pending GET when a mutation supplies canonical data, including functional setters', async () => {
    const stale = deferred<Fixture>();
    apiMock.mockReturnValueOnce(stale.promise);
    const { result } = renderHook(() =>
      useApiResource('/assignment/a', valid, { retainDataOnRefresh: true }),
    );
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    const signal = apiMock.mock.calls[0]![1]?.signal;
    act(() => result.current.setData(value('Canonical mutation result')));
    expect(signal?.aborted).toBe(true);
    expect(result.current).toMatchObject({
      data: value('Canonical mutation result'),
      pending: false,
      error: null,
    });
    act(() =>
      result.current.setData((previous) =>
        previous ? { ...previous, value: previous.value + ' plus local canonical result' } : null,
      ),
    );
    await act(async () => stale.resolve(value('Old GET after mutation')));
    expect(result.current.data?.value).toBe(
      'Canonical mutation result plus local canonical result',
    );
    expect(result.current.pending).toBe(false);
  });
  it('ignores canonical setters captured for an old path instead of hiding or overwriting the current assignment', async () => {
    apiMock
      .mockResolvedValueOnce(value('Assignment A'))
      .mockResolvedValueOnce(value('Assignment B'));
    const { result, rerender } = renderHook(
      ({ path }) => useApiResource(path, valid, { retainDataOnRefresh: true }),
      { initialProps: { path: '/assignment/a' } },
    );
    await waitFor(() => expect(result.current.data?.value).toBe('Assignment A'));
    const oldSetter = result.current.setData;
    rerender({ path: '/assignment/b' });
    await waitFor(() => expect(result.current.data?.value).toBe('Assignment B'));
    act(() => oldSetter(value('Late mutation for A')));
    expect(result.current.data?.value).toBe('Assignment B');
    act(() =>
      oldSetter((previous) =>
        previous ? { ...previous, value: 'Late functional mutation for A' } : null,
      ),
    );
    expect(result.current.data?.value).toBe('Assignment B');
  });
  it('ignores refresh callbacks captured for an old assignment instead of aborting or hiding the current record', async () => {
    apiMock
      .mockResolvedValueOnce(value('Assignment A'))
      .mockResolvedValueOnce(value('Assignment B'));
    const { result, rerender } = renderHook(
      ({ path }) => useApiResource(path, valid, { retainDataOnRefresh: true }),
      { initialProps: { path: '/assignment/a' } },
    );
    await waitFor(() => expect(result.current.data?.value).toBe('Assignment A'));
    const oldRefresh = result.current.refresh;
    rerender({ path: '/assignment/b' });
    await waitFor(() => expect(result.current.data?.value).toBe('Assignment B'));
    await act(async () => {
      await oldRefresh();
    });
    expect(result.current.data?.value).toBe('Assignment B');
    expect(result.current.pending).toBe(false);
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
  it('ignores aborted stale failures while a newer request succeeds on the same path', async () => {
    const older = deferred<Fixture>(),
      latest = deferred<Fixture>();
    apiMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise);
    const { result } = renderHook(() =>
      useApiResource('/assignment/a', valid, { retainDataOnRefresh: true }),
    );
    act(() => {
      void result.current.refresh();
    });
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(apiMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    await act(async () => latest.resolve(value('Newest state')));
    await act(async () => older.reject(new ApiError(503, 'Obsolete failure')));
    expect(result.current.data).toEqual(value('Newest state'));
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(false);
  });
  it('passes retention through order refresh events without remounting an unsaved finish form', async () => {
    const background = deferred<Fixture>();
    apiMock
      .mockResolvedValueOnce(value('Initial'))
      .mockReturnValueOnce(background.promise)
      .mockResolvedValueOnce(value('Payment updated data'));
    render(<RetainedProbe />);
    await screen.findByText('Initial');
    const draft = screen.getByLabelText('Finish draft');
    fireEvent.change(draft, { target: { value: 'Do not erase my reason' } });
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(screen.getByLabelText('Finish draft')).toBe(draft);
    expect(draft).toHaveValue('Do not erase my reason');
    await act(async () => window.dispatchEvent(new Event('fd:orders-changed')));
    await screen.findByText('Payment updated data');
    expect(screen.getByLabelText('Finish draft')).toBe(draft);
    expect(draft).toHaveValue('Do not erase my reason');
    await act(async () => background.resolve(value('Late old focus data')));
    expect(screen.getByText('Payment updated data')).toBeInTheDocument();
    expect(screen.queryByText('Late old focus data')).not.toBeInTheDocument();
  });
});
