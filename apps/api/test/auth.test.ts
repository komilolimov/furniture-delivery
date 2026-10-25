import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { LoginRateLimiter } from '../src/auth/login-rate-limiter';
import { readSessionCookie, sessionCookieOptions } from '../src/auth/session-cookie';
import type { AuthConfig } from '../src/auth/auth.types';
import { parseCreateUser, parseUpdateUser } from '../src/users/users.dto';
import { objectPayload, passwordValue, usernameValue } from '../src/auth/validation';

const config: AuthConfig = {
  webOrigin: 'http://127.0.0.1:3000',
  sessionTtlSeconds: 28800,
  cookieSecure: false,
  loginWindowSeconds: 60,
  loginMaxAttempts: 2,
};

describe('password hashing', () => {
  it('uses random salts, verifies the password and rejects a different password', async () => {
    const password = randomBytes(24).toString('base64url');
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).toMatch(/^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword(`${password}x`, first)).toBe(false);
  }, 10000);

  it('rejects malformed hashes and unbounded work factors', async () => {
    expect(await verifyPassword('unused', 'plaintext')).toBe(false);
    expect(
      await verifyPassword('unused', `scrypt$999999999$8$1$${'00'.repeat(16)}$${'00'.repeat(32)}`),
    ).toBe(false);
  });
});

describe('session cookie', () => {
  it('accepts one opaque session value and rejects duplicates or malformed values', () => {
    const token = randomBytes(32).toString('base64url');
    expect(readSessionCookie(`other=one; fd_session=${token}; third=three`)).toBe(token);
    expect(readSessionCookie(`fd_session=${token}; fd_session=${token}`)).toBeUndefined();
    expect(readSessionCookie('fd_session=invalid')).toBeUndefined();
    expect(readSessionCookie(undefined)).toBeUndefined();
    expect(sessionCookieOptions({ ...config, cookieSecure: true })).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });
});

describe('bounded login rate limiter', () => {
  it('limits the normalized account across IPs and permits retry after expiry', () => {
    const limiter = new LoginRateLimiter(config);
    expect(limiter.consume('alice', 'one', 0)).toBeUndefined();
    expect(limiter.consume('alice', 'two', 0)).toBeUndefined();
    expect(limiter.consume('alice', 'three', 1000)).toBe(59);
    expect(limiter.consume('alice', 'three', 60000)).toBeUndefined();
  });

  it('limits a socket address across different accounts', () => {
    const limiter = new LoginRateLimiter(config);
    for (let index = 0; index < 20; index += 1)
      expect(limiter.consume(`user${index}`, 'one', 0)).toBeUndefined();
    expect(limiter.consume('another', 'one', 0)).toBe(60);
  });

  it('bounds its retained account/IP buckets and fails closed until they expire', () => {
    const limiter = new LoginRateLimiter(config);
    for (let index = 0; index < 1000; index += 1)
      expect(limiter.consume(`user${index}`, `ip${index}`, 0)).toBeUndefined();
    expect(limiter.consume('overflow', 'overflow', 0)).toBe(60);
    expect(limiter.consume('overflow', 'overflow', 60000)).toBeUndefined();
  });
});

describe('authentication and account input validation', () => {
  it('normalizes usernames and preserves password characters exactly', () => {
    expect(usernameValue(' Alice.Test ')).toBe('alice.test');
    expect(passwordValue(' a long password ', true)).toBe(' a long password ');
  });

  it.each([null, [], 'payload', { username: 'alice', passwordHash: 'injected' }])(
    'rejects unsupported payloads',
    (payload) => {
      expect(() => objectPayload(payload, ['username', 'password'])).toThrow();
    },
  );

  it('validates required fields, roles, strict booleans and password length', () => {
    expect(() => parseCreateUser({ username: 'alice' })).toThrow();
    expect(() =>
      parseCreateUser({
        username: 'alice',
        displayName: 'Alice',
        password: 'short',
        role: 'ADMIN',
      }),
    ).toThrow();
    expect(() =>
      parseCreateUser({
        username: 'alice',
        displayName: 'Alice',
        password: 'long-enough-password',
        role: 'OWNER',
      }),
    ).toThrow();
    expect(() => parseUpdateUser({ active: 'false' })).toThrow();
    expect(() => parseUpdateUser({})).toThrow();
    expect(() => parseUpdateUser({ username: 'renamed' })).toThrow();
    expect(() => usernameValue('1invalid')).toThrow();
    expect(parseUpdateUser({ active: false, role: 'CREW_MEMBER' })).toEqual({
      active: false,
      role: 'CREW_MEMBER',
    });
  });
});
