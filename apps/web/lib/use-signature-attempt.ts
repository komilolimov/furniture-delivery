'use client';

import { useEffect, useRef, useState } from 'react';
import type { SignAcceptanceCommand } from '@furniture-delivery/contracts';
import { apiRequest, ApiError, describeError } from './api-client';

/** A Blob is immutable. Retain the same blob, metadata, key and route on an unknown outcome. */
export function useSignatureAttempt<Result>({
  onSaved,
  onAccessLost,
  validate,
}: {
  onSaved: (value: Result) => void;
  onAccessLost: () => void;
  validate: (value: unknown) => value is Result;
}) {
  const attempt = useRef<{ path: string; metadata: SignAcceptanceCommand; png: Blob } | null>(null);
  const alive = useRef(true),
    busy = useRef(false);
  const callbacks = useRef({ onSaved, onAccessLost });
  callbacks.current = { onSaved, onAccessLost };
  const [pending, setPending] = useState(false),
    [unknown, setUnknown] = useState(false);
  const [conflict, setConflict] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      attempt.current = null;
    };
  }, []);
  async function run() {
    if (busy.current || !attempt.current) return;
    const current = attempt.current;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('payload', JSON.stringify(current.metadata));
      body.append('signature', current.png, 'signature.png');
      const response = await apiRequest<Result>(current.path, { method: 'POST', body, validate });
      if (!alive.current) return;
      attempt.current = null;
      setUnknown(false);
      callbacks.current.onSaved(response);
    } catch (failure) {
      if (!alive.current) return;
      const uncertain =
        !(failure instanceof ApiError) || failure.status === 0 || failure.status >= 500;
      if (!uncertain) attempt.current = null;
      setUnknown(uncertain);
      setConflict(failure instanceof ApiError && failure.status === 409);
      setError(describeError(failure));
      if (failure instanceof ApiError && [401, 403, 404].includes(failure.status))
        callbacks.current.onAccessLost();
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  }
  return {
    pending,
    unknown,
    conflict,
    error,
    locked: pending || unknown || conflict,
    submit: async (path: string, metadata: SignAcceptanceCommand, png: Blob) => {
      if (busy.current || conflict) return;
      attempt.current ??= { path, metadata: Object.freeze({ ...metadata }), png };
      await run();
    },
    retry: run,
  };
}
