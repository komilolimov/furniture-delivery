import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { config as loadDotEnv } from 'dotenv';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  apiHost: string;
  apiPort: number;
  auth: {
    webOrigin: string;
    sessionTtlSeconds: number;
    cookieSecure: boolean;
    loginWindowSeconds: number;
    loginMaxAttempts: number;
  };
  storage?: {
    root: string;
    imageMaxBytes?: number;
    pdfMaxBytes?: number;
    maxPixels?: number;
    orderMaxFiles?: number;
    orderMaxBytes?: number;
  };
  database: {
    /** Internal test isolation; not configurable through an untrusted HTTP request. */
    schema?: string;
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
  };
}

function port(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a valid port.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be a valid port.`);
  }
  return parsed;
}

function identifier(value: string, name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value)) {
    throw new Error(`${name} must be a PostgreSQL identifier.`);
  }
  return value;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}.`);
  }
  return number;
}

function origin(value: string): string {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error(
      'WEB_ORIGIN must be an HTTP(S) origin without credentials, path, query or fragment.',
    );
  }
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) {
    // Both src/config and dist/config have the same distance to the workspace root.
    // Existing process variables take precedence, including in CLI commands and tests.
    loadDotEnv({ path: resolve(__dirname, '../../../../.env'), quiet: true });
  }
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test or production.');
  }
  const password = env.DATABASE_PASSWORD;
  if (!password || password.startsWith('replace-with-')) {
    throw new Error('Set DATABASE_PASSWORD in the root .env or environment.');
  }
  if (
    env.SESSION_COOKIE_SECURE !== undefined &&
    !['true', 'false'].includes(env.SESSION_COOKIE_SECURE)
  ) {
    throw new Error('SESSION_COOKIE_SECURE must be true or false.');
  }
  return {
    nodeEnv: nodeEnv as AppConfig['nodeEnv'],
    apiHost: env.API_HOST ?? '127.0.0.1',
    apiPort: port(env.API_PORT, 3001, 'API_PORT'),
    auth: {
      webOrigin: origin(env.WEB_ORIGIN ?? 'http://127.0.0.1:3000'),
      sessionTtlSeconds: positiveInteger(
        env.SESSION_TTL_SECONDS,
        28800,
        604800,
        'SESSION_TTL_SECONDS',
      ),
      cookieSecure:
        env.SESSION_COOKIE_SECURE === undefined
          ? nodeEnv === 'production'
          : env.SESSION_COOKIE_SECURE === 'true',
      loginWindowSeconds: positiveInteger(
        env.LOGIN_WINDOW_SECONDS,
        60,
        3600,
        'LOGIN_WINDOW_SECONDS',
      ),
      loginMaxAttempts: positiveInteger(env.LOGIN_MAX_ATTEMPTS, 10, 100, 'LOGIN_MAX_ATTEMPTS'),
    },
    storage: {
      root: env.STORAGE_ROOT
        ? resolve(env.STORAGE_ROOT)
        : resolve(__dirname, '../../../../uploads'),
      imageMaxBytes: positiveInteger(
        env.STORAGE_IMAGE_MAX_BYTES,
        10485760,
        10485760,
        'STORAGE_IMAGE_MAX_BYTES',
      ),
      pdfMaxBytes: positiveInteger(
        env.STORAGE_PDF_MAX_BYTES,
        20971520,
        20971520,
        'STORAGE_PDF_MAX_BYTES',
      ),
      maxPixels: positiveInteger(env.STORAGE_MAX_PIXELS, 40000000, 40000000, 'STORAGE_MAX_PIXELS'),
      orderMaxFiles: positiveInteger(
        env.STORAGE_ORDER_MAX_FILES,
        100,
        100,
        'STORAGE_ORDER_MAX_FILES',
      ),
      orderMaxBytes: positiveInteger(
        env.STORAGE_ORDER_MAX_BYTES,
        262144000,
        262144000,
        'STORAGE_ORDER_MAX_BYTES',
      ),
    },
    database: {
      host: env.DATABASE_HOST ?? '127.0.0.1',
      port: port(env.DATABASE_PORT, 5432, 'DATABASE_PORT'),
      name: identifier(env.DATABASE_NAME ?? 'furniture_delivery', 'DATABASE_NAME'),
      user: identifier(env.DATABASE_USER ?? 'furniture', 'DATABASE_USER'),
      password,
    },
  };
}

export function readIntegrationConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) {
    loadDotEnv({ path: resolve(__dirname, '../../../../.env'), quiet: true });
  }
  const required = [
    'TEST_DATABASE_HOST',
    'TEST_DATABASE_PORT',
    'TEST_DATABASE_NAME',
    'TEST_DATABASE_USER',
    'TEST_DATABASE_PASSWORD',
  ] as const;
  if (required.some((name) => !env[name])) {
    throw new Error(
      'Integration tests require all TEST_DATABASE_* settings; no development fallback.',
    );
  }
  if (
    env.NODE_ENV !== 'test' ||
    env.TEST_DATABASE_NAME === (env.DATABASE_NAME ?? 'furniture_delivery') ||
    !env.TEST_DATABASE_NAME?.endsWith('_test')
  ) {
    throw new Error(
      'Integration tests require NODE_ENV=test and a separate TEST_DATABASE_NAME ending in _test.',
    );
  }
  const result = readConfig({
    NODE_ENV: 'test',
    DATABASE_HOST: env.TEST_DATABASE_HOST,
    DATABASE_PORT: env.TEST_DATABASE_PORT,
    DATABASE_NAME: env.TEST_DATABASE_NAME,
    DATABASE_USER: env.TEST_DATABASE_USER,
    DATABASE_PASSWORD: env.TEST_DATABASE_PASSWORD,
  });
  result.storage = {
    ...result.storage,
    root: resolve(tmpdir(), 'furniture-delivery-tests', randomUUID()),
  };
  return result;
}
