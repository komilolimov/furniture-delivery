'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError, describeError } from './api-client';

export function useApiResource<T>(path: string, validate: (value: unknown) => value is T) {
  const [data, setData] = useState<T | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const response = await apiRequest<T>(path, { signal: controller.signal, validate });
      if (request.current === controller) setData(response);
    } catch (error) {
      if (request.current === controller && !controller.signal.aborted) {
        setData(null);
        setError(describeError(error));
        if (error instanceof ApiError && error.status === 403)
          setError(
            'Access denied. Your permissions may have changed. Refresh the page to check your session.',
          );
      }
    } finally {
      if (request.current === controller) setPending(false);
    }
  }, [path, validate]);

  useEffect(() => {
    void refresh();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [refresh]);

  return { data, setData, pending, error, refresh };
}
