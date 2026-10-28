import { markRealtime } from '../realtime/post-commit';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser, CreateUserRequest, UpdateUserRequest } from '@furniture-delivery/contracts';
import { IsNull } from 'typeorm';
import { DatabaseService } from '../database/database.service';
import { User } from '../identity/user.entity';
import { CrewMember } from '../identity/crew-member.entity';
import { AuthSession } from '../identity/auth-session.entity';
import { hashPassword } from '../auth/password';
import { userResponse } from '../auth/auth.service';

@Injectable()
export class UsersService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async list(): Promise<AuthUser[]> {
    const source = await this.database.getDataSource();
    const users = await source.getRepository(User).find({ order: { username: 'ASC' } });
    return Promise.all(users.map((user) => userResponse(source.manager, user)));
  }

  async find(id: string): Promise<AuthUser> {
    const source = await this.database.getDataSource();
    const user = await source.getRepository(User).findOneBy({ id });
    if (!user) throw new NotFoundException('User not found.');
    return userResponse(source.manager, user);
  }

  async create(input: CreateUserRequest): Promise<AuthUser> {
    const passwordHash = await hashPassword(input.password);
    const source = await this.database.getDataSource();
    try {
      return await source.transaction(async (manager) => {
        const user = manager.getRepository(User).create({
          username: input.username,
          displayName: input.displayName,
          passwordHash,
          role: input.role,
          active: input.active ?? true,
        });
        await manager.getRepository(User).save(user);
        markRealtime(manager, {
          backoffice:
            user.role === 'CREW_MEMBER' && user.active ? ['accounts', 'crews'] : ['accounts'],
        });
        return userResponse(manager, user);
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new ConflictException('Username already exists.');
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateUserRequest): Promise<AuthUser> {
    const passwordHash =
      input.password === undefined ? undefined : await hashPassword(input.password);
    const source = await this.database.getDataSource();
    return source.transaction(async (manager) => {
      // The same User lock serializes account changes and crew membership mutations.
      const user = await manager.getRepository(User).findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('User not found.');
      const memberships = await manager.getRepository(CrewMember).findBy({ userId: id });
      const crewIds = [...new Set(memberships.map(({ crewId }) => crewId))].sort();
      const hadActiveMembership = memberships.some(({ active }) => active);
      const wasCandidate = user.active && user.role === 'CREW_MEMBER' && !hadActiveMembership;
      const permissionsChanged =
        (input.role !== undefined && input.role !== user.role) ||
        (input.active !== undefined && input.active !== user.active);
      const publicIdentityChanged =
        permissionsChanged ||
        (input.displayName !== undefined && input.displayName !== user.displayName);
      if (input.displayName !== undefined) user.displayName = input.displayName;
      if (input.active !== undefined) user.active = input.active;
      if (input.role !== undefined) user.role = input.role;
      if (passwordHash !== undefined) user.passwordHash = passwordHash;
      if (user.role !== 'CREW_MEMBER') {
        await manager
          .getRepository(CrewMember)
          .update({ userId: id, active: true }, { active: false });
      }
      await manager.getRepository(User).save(user);
      if (permissionsChanged || passwordHash !== undefined) {
        await manager
          .getRepository(AuthSession)
          .update({ userId: id, revokedAt: IsNull() }, { revokedAt: new Date() });
      }
      const isCandidate = user.active && user.role === 'CREW_MEMBER' && !hadActiveMembership;
      // Crew DTOs retain former roster members with their current public identity.
      const rosterChanged = publicIdentityChanged && crewIds.length > 0;
      const candidatesChanged = publicIdentityChanged && (wasCandidate || isCandidate);
      markRealtime(manager, {
        backoffice: rosterChanged || candidatesChanged ? ['accounts', 'crews'] : ['accounts'],
        userId: id,
        ...(rosterChanged ? { crewIds, crew: ['crew-team'] as const } : {}),
      });
      return userResponse(manager, user);
    });
  }
}
