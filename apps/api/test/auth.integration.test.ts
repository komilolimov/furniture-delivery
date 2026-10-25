import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { AuthResponse, AuthUser, UserRole } from '@furniture-delivery/contracts';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../src/application';
import { readIntegrationConfig } from '../src/config/environment';
import { createDataSource } from '../src/database/data-source';
import { Crew } from '../src/crews/crew.entity';
import { User } from '../src/identity/user.entity';
import { CrewMember } from '../src/identity/crew-member.entity';
import { AuthSession } from '../src/identity/auth-session.entity';
import { hashPassword } from '../src/auth/password';
import { hashSessionToken } from '../src/auth/auth.service';

describe('M2 authentication and accounts on dedicated PostgreSQL', () => {
  const schema = `m2_auth_${randomUUID().replaceAll('-', '')}`;
  const password = randomBytes(24).toString('base64url');
  const replacementPassword = randomBytes(24).toString('base64url');
  const origin = 'http://127.0.0.1:3000';
  let adminSource: DataSource | undefined;
  let source: DataSource;
  let app: INestApplication | undefined;
  let baseUrl: string;
  let adminCookie: string;
  let admin: User;
  let dispatcher: User;
  let employee: User;
  let spare: User;
  let crewA: Crew;
  let crewB: Crew;

  const call = (
    path: string,
    options: {
      method?: string;
      body?: unknown;
      cookie?: string;
      headers?: Record<string, string>;
    } = {},
  ) =>
    fetch(`${baseUrl}/api${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Origin: origin,
        'X-CSRF-Protection': '1',
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });

  const login = (username: string, value = password) =>
    call('/auth/login', { method: 'POST', body: { username, password: value } });
  const cookie = (response: Response): string => {
    const result = response.headers.get('set-cookie')?.split(';')[0];
    if (!result) throw new Error('Expected a session cookie.');
    return result;
  };

  beforeAll(async () => {
    const config = readIntegrationConfig();
    adminSource = createDataSource(config);
    await adminSource.initialize();
    await adminSource.query(`CREATE SCHEMA "${schema}"`);
    source = createDataSource(config, { schema });
    await source.initialize();
    await source.runMigrations();
    const users = source.getRepository(User);
    const createUser = async (username: string, role: UserRole) =>
      users.save(
        users.create({
          username,
          displayName: `Test ${role}`,
          role,
          active: true,
          passwordHash: await hashPassword(password),
        }),
      );
    admin = await createUser('auth.admin', 'ADMIN');
    dispatcher = await createUser('auth.dispatcher', 'DISPATCHER');
    employee = await createUser('auth.employee', 'CREW_MEMBER');
    spare = await createUser('auth.spare', 'CREW_MEMBER');
    const crews = source.getRepository(Crew);
    crewA = await crews.save(
      crews.create({
        code: 'AUTH-A',
        name: 'Auth A',
        active: true,
        workEnvironment: 'INDOOR',
        serviceArea: 'Test area',
      }),
    );
    crewB = await crews.save(
      crews.create({
        code: 'AUTH-B',
        name: 'Auth B',
        active: true,
        workEnvironment: 'OUTDOOR',
        serviceArea: 'Test area',
      }),
    );
    await source
      .getRepository(CrewMember)
      .insert({ userId: employee.id, crewId: crewA.id, active: true });
    app = await createApplication({
      ...config,
      auth: { ...config.auth, loginMaxAttempts: 4 },
      database: { ...config.database, schema },
    });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    const response = await login(admin.username);
    expect(response.status).toBe(200);
    adminCookie = cookie(response);
  });

  afterAll(async () => {
    await app?.close();
    if (source?.isInitialized) await source.destroy();
    if (adminSource?.isInitialized) {
      if (!/^m2_auth_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe cleanup schema.');
      await adminSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminSource.destroy();
    }
  });

  it('keeps health public and denies anonymous/prohibited account requests', async () => {
    expect((await call('/health')).status).toBe(200);
    expect((await call('/auth/me')).status).toBe(401);
    expect((await call('/users')).status).toBe(401);
    const response = await login(dispatcher.username);
    const sessionCookie = cookie(response);
    expect((await call('/users', { cookie: sessionCookie })).status).toBe(403);
    // No permissions are embedded in the session token: direct role changes are fresh.
    await source.getRepository(User).update(dispatcher.id, { role: 'ADMIN' });
    expect((await call('/users', { cookie: sessionCookie })).status).toBe(200);
    await source.getRepository(User).update(dispatcher.id, { role: 'DISPATCHER' });
    expect((await call('/users', { cookie: sessionCookie })).status).toBe(403);
  });

  it('validates login and rejects missing/forged Origin or CSRF header even before login', async () => {
    const body = { username: 'not.existing', password };
    expect(
      (await call('/auth/login', { method: 'POST', body, headers: { Origin: '' } })).status,
    ).toBe(403);
    expect(
      (
        await call('/auth/login', {
          method: 'POST',
          body,
          headers: { Origin: 'https://hostile.invalid' },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call('/auth/login', { method: 'POST', body, headers: { 'X-CSRF-Protection': '' } }))
        .status,
    ).toBe(403);
    expect(
      (await call('/auth/login', { method: 'POST', body: { username: 'not.existing' } })).status,
    ).toBe(400);
    expect(
      (await call('/auth/login', { method: 'POST', body: { ...body, role: 'ADMIN' } })).status,
    ).toBe(400);
    expect((await login('not.existing')).status).toBe(401);
    expect((await login(admin.username, 'wrong-password')).status).toBe(401);
    const malformedMarker = 'sensitive-json-parser-marker';
    const malformed = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, 'X-CSRF-Protection': '1' },
      body: `{"password":"${malformedMarker}", invalid}`,
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).not.toContain(malformedMarker);
  });

  it('uses an HttpOnly cookie, stores only a token hash and never serializes secrets', async () => {
    const response = await login(spare.username);
    expect(response.status).toBe(200);
    const header = response.headers.get('set-cookie') ?? '';
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).not.toContain('Domain=');
    const text = await response.text();
    const body = JSON.parse(text) as AuthResponse;
    expect(Object.keys(body)).toEqual(['user']);
    expect(Object.keys(body.user).sort()).toEqual([
      'active',
      'crewIds',
      'displayName',
      'id',
      'role',
      'username',
    ]);
    expect(text).not.toMatch(/password|token|session|scrypt/i);
    expect(text).not.toContain(password);
    const raw = cookie(response).slice('fd_session='.length);
    const session = await source
      .getRepository(AuthSession)
      .createQueryBuilder('session')
      .addSelect('session.tokenHash')
      .where('session.tokenHash = :hash', { hash: hashSessionToken(raw) })
      .getOneOrFail();
    expect(session.tokenHash).toBe(hashSessionToken(raw));
    expect(session.tokenHash).not.toBe(raw);
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBeLessThanOrEqual(28800000);
    const userList = await call('/users', { cookie: adminCookie });
    expect(await userList.text()).not.toMatch(/password|tokenHash|scrypt/);
  });

  it('revokes logout server-side and rejects cookie replay', async () => {
    const sessionCookie = cookie(await login(spare.username));
    expect(
      (
        await call('/auth/logout', {
          method: 'POST',
          cookie: sessionCookie,
          headers: { 'X-CSRF-Protection': '' },
        })
      ).status,
    ).toBe(403);
    const response = await call('/auth/logout', { method: 'POST', cookie: sessionCookie });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970');
    expect((await call('/auth/me', { cookie: sessionCookie })).status).toBe(401);
    const tokenHash = hashSessionToken(sessionCookie.slice('fd_session='.length));
    expect(
      (await source.getRepository(AuthSession).findOneByOrFail({ tokenHash })).revokedAt,
    ).toBeInstanceOf(Date);
  });

  it('invalidates sessions when an admin disables a user, including after reactivation', async () => {
    const sessionCookie = cookie(await login(employee.username));
    expect((await call('/users', { cookie: sessionCookie })).status).toBe(403);
    expect(
      (
        await call(`/users/${employee.id}`, {
          method: 'PATCH',
          cookie: adminCookie,
          body: { active: false },
        })
      ).status,
    ).toBe(200);
    expect((await call('/auth/me', { cookie: sessionCookie })).status).toBe(401);
    expect((await login(employee.username)).status).toBe(401);
    expect(
      (
        await call(`/users/${employee.id}`, {
          method: 'PATCH',
          cookie: adminCookie,
          body: { active: true },
        })
      ).status,
    ).toBe(200);
    expect((await call('/auth/me', { cookie: sessionCookie })).status).toBe(401);
  });

  it('re-reads memberships and denies a crew member access to another crew', async () => {
    const sessionCookie = cookie(await login(employee.username));
    expect((await call(`/crews/${crewA.id}`, { cookie: sessionCookie })).status).toBe(200);
    expect((await call(`/crews/${crewB.id}`, { cookie: sessionCookie })).status).toBe(404);
    expect((await call('/crews', { method: 'POST', cookie: sessionCookie, body: {} })).status).toBe(
      403,
    );
    await source
      .getRepository(CrewMember)
      .update({ userId: employee.id, active: true }, { active: false });
    await source
      .getRepository(CrewMember)
      .insert({ userId: employee.id, crewId: crewB.id, active: true });
    const me = await call('/auth/me', { cookie: sessionCookie });
    expect(((await me.json()) as AuthResponse).user.crewIds).toEqual([crewB.id]);
    expect((await call(`/crews/${crewA.id}`, { cookie: sessionCookie })).status).toBe(404);
    expect((await call(`/crews/${crewB.id}`, { cookie: sessionCookie })).status).toBe(200);
  });

  it('enforces expiry and rejects malformed or ambiguous session cookies', async () => {
    const sessionCookie = cookie(await login(spare.username));
    const tokenHash = hashSessionToken(sessionCookie.slice('fd_session='.length));
    await source
      .getRepository(AuthSession)
      .update({ tokenHash }, { expiresAt: new Date(Date.now() - 1000) });
    expect((await call('/auth/me', { cookie: sessionCookie })).status).toBe(401);
    expect((await call('/auth/me', { cookie: 'fd_session=invalid' })).status).toBe(401);
    expect((await call('/auth/me', { cookie: `${sessionCookie}; ${sessionCookie}` })).status).toBe(
      401,
    );
  });

  it('restricts account mutations to admin, validates payloads and revokes password/role changes', async () => {
    expect(
      (await call('/users', { method: 'POST', cookie: adminCookie, body: { username: 'short' } }))
        .status,
    ).toBe(400);
    expect(
      (
        await call(`/users/${spare.id}`, {
          method: 'PATCH',
          cookie: adminCookie,
          body: { active: 'false' },
        })
      ).status,
    ).toBe(400);
    const created = await call('/users', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        username: 'created.employee',
        displayName: 'Created employee',
        password,
        role: 'CREW_MEMBER',
      },
    });
    expect(created.status).toBe(201);
    const user = ((await created.json()) as AuthResponse).user;
    const initialCookie = cookie(await login(user.username));
    const changed = await call(`/users/${user.id}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { password: replacementPassword },
    });
    expect(changed.status).toBe(200);
    expect((await call('/auth/me', { cookie: initialCookie })).status).toBe(401);
    expect((await login(user.username)).status).toBe(401);
    const newCookie = cookie(await login(user.username, replacementPassword));
    await source
      .getRepository(CrewMember)
      .insert({ userId: user.id, crewId: crewA.id, active: true });
    const roleChanged = await call(`/users/${user.id}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { role: 'DISPATCHER' },
    });
    expect(roleChanged.status).toBe(200);
    expect((await call('/auth/me', { cookie: newCookie })).status).toBe(401);
    expect(await source.getRepository(CrewMember).countBy({ userId: user.id, active: true })).toBe(
      0,
    );
    const sanitized = await call(`/users/${user.id}`, { cookie: adminCookie });
    expect(((await sanitized.json()) as { user: AuthUser }).user.role).toBe('DISPATCHER');
  });

  it('throttles account attempts across forged proxy headers and sends Retry-After', async () => {
    for (let index = 0; index < 4; index += 1)
      expect((await login('throttle.account')).status).toBe(401);
    const response = await call('/auth/login', {
      method: 'POST',
      body: { username: 'THROTTLE.ACCOUNT', password },
      headers: { 'X-Forwarded-For': '198.51.100.55' },
    });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
