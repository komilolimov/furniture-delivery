export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
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
  if (method !== 'GET') headers['X-CSRF-Protection'] = '1';
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  try {
    const timeout = AbortSignal.timeout(8_000);
    const response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
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
      throw new ApiError(response.status, errorMessage(response.status, body));
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
