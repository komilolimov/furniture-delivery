'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { apiRequest, ApiError, describeError } from './api-client';
import { useRealtimeCoordinator } from './realtime-context';

export interface ResourceOptions {
  /** Preserve this record and mounted editors during background refresh failures. */
  retainDataOnRefresh?: boolean;
}
interface ResourceState<T> {
  path: string;
  data: T | null;
  pending: boolean;
  error: string | null;
  dataLastSyncedAt?: string | null;
}
export function useApiResource<T>(
  path: string,
  validate: (value: unknown) => value is T,
  options: ResourceOptions = {},
) {
  const coordinator = useRealtimeCoordinator();
  const retain = options.retainDataOnRefresh ?? false;
  const [state, setState] = useState<ResourceState<T>>({
    path,
    data: null,
    pending: true,
    error: null,
  });
  const currentPath = useRef(path);
  currentPath.current = path;
  const request = useRef<AbortController | null>(null);
  // Mutation responses are canonical and invalidate any GET started before that commit.
  const setData: Dispatch<SetStateAction<T | null>> = useCallback(
    (next) => {
      if (currentPath.current !== path) return;
      if (coordinator) {
        coordinator.publish(path, next as unknown);
        return;
      }
      request.current?.abort();
      request.current = null;
      setState((previous) => ({
        path,
        data:
          typeof next === 'function'
            ? (next as (value: T | null) => T | null)(previous.path === path ? previous.data : null)
            : next,
        pending: false,
        error: null,
      }));
    },
    [path, coordinator],
  );
  const refresh = useCallback(async () => {
    if (currentPath.current !== path) return;
    if (coordinator) {
      await coordinator.refresh(path);
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState((previous) => ({
      path,
      data: previous.path === path ? previous.data : null,
      pending: true,
      error: null,
    }));
    try {
      const response = await apiRequest<T>(path, { signal: controller.signal, validate });
      if (request.current === controller && currentPath.current === path)
        setState({ path, data: response, pending: true, error: null });
    } catch (error) {
      if (request.current === controller && !controller.signal.aborted) {
        const accessLost = error instanceof ApiError && [401, 403, 404].includes(error.status);
        const message =
          error instanceof ApiError && error.status === 403
            ? 'Access denied. Your permissions may have changed. Refresh the page to check your session.'
            : describeError(error);
        if (currentPath.current === path)
          setState((previous) => ({
            path,
            data: retain && !accessLost && previous.path === path ? previous.data : null,
            pending: true,
            error: message,
          }));
      }
    } finally {
      if (request.current === controller && currentPath.current === path)
        setState((previous) =>
          previous.path === path ? { ...previous, pending: false } : previous,
        );
    }
  }, [path, validate, retain, coordinator]);

  useEffect(() => {
    if (coordinator)
      return coordinator.register(path, {
        validate,
        pending: () =>
          setState((previous) => ({
            ...previous,
            path,
            data: previous.path === path ? previous.data : null,
            pending: true,
            error: null,
          })),
        success: (value, at) =>
          setState((previous) => ({
            path,
            data: value as T,
            pending: false,
            error: null,
            dataLastSyncedAt: at ?? previous.dataLastSyncedAt ?? null,
          })),
        failure: (error) =>
          setState((previous) => ({
            ...previous,
            path,
            data:
              error instanceof ApiError && [401, 403, 404].includes(error.status)
                ? null
                : previous.path === path
                  ? previous.data
                  : null,
            pending: false,
            error: describeError(error),
          })),
        clear: () =>
          setState({ path, data: null, pending: false, error: null, dataLastSyncedAt: null }),
      });
    void refresh();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [refresh, coordinator, path, validate]);

  // Hide another record synchronously, before the path-change effect has run.
  const visible = state.path === path ? state : { data: null, pending: true, error: null };
  return {
    data: visible.data,
    setData,
    pending: visible.pending,
    error: visible.error,
    refresh,
    dataLastSyncedAt: 'dataLastSyncedAt' in visible ? (visible.dataLastSyncedAt ?? null) : null,
  };
}
