import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AuthUser,
  CreateCrewRequest,
  CreateExternalContactRequest,
  CrewDetail,
  CrewSummary,
  PublicUser,
  UpdateCrewRequest,
  UpdateExternalContactRequest,
} from '@furniture-delivery/contracts';
import { Not, QueryFailedError } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { DatabaseService } from '../database/database.service';
import { CrewMember } from '../identity/crew-member.entity';
import { ExternalParticipant } from '../identity/external-participant.entity';
import { User } from '../identity/user.entity';
import { Crew } from './crew.entity';

export function mapCrew(crew: Crew): CrewSummary {
  return {
    id: crew.id,
    code: crew.code,
    name: crew.name,
    active: crew.active,
    workEnvironment: crew.workEnvironment,
    serviceArea: crew.serviceArea,
    createdAt: crew.createdAt.toISOString(),
    updatedAt: crew.updatedAt.toISOString(),
  };
}

function mapUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
  };
}

function conflict(error: unknown): never {
  if (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string }).code === '23505'
  ) {
    throw new ConflictException('The code or active membership already exists.');
  }
  throw error;
}

@Injectable()
export class CrewsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async list(actor: AuthUser): Promise<CrewSummary[]> {
    const source = await this.database.getDataSource();
    const query = source.getRepository(Crew).createQueryBuilder('crew');
    if (actor.role === 'CREW_MEMBER') {
      query.innerJoin(
        CrewMember,
        'member',
        'member.crewId = crew.id AND member.userId = :userId AND member.active = true',
        { userId: actor.id },
      );
    }
    return (await query.orderBy('crew.code', 'ASC').getMany()).map(mapCrew);
  }

  async detail(id: string, actor: AuthUser): Promise<CrewDetail> {
    const source = await this.database.getDataSource();
    const query = source
      .getRepository(Crew)
      .createQueryBuilder('crew')
      .where('crew.id = :id', { id });
    if (actor.role === 'CREW_MEMBER') {
      query.innerJoin(
        CrewMember,
        'member',
        'member.crewId = crew.id AND member.userId = :userId AND member.active = true',
        { userId: actor.id },
      );
    }
    const crew = await query.getOne();
    // The same 404 covers absent records and records outside the caller's current membership.
    if (!crew) throw new NotFoundException('Crew not found.');
    const [members, contacts] = await Promise.all([
      source.getRepository(CrewMember).find({
        where: { crewId: id },
        relations: { user: true },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
      source
        .getRepository(ExternalParticipant)
        .find({ where: { crewId: id }, order: { createdAt: 'ASC', id: 'ASC' } }),
    ]);
    return {
      ...mapCrew(crew),
      members: members.map((member) => ({
        id: member.id,
        userId: member.userId,
        crewId: member.crewId,
        active: member.active,
        createdAt: member.createdAt.toISOString(),
        updatedAt: member.updatedAt.toISOString(),
        user: mapUser(member.user),
      })),
      contacts: contacts.map((contact) => ({
        id: contact.id,
        crewId: contact.crewId,
        name: contact.name,
        specialty: contact.specialty,
        phone: contact.phone,
        email: contact.email,
        active: contact.active,
        createdAt: contact.createdAt.toISOString(),
        updatedAt: contact.updatedAt.toISOString(),
      })),
    };
  }

  async candidates(): Promise<PublicUser[]> {
    const source = await this.database.getDataSource();
    const users = await source
      .getRepository(User)
      .createQueryBuilder('user')
      .leftJoin(CrewMember, 'member', 'member.userId = user.id AND member.active = true')
      .where('user.active = true AND user.role = :role AND member.id IS NULL', {
        role: 'CREW_MEMBER',
      })
      .orderBy('user.username', 'ASC')
      .getMany();
    return users.map(mapUser);
  }

  async create(input: CreateCrewRequest): Promise<string> {
    const source = await this.database.getDataSource();
    try {
      const crew = await source
        .getRepository(Crew)
        .save(source.getRepository(Crew).create({ ...input, active: input.active ?? true }));
      return crew.id;
    } catch (error) {
      conflict(error);
    }
  }

  private async crew(manager: EntityManager, id: string): Promise<Crew> {
    const crew = await manager
      .getRepository(Crew)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!crew) throw new NotFoundException('Crew not found.');
    return crew;
  }

  async update(id: string, input: UpdateCrewRequest): Promise<void> {
    const source = await this.database.getDataSource();
    await source.transaction(async (manager) => {
      const crew = await this.crew(manager, id);
      Object.assign(crew, input);
      await manager.save(Crew, crew);
    });
  }

  async addMember(crewId: string, userId: string): Promise<void> {
    const source = await this.database.getDataSource();
    try {
      await source.transaction(async (manager) => {
        const user = await manager
          .getRepository(User)
          .findOne({ where: { id: userId }, lock: { mode: 'pessimistic_write' } });
        if (!user) throw new NotFoundException('User not found.');
        const crew = await this.crew(manager, crewId);
        if (!user.active || user.role !== 'CREW_MEMBER' || !crew.active) {
          throw new ConflictException('An active employee and an active crew are required.');
        }
        if (await manager.getRepository(CrewMember).existsBy({ userId, active: true })) {
          throw new ConflictException('The employee already has an active membership.');
        }
        const membership = await manager.getRepository(CrewMember).findOneBy({ userId, crewId });
        if (membership) {
          membership.active = true;
          await manager.save(CrewMember, membership);
        } else {
          await manager.insert(CrewMember, { userId, crewId, active: true });
        }
      });
    } catch (error) {
      conflict(error);
    }
  }

  async updateMembership(crewId: string, membershipId: string, active: boolean): Promise<void> {
    const source = await this.database.getDataSource();
    try {
      await source.transaction(async (manager) => {
        // Read the immutable user id, then lock User before Crew on every membership write.
        const previous = await manager
          .getRepository(CrewMember)
          .findOneBy({ id: membershipId, crewId });
        if (!previous) throw new NotFoundException('Membership not found.');
        const user = await manager
          .getRepository(User)
          .findOne({ where: { id: previous.userId }, lock: { mode: 'pessimistic_write' } });
        const crew = await this.crew(manager, crewId);
        const membership = await manager
          .getRepository(CrewMember)
          .findOneByOrFail({ id: membershipId, crewId });
        if (active && (!user?.active || user.role !== 'CREW_MEMBER' || !crew.active)) {
          throw new ConflictException('An active employee and an active crew are required.');
        }
        if (
          active &&
          (await manager
            .getRepository(CrewMember)
            .existsBy({ userId: membership.userId, active: true, id: Not(membership.id) }))
        ) {
          throw new ConflictException('The employee already has an active membership.');
        }
        membership.active = active;
        await manager.save(CrewMember, membership);
      });
    } catch (error) {
      conflict(error);
    }
  }

  async createContact(crewId: string, input: CreateExternalContactRequest): Promise<void> {
    const source = await this.database.getDataSource();
    await source.transaction(async (manager) => {
      await this.crew(manager, crewId);
      await manager.insert(ExternalParticipant, {
        ...input,
        crewId,
        phone: input.phone ?? null,
        email: input.email ?? null,
        active: input.active ?? true,
      });
    });
  }

  async updateContact(
    crewId: string,
    contactId: string,
    input: UpdateExternalContactRequest,
  ): Promise<void> {
    const source = await this.database.getDataSource();
    await source.transaction(async (manager) => {
      await this.crew(manager, crewId);
      const contact = await manager
        .getRepository(ExternalParticipant)
        .findOneBy({ id: contactId, crewId });
      if (!contact) throw new NotFoundException('Contact not found.');
      Object.assign(contact, input);
      await manager.save(ExternalParticipant, contact);
    });
  }
}
