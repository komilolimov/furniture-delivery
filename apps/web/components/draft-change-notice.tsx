'use client';
import { useState, useSyncExternalStore } from 'react';
import { useRealtimeCoordinator } from '../lib/realtime-context';
const empty = () => '';
const subscribe = () => () => undefined;
/** A notice only: it never adopts a server revision or changes a frozen command. */
export function DraftChangeNotice({ paths }: Readonly<{ paths: string[] }>) {
  const coordinator = useRealtimeCoordinator();
  const getStamp = coordinator ? () => coordinator.changeStamp(paths) : empty;
  const current = useSyncExternalStore(
    coordinator?.subscribeStatus ?? subscribe,
    getStamp,
    getStamp,
  );
  const [baseline] = useState(() => coordinator?.changeStamp(paths) ?? '');
  if (!coordinator || current === baseline) return null;
  return (
    <p className="conflict-notice" role="status">
      Saved data changed since this form opened. Your draft, original revision and retry key are
      retained. Review current data before saving; refresh does not rebase this draft.
    </p>
  );
}
