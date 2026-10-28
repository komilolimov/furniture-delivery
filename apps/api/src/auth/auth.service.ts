import { markRealtime } from '../realtime/post-commit';
import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '@furniture-delivery/contracts';
import { IsNull, MoreThan } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { DatabaseService } from '../database/database.service';
import { User } from '../identity/user.entity';
import { AuthSession } from '../identity/auth-session.entity';
import { CrewMember } from '../identity/crew-member.entity';
import { AUTH_CONFIG } from './auth.types';
import type { AuthConfig } from './auth.types';
import { dummyPasswordHash, verifyPassword } from './password';

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function userResponse(manager: EntityManager, user: User): Promise<AuthUser> {
  const memberships =
    user.role === 'CREW_MEMBER'
      ? await manager.getRepository(CrewMember).find({ where: { userId: user.id, active: true } })
      : [];
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    crewIds: memberships.map(({ crewId }) => crewId).sort(),
  };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async login(
    username: string,
    password: string,
    previousToken?: string,
  ): Promise<{ user: AuthUser; token: string; expiresAt: Date }> {
    const dataSource = await this.database.getDataSource();
    const candidate = await dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.username = :username', { username })
      .getOne();
    const verified = await verifyPassword(password, candidate?.passwordHash ?? dummyPasswordHash);
    if (!candidate || !verified || !candidate.active) {
      throw new UnauthorizedException('Invalid username or password.');
    }
    return dataSource.transaction(async (manager) => {
      const user = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .setLock('pessimistic_write')
        .where('user.id = :id', { id: candidate.id })
        .getOne();
      // A disable/password change that completed during the expensive verification wins.
      if (!user?.active || user.passwordHash !== candidate.passwordHash) {
        throw new UnauthorizedException('Invalid username or password.');
      }
      const token = randomBytes(32).toString('base64url');
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + this.config.sessionTtlSeconds * 1000);
      if (previousToken) {
        const previousSession = await manager
          .getRepository(AuthSession)
          .findOneBy({ tokenHash: hashSessionToken(previousToken), revokedAt: IsNull() });
        await manager
          .getRepository(AuthSession)
          .update(
            { tokenHash: hashSessionToken(previousToken), revokedAt: IsNull() },
            { revokedAt: new Date() },
          );
        if (previousSession)
          markRealtime(manager, { backoffice: [], sessionId: previousSession.id });
      }
      await manager
        .getRepository(AuthSession)
        .insert({ userId: user.id, tokenHash: hashSessionToken(token), createdAt, expiresAt });
      return { user: await userResponse(manager, user), token, expiresAt };
    });
  }

  async resolveSession(token: string): Promise<{ user: AuthUser; sessionId: string } | undefined> {
    const dataSource = await this.database.getDataSource();
    const session = await dataSource.getRepository(AuthSession).findOne({
      where: {
        tokenHash: hashSessionToken(token),
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!session) return undefined;
    const user = await dataSource
      .getRepository(User)
      .findOneBy({ id: session.userId, active: true });
    if (!user) return undefined;
    return { user: await userResponse(dataSource.manager, user), sessionId: session.id };
  }

  async logout(sessionId: string): Promise<void> {
    const dataSource = await this.database.getDataSource();
    await dataSource.transaction(async (manager) => {
      const result = await manager
        .getRepository(AuthSession)
        .update({ id: sessionId, revokedAt: IsNull() }, { revokedAt: new Date() });
      if (result.affected) markRealtime(manager, { backoffice: [], sessionId });
    });
  }
}
