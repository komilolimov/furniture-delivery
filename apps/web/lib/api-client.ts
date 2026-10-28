export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: Readonly<{
      crewId?: string;
      appointmentId?: string;
      from?: string;
      to?: string;
    }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ApiOptions<T> = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  signal?: AbortSignal;
  validate?: (value: unknown) => value is T;
  timeoutMs?: number;
};

function errorMessage(status: number, body: unknown): string {
  if (status === 429) return 'Too many sign-in attempts. Please try again later.';
  if (status === 401) return 'Your session has ended or the sign-in details are incorrect.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status >= 500) return 'The service is temporarily unavailable. Please try again.';
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message: unknown = body.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
      return message.join(' ');
    }
  }
  return 'The request could not be completed. Please try again.';
}

export async function apiRequest<T>(path: string, options: ApiOptions<T> = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  const multipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (method !== 'GET') headers['X-CSRF-Protection'] = '1';
  if (options.body !== undefined && !multipart) headers['Content-Type'] = 'application/json';

  try {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 8_000);
    const response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      ...(options.body !== undefined
        ? { body: multipart ? (options.body as FormData) : JSON.stringify(options.body) }
        : {}),
    });
    const body: unknown =
      response.status === 204 ? undefined : await response.json().catch(() => undefined);
    if (!response.ok) {
      if (response.status === 401 && path !== '/auth/login' && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('fd:session-expired'));
      }
      if (response.status === 403 && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('fd:permissions-changed'));
      }
      const metadata =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      const code =
        typeof metadata.code === 'string' && /^[A-Z_]{1,64}$/.test(metadata.code)
          ? metadata.code
          : undefined;
      const rawDetails =
        typeof metadata.details === 'object' && metadata.details !== null
          ? (metadata.details as Record<string, unknown>)
          : {};
      const details: { crewId?: string; appointmentId?: string; from?: string; to?: string } = {};
      for (const key of ['crewId', 'appointmentId', 'from', 'to'] as const)
        if (typeof rawDetails[key] === 'string') details[key] = rawDetails[key];
      throw new ApiError(response.status, errorMessage(response.status, body), code, details);
    }
    if (response.status !== 204 && body === undefined)
      throw new ApiError(0, 'The service returned an invalid response.');
    if (options.validate && !options.validate(body))
      throw new ApiError(0, 'The service returned an invalid response.');
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'The service could not be reached. Check your connection and try again.');
  }
}

export function describeError(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'The request could not be completed. Please try again.';
}
