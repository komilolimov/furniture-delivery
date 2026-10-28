'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from './api-client';

interface CommandOptions<Input, Result> {
  send: (payload: Input) => Promise<Result>;
  onSaved: (result: Result) => void;
  onAccessLost?: () => void;
}
/** JSON commands only. An unknown outcome must retry the original payload/key and route. */
export function useCommandAttempt<Input extends object, Result>({
  send,
  onSaved,
  onAccessLost,
}: CommandOptions<Input, Result>) {
  const attempt = useRef<{ payload: Input; send: (payload: Input) => Promise<Result> } | null>(
    null,
  );
  const busy = useRef(false);
  const alive = useRef(true);
  const saved = useRef(onSaved);
  const lost = useRef(onAccessLost);
  saved.current = onSaved;
  lost.current = onAccessLost;
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async (current: NonNullable<typeof attempt.current>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await current.send(current.payload);
      if (!alive.current) return;
      attempt.current = null;
      setUnknown(false);
      saved.current(result);
    } catch (failure) {
      if (!alive.current) return;
      const uncertain =
        !(failure instanceof ApiError) || failure.status === 0 || failure.status >= 500;
      if (!uncertain) attempt.current = null;
      setUnknown(uncertain);
      setError(describeError(failure));
      if (failure instanceof ApiError && [401, 403, 404].includes(failure.status)) lost.current?.();
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  }, []);
  const submit = useCallback(
    async (payload: Input) => {
      if (busy.current) return;
      attempt.current ??= { payload: structuredClone(payload), send };
      await run(attempt.current);
    },
    [run, send],
  );
  const retry = useCallback(async () => {
    if (attempt.current) await run(attempt.current);
  }, [run]);
  return { pending, unknown, error, locked: pending || unknown, submit, retry };
}
