import type { HealthResponse } from '@furniture-delivery/contracts';

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.api === 'up' &&
    typeof record.checkedAt === 'string' &&
    Number.isFinite(Date.parse(record.checkedAt)) &&
    ((record.status === 'ok' && record.database === 'up') ||
      (record.status === 'error' && record.database === 'down'))
  );
}

export async function fetchHealth(signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/health', { cache: 'no-store', signal });
  const body: unknown = await response.json();

  if (
    !isHealthResponse(body) ||
    (response.status !== 200 && response.status !== 503) ||
    (response.status === 200 && body.status !== 'ok') ||
    (response.status === 503 && body.status !== 'error')
  ) {
    throw new Error('The service returned an unexpected health response.');
  }

  return body;
}
