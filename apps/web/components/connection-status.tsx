'use client';

import type { HealthResponse } from '@furniture-delivery/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHealth } from '../lib/health-client';

type ConnectionState =
  | { phase: 'loading' }
  | { phase: 'received'; health: HealthResponse }
  | { phase: 'unreachable' };

type IndicatorState = 'pending' | 'up' | 'down' | 'unknown';

function ServiceRow({
  name,
  description,
  state,
  label,
}: Readonly<{
  name: string;
  description: string;
  state: IndicatorState;
  label: string;
}>) {
  return (
    <li className="service-row">
      <div className="service-details">
        <span className={`service-icon ${state}`} aria-hidden="true">
          {state === 'up' ? '✓' : state === 'down' ? '!' : '·'}
        </span>
        <div>
          <h3>{name}</h3>
          <p>{description}</p>
        </div>
      </div>
      <span className={`service-badge ${state}`}>{label}</span>
    </li>
  );
}

export function ConnectionStatus() {
  const [state, setState] = useState<ConnectionState>({ phase: 'loading' });
  const activeRequest = useRef<AbortController | null>(null);

  const checkConnection = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setState({ phase: 'loading' });
    const timeout = setTimeout(() => controller.abort(), 6_000);

    try {
      const health = await fetchHealth(controller.signal);
      if (activeRequest.current === controller) setState({ phase: 'received', health });
    } catch {
      if (activeRequest.current === controller) setState({ phase: 'unreachable' });
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    void checkConnection();
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [checkConnection]);

  const loading = state.phase === 'loading';
  const received = state.phase === 'received';
  const healthy = received && state.health.status === 'ok';
  const apiState: IndicatorState = loading ? 'pending' : received ? 'up' : 'down';
  const databaseState: IndicatorState = loading
    ? 'pending'
    : received
      ? state.health.database
      : 'unknown';

  const heading = loading
    ? 'Checking your connection'
    : healthy
      ? 'All services connected'
      : 'Connection needs attention';
  const message = loading
    ? 'Contacting the API and checking the database.'
    : healthy
      ? 'The API responded and the database connection is available.'
      : received
        ? 'The API is reachable, but the database is unavailable. Check the database and try again.'
        : 'The API could not be reached or returned an invalid response. Check the service and try again.';

  return (
    <section className="connection-panel" aria-labelledby="connection-title" aria-busy={loading}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Service status</p>
          <h2 id="connection-title">Connection overview</h2>
        </div>
        <span className={`overall-badge ${loading ? 'pending' : healthy ? 'up' : 'down'}`}>
          <span className="status-dot" aria-hidden="true" />
          {loading ? 'Checking' : healthy ? 'Connected' : 'Unavailable'}
        </span>
      </div>

      <div
        className={`status-message ${loading ? 'pending' : healthy ? 'up' : 'down'}`}
        role="status"
        aria-live="polite"
      >
        <h3>{heading}</h3>
        <p>{message}</p>
      </div>

      <ul className="service-list" aria-label="Service connections">
        <ServiceRow
          name="API"
          description="Application service"
          state={apiState}
          label={loading ? 'Checking' : received ? 'Reachable' : 'Unavailable'}
        />
        <ServiceRow
          name="Database"
          description="PostgreSQL"
          state={databaseState}
          label={
            loading ? 'Checking' : received ? (healthy ? 'Connected' : 'Unavailable') : 'Unknown'
          }
        />
      </ul>

      <div className="panel-footer">
        <p className="check-time">
          {received ? (
            <>
              Last checked{' '}
              <time dateTime={state.health.checkedAt}>
                {new Date(state.health.checkedAt).toLocaleTimeString('en-GB')}
              </time>
            </>
          ) : loading ? (
            'Waiting for a live response…'
          ) : (
            'No valid health response received.'
          )}
        </p>
        <button
          className="check-button"
          type="button"
          onClick={() => void checkConnection()}
          disabled={loading}
        >
          <span aria-hidden="true">↻</span>
          {loading ? 'Checking…' : healthy ? 'Check again' : 'Retry connection'}
        </button>
      </div>
    </section>
  );
}
