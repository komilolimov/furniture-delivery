import type { DataSource } from 'typeorm';
import type { UserRole } from '@furniture-delivery/contracts';
import { hashPassword } from '../auth/password';
import type { AppConfig } from '../config/environment';
import { Crew } from '../crews/crew.entity';
import { CrewMember } from '../identity/crew-member.entity';
import { User } from '../identity/user.entity';
import { assertSeedAllowed } from './demo-crews';

interface DemoUser {
  username: string;
  displayName: string;
  role: UserRole;
  crewCode?: string;
}

export const demoUsers: DemoUser[] = [
  { username: 'demo.admin', displayName: 'Demo Administrator', role: 'ADMIN' },
  { username: 'demo.dispatcher', displayName: 'Demo Dispatcher', role: 'DISPATCHER' },
  ...Array.from({ length: 10 }, (_, crewIndex) =>
    Array.from({ length: 4 }, (_, memberIndex): DemoUser => {
      const crewNumber = String(crewIndex + 1).padStart(2, '0');
      const memberNumber = String(memberIndex + 1).padStart(2, '0');
      return {
        username: `demo.crew${crewNumber}.member${memberNumber}`,
        displayName: `Demo Crew ${crewNumber} Member ${memberNumber}`,
        role: 'CREW_MEMBER',
        crewCode: `DEMO-${crewNumber}`,
      };
    }),
  ).flat(),
];

export async function seedIdentity(
  dataSource: DataSource,
  nodeEnv: AppConfig['nodeEnv'],
  seedPassword?: string,
): Promise<void> {
  assertSeedAllowed(nodeEnv);
  const existing = new Set(
    (await dataSource.getRepository(User).find({ select: { username: true } })).map(
      ({ username }) => username,
    ),
  );
  const missing = demoUsers.filter(({ username }) => !existing.has(username));
  if (missing.length === 0) return;
  if (
    !seedPassword ||
    seedPassword.startsWith('replace-with-') ||
    seedPassword.length < 12 ||
    seedPassword.length > 128 ||
    Buffer.byteLength(seedPassword, 'utf8') > 512
  ) {
    throw new Error('Missing demo accounts require SEED_PASSWORD with 12–128 characters.');
  }
  // Hash outside the transaction, sequentially to bound scrypt memory. Every account gets its own salt.
  const prepared: (DemoUser & { passwordHash: string })[] = [];
  for (const demo of missing)
    prepared.push({ ...demo, passwordHash: await hashPassword(seedPassword) });

  await dataSource.transaction(async (manager) => {
    for (const { crewCode, ...user } of prepared) {
      // Concurrent seed runners may have inserted this username while hashes were calculated.
      const result = await manager
        .createQueryBuilder()
        .insert()
        .into(User)
        .values({ ...user, active: true })
        .onConflict('("username") DO NOTHING')
        .returning('id')
        .execute();
      const row = (result.raw as { id: string }[])[0];
      if (!row || !crewCode) continue;
      const crew = await manager.getRepository(Crew).findOneByOrFail({ code: crewCode });
      // Membership is initialized only for an account this run actually created.
      // Existing accounts, transfers, removals and disabled states are never changed by seed.
      await manager.insert(CrewMember, { userId: row.id, crewId: crew.id, active: true });
    }
  });
}
