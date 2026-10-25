import { describe, expect, it } from 'vitest';
import { readConfig, readIntegrationConfig } from '../src/config/environment';

const developmentEnv = { DATABASE_PASSWORD: 'unit-test-only' };
const integrationEnv = {
  NODE_ENV: 'test',
  TEST_DATABASE_HOST: '127.0.0.1',
  TEST_DATABASE_PORT: '5433',
  TEST_DATABASE_NAME: 'furniture_delivery_test',
  TEST_DATABASE_USER: 'furniture_test',
  TEST_DATABASE_PASSWORD: 'unit-test-only',
};

describe('environment validation', () => {
  it('defaults to loopback and rejects missing secrets', () => {
    expect(readConfig(developmentEnv).apiHost).toBe('127.0.0.1');
    expect(() => readConfig({})).toThrow('DATABASE_PASSWORD');
    expect(() => readConfig({ DATABASE_PASSWORD: 'replace-with-a-local-password' })).toThrow();
    expect(() =>
      readConfig({
        DATABASE_PASSWORD: 'replace-with-your-local-development-password',
      }),
    ).toThrow();
    expect(() =>
      readIntegrationConfig({
        ...integrationEnv,
        TEST_DATABASE_PASSWORD: 'replace-with-your-local-test-password',
      }),
    ).toThrow();
  });

  it.each(['0', '-1', '65536', '3.1', 'abc', ''])('rejects invalid ports: %s', (apiPort) => {
    expect(() => readConfig({ ...developmentEnv, API_PORT: apiPort })).toThrow('API_PORT');
  });

  it('rejects unknown environments and malformed database identifiers without leaking values', () => {
    expect(() => readConfig({ ...developmentEnv, NODE_ENV: 'staging' })).toThrow('NODE_ENV');
    expect(() => readConfig({ ...developmentEnv, DATABASE_NAME: 'bad;value' })).toThrow(
      'DATABASE_NAME must be a PostgreSQL identifier.',
    );
  });

  it('uses explicit test connection settings without requiring development secrets', () => {
    const config = readIntegrationConfig(integrationEnv);
    expect(config.database.name).toBe('furniture_delivery_test');
    expect(config.database.port).toBe(5433);
    expect(config.database.user).toBe('furniture_test');
  });

  it('refuses missing test credentials or any attempt to use the development database', () => {
    expect(() =>
      readIntegrationConfig({ ...integrationEnv, TEST_DATABASE_PASSWORD: '' }),
    ).toThrow();
    expect(() => readIntegrationConfig({ ...integrationEnv, NODE_ENV: 'production' })).toThrow();
    expect(() =>
      readIntegrationConfig({ ...integrationEnv, TEST_DATABASE_NAME: 'other' }),
    ).toThrow();
    expect(() =>
      readIntegrationConfig({
        ...integrationEnv,
        DATABASE_NAME: 'furniture_delivery_test',
      }),
    ).toThrow();
  });

  it('uses an absolute eight-hour session and secure production cookies by default', () => {
    expect(readConfig(developmentEnv).auth).toEqual({
      webOrigin: 'http://127.0.0.1:3000',
      sessionTtlSeconds: 28800,
      cookieSecure: false,
      loginWindowSeconds: 60,
      loginMaxAttempts: 10,
    });
    expect(readConfig({ ...developmentEnv, NODE_ENV: 'production' }).auth.cookieSecure).toBe(true);
  });

  it.each([
    'null',
    'https://example.test/private',
    'https://user:password@example.test',
    'file:///tmp',
  ])('rejects invalid public origins without echoing them: %s', (webOrigin) => {
    expect(() => readConfig({ ...developmentEnv, WEB_ORIGIN: webOrigin })).toThrow('WEB_ORIGIN');
  });

  it('rejects invalid auth limits and cookie flags', () => {
    expect(() => readConfig({ ...developmentEnv, SESSION_COOKIE_SECURE: 'yes' })).toThrow(
      'SESSION_COOKIE_SECURE',
    );
    expect(() => readConfig({ ...developmentEnv, SESSION_TTL_SECONDS: '0' })).toThrow(
      'SESSION_TTL_SECONDS',
    );
    expect(() => readConfig({ ...developmentEnv, LOGIN_WINDOW_SECONDS: '3.1' })).toThrow(
      'LOGIN_WINDOW_SECONDS',
    );
    expect(() => readConfig({ ...developmentEnv, LOGIN_MAX_ATTEMPTS: '101' })).toThrow(
      'LOGIN_MAX_ATTEMPTS',
    );
  });
});
