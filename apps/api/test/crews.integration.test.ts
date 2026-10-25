import { randomUUID } from 'node:crypto';
import type { AuthUser } from '@furniture-delivery/contracts';
import { Like } from 'typeorm';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { readIntegrationConfig } from '../src/config/environment';
import { Crew } from '../src/crews/crew.entity';
import { CrewsService } from '../src/crews/crews.service';
import { createDataSource } from '../src/database/data-source';
import { DatabaseService } from '../src/database/database.service';
import { seedCrews } from '../src/database/demo-crews';
import { demoUsers, seedIdentity } from '../src/database/demo-identity';
import { CrewMember } from '../src/identity/crew-member.entity';
import { ExternalParticipant } from '../src/identity/external-participant.entity';
import { User } from '../src/identity/user.entity';

describe('M2 crews, seed and membership on isolated PostgreSQL', () => {
  const schema = `m2_crews_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource | undefined;
  let source: DataSource;
  let service: CrewsService;
  let employee: User;
  let crews: Crew[];
  const dispatcher: AuthUser = {
    id: randomUUID(),
    username: 'fixture.dispatcher',
    displayName: 'Fixture Dispatcher',
    role: 'DISPATCHER',
    active: true,
    crewIds: [],
  };
  const actor = (): AuthUser => ({
    id: employee.id,
    username: employee.username,
    displayName: employee.displayName,
    role: 'CREW_MEMBER',
    active: true,
    crewIds: crews.map(({ id }) => id),
  });

  beforeAll(async () => {
    const config = readIntegrationConfig();
    admin = createDataSource(config);
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    source = createDataSource(config, { schema });
    await source.initialize();
    await source.runMigrations();
    await seedCrews(source, 'test');
    crews = await source.getRepository(Crew).find({ order: { code: 'ASC' } });
    employee = await source.getRepository(User).save({
      username: 'fixture.employee',
      displayName: 'Fixture Employee',
      role: 'CREW_MEMBER',
      active: true,
      passwordHash: await hashPassword('fixture-only-password'),
    });
    service = new CrewsService(new DatabaseService(source));
  });

  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (admin?.isInitialized) {
      if (!/^m2_crews_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe cleanup schema.');
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  it('permits only one concurrent active membership, rechecks access and retains history', async () => {
    const [first, second] = crews;
    if (!first || !second) throw new Error('Demo crews missing.');
    const results = await Promise.allSettled([
      service.addMember(first.id, employee.id),
      service.addMember(second.id, employee.id),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const membership = await source
      .getRepository(CrewMember)
      .findOneByOrFail({ userId: employee.id, active: true });
    const ownCrew = membership.crewId;
    const foreignCrew = ownCrew === first.id ? second.id : first.id;
    expect((await service.list(actor())).map(({ id }) => id)).toEqual([ownCrew]);
    await expect(service.detail(foreignCrew, actor())).rejects.toMatchObject({ status: 404 });
    const detail = await service.detail(ownCrew, actor());
    expect(detail.members[0]?.user.id).toBe(employee.id);
    expect(JSON.stringify(detail)).not.toContain('passwordHash');
    expect(JSON.stringify(detail)).not.toContain('password_hash');
    await service.updateMembership(ownCrew, membership.id, false);
    expect(await service.list(actor())).toEqual([]);
    await expect(service.detail(ownCrew, actor())).rejects.toMatchObject({ status: 404 });
    expect(
      (await service.detail(ownCrew, dispatcher)).members.some(
        ({ id, active }) => id === membership.id && !active,
      ),
    ).toBe(true);
    await service.addMember(foreignCrew, employee.id);
    expect((await service.list(actor())).map(({ id }) => id)).toEqual([foreignCrew]);
    await expect(service.updateMembership(ownCrew, membership.id, true)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      source
        .getRepository(CrewMember)
        .insert({ userId: employee.id, crewId: ownCrew, active: true }),
    ).rejects.toThrow();
  });

  it('keeps disabled crews and external contacts in history and rejects inactive employees', async () => {
    const crewId = await service.create({
      code: 'TEST-NEW',
      name: 'New Test Crew',
      serviceArea: 'Demo',
      workEnvironment: 'OUTDOOR',
    });
    await service.createContact(crewId, {
      name: 'Demo External',
      specialty: 'Electrical',
      email: 'external@example.invalid',
    });
    const detail = await service.detail(crewId, dispatcher);
    const contact = detail.contacts[0];
    if (!contact) throw new Error('Contact missing.');
    const usersBefore = await source.getRepository(User).count();
    await service.updateContact(crewId, contact.id, { active: false, phone: '+39 000 000000' });
    await service.update(crewId, { active: false });
    const disabled = await service.detail(crewId, dispatcher);
    expect(disabled.active).toBe(false);
    expect(disabled.contacts).toHaveLength(1);
    expect(disabled.contacts[0]?.active).toBe(false);
    expect(await source.getRepository(User).count()).toBe(usersBefore);
    expect(await source.getRepository(ExternalParticipant).countBy({ crewId })).toBe(1);
    await source.getRepository(User).update(employee.id, { active: false });
    await expect(service.addMember(crewId, employee.id)).rejects.toMatchObject({ status: 409 });
    expect(
      (await service.list(dispatcher)).some(({ id, active }) => id === crewId && !active),
    ).toBe(true);
  });

  it('seeds 42 unique accounts and 40 memberships once, preserves hashes/roles/disabled membership edits and needs no password on rerun', async () => {
    await expect(seedIdentity(source, 'production', 'fixture-only-password')).rejects.toThrow();
    await expect(seedIdentity(source, 'test')).rejects.toThrow('SEED_PASSWORD');
    await seedIdentity(source, 'test', 'fixture-only-seed-password');
    const users = await source
      .getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.username LIKE :pattern', { pattern: 'demo.%' })
      .getMany();
    expect(users).toHaveLength(42);
    expect(users.filter(({ role }) => role === 'ADMIN')).toHaveLength(1);
    expect(users.filter(({ role }) => role === 'DISPATCHER')).toHaveLength(1);
    expect(users.filter(({ role }) => role === 'CREW_MEMBER')).toHaveLength(40);
    expect(new Set(users.map(({ passwordHash }) => passwordHash)).size).toBe(42);
    const person = users.find(({ username }) => username === 'demo.crew01.member01');
    if (!person) throw new Error('Demo employee missing.');
    expect(await verifyPassword('fixture-only-seed-password', person.passwordHash)).toBe(true);
    const membership = await source
      .getRepository(CrewMember)
      .findOneByOrFail({ userId: person.id });
    expect(
      await source.getRepository(CrewMember).countBy({ crewId: membership.crewId }),
    ).toBeGreaterThanOrEqual(4);
    await source
      .getRepository(User)
      .update(person.id, { active: false, displayName: 'Edited Demo', role: 'DISPATCHER' });
    await source.getRepository(CrewMember).update(membership.id, { active: false });
    await Promise.all([
      seedIdentity(source, 'test'),
      seedIdentity(source, 'test', 'different-never-applied-password'),
    ]);
    const preserved = await source
      .getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id: person.id })
      .getOneOrFail();
    expect(preserved.passwordHash).toBe(person.passwordHash);
    expect(preserved.active).toBe(false);
    expect(preserved.displayName).toBe('Edited Demo');
    expect(preserved.role).toBe('DISPATCHER');
    expect(
      (await source.getRepository(CrewMember).findOneByOrFail({ id: membership.id })).active,
    ).toBe(false);
    expect(await source.getRepository(User).countBy({ username: Like('demo.%') })).toBe(42);
    const demoIds = new Set(users.map(({ id }) => id));
    expect(
      (await source.getRepository(CrewMember).find()).filter(({ userId }) => demoIds.has(userId)),
    ).toHaveLength(40);
    expect(demoUsers).toHaveLength(42);
  }, 120000);
});
