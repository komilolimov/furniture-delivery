'use client';
import { useSyncExternalStore } from 'react';
import { useRealtimeCoordinator } from '../lib/realtime-context';
import type { LiveStatusSnapshot } from '../lib/realtime-coordinator';
import './realtime.css';
const idle: LiveStatusSnapshot = {
  mode: 'Unavailable',
  dataLastSyncedAt: null,
  dataChangedAt: null,
};
const subscribe = () => () => undefined;
const snapshot = () => idle;
export function LiveStatus() {
  const coordinator = useRealtimeCoordinator();
  const state = useSyncExternalStore(
    coordinator?.subscribeStatus ?? subscribe,
    coordinator?.getStatus ?? snapshot,
    coordinator?.getStatus ?? snapshot,
  );
  if (!coordinator) return null;
  return (
    <aside className="live-status" aria-label="Data connection">
      <span>{state.mode}</span>
      {' · '}
      {state.dataLastSyncedAt
        ? `Oldest active data read ${new Date(state.dataLastSyncedAt).toLocaleTimeString('en-GB', { timeZone: 'Europe/Rome' })} Europe/Rome`
        : 'No completed data sync yet'}
      {state.dataChangedAt && (
        <small>
          {' '}
          Server data changed. Open drafts keep their original values and revisions; review before
          saving.
        </small>
      )}
    </aside>
  );
}
