import { markRealtime } from '../realtime/post-commit';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CrewAvailabilityResponse,
  CrewPlanningConfigRecord,
  CreateCrewUnavailabilityRequest,
  UpdateCrewPlanningRequest,
  UpdateCrewUnavailabilityRequest,
} from '@furniture-delivery/contracts';
import type { EntityManager } from 'typeorm';
import { DatabaseService } from '../database/database.service';
import { Crew } from '../crews/crew.entity';
import { Appointment } from './appointment.entity';
import { CrewAssignment } from './crew-assignment.entity';
import { CrewPlanningConfig } from './crew-planning-config.entity';
import { CrewUnavailability } from './crew-unavailability.entity';
import { PlanningConflict } from './planning-errors';
import { defaultWorkingWindows } from './planning-defaults';
import { localToUtc } from './planning-time';
import { readAppointment } from './planning-projection';
import { lockExecutionUser } from '../execution/execution-access';

@Injectable()
export class CrewAvailabilityService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  private async crew(manager: EntityManager, id: string, lock = false): Promise<Crew> {
    const crew = await manager.getRepository(Crew).findOne({
      where: { id },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!crew) throw new NotFoundException('Team not found.');
    return crew;
  }
  private async read(manager: EntityManager, crew: Crew): Promise<CrewAvailabilityResponse> {
    const stored = await manager.getRepository(CrewPlanningConfig).findOneBy({ crewId: crew.id });
    const config: CrewPlanningConfigRecord = stored
      ? {
          crewId: crew.id,
          weeklyWindows: stored.weeklyWindows,
          travelBufferMinutes: stored.travelBufferMinutes,
          version: stored.version,
          updatedBy: stored.updatedBy,
          createdAt: stored.createdAt.toISOString(),
          updatedAt: stored.updatedAt.toISOString(),
        }
      : {
          crewId: crew.id,
          weeklyWindows: defaultWorkingWindows(),
          travelBufferMinutes: 30,
          version: 0,
          updatedBy: null,
          createdAt: crew.createdAt.toISOString(),
          updatedAt: crew.updatedAt.toISOString(),
        };
    const intervals = await manager
      .getRepository(CrewUnavailability)
      .find({ where: { crewId: crew.id }, order: { startAt: 'ASC', id: 'ASC' } });
    const appointments = await manager
      .getRepository(Appointment)
      .createQueryBuilder('appointment')
      .innerJoin(
        CrewAssignment,
        'assignment',
        'assignment.appointmentId = appointment.id AND assignment.status = :assigned',
        { assigned: 'ASSIGNED' },
      )
      .where('assignment.crewId = :crewId AND appointment.status = :scheduled', {
        crewId: crew.id,
        scheduled: 'SCHEDULED',
      })
      .orderBy('appointment.plannedStartAt', 'ASC')
      .getMany();
    const affectedAppointments = [];
    for (const appointment of appointments) {
      const detail = await readAppointment(manager, appointment.id);
      if (detail.attention.some((issue) => issue.crewId === crew.id))
        affectedAppointments.push(detail);
    }
    return {
      config,
      unavailability: intervals.map((row) => ({
        id: row.id,
        crewId: row.crewId,
        startAt: row.startAt.toISOString(),
        endAt: row.endAt.toISOString(),
        reason: row.reason,
        active: row.active,
        createdBy: row.createdBy,
        updatedBy: row.updatedBy,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      affectedAppointments,
    };
  }
  async get(crewId: string): Promise<CrewAvailabilityResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('REPEATABLE READ', async (manager) =>
      this.read(manager, await this.crew(manager, crewId)),
    );
  }
  async updateConfig(
    crewId: string,
    input: UpdateCrewPlanningRequest,
    actorId: string,
    sessionId?: string,
  ): Promise<CrewAvailabilityResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      await lockExecutionUser(manager, { id: actorId, sessionId });
      const crew = await this.crew(manager, crewId, true);
      const previous = await manager.getRepository(CrewPlanningConfig).findOneBy({ crewId });
      if ((previous?.version ?? 0) !== input.expectedVersion)
        throw new PlanningConflict(
          'STALE_AVAILABILITY_VERSION',
          'The working configuration changed. Reload before saving.',
          { crewId },
        );
      if (
        previous &&
        JSON.stringify(previous.weeklyWindows) === JSON.stringify(input.weeklyWindows) &&
        previous.travelBufferMinutes === input.travelBufferMinutes
      )
        return this.read(manager, crew);
      if ((previous?.version ?? 0) >= 2147483647)
        throw new PlanningConflict(
          'REVISION_LIMIT',
          'The working configuration revision limit has been reached.',
          { crewId },
        );
      await manager.save(
        CrewPlanningConfig,
        manager.create(CrewPlanningConfig, {
          crewId,
          weeklyWindows: input.weeklyWindows,
          travelBufferMinutes: input.travelBufferMinutes,
          version: (previous?.version ?? 0) + 1,
          updatedBy: actorId,
        }),
      );
      markRealtime(manager, { backoffice: ['planning'] });
      // User SHARE precedes Crew. Never acquire Order/Appointment locks from this path.
      return this.read(manager, crew);
    });
  }
  async createUnavailability(
    crewId: string,
    input: CreateCrewUnavailabilityRequest,
    actorId: string,
    sessionId?: string,
  ): Promise<CrewAvailabilityResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      await lockExecutionUser(manager, { id: actorId, sessionId });
      const crew = await this.crew(manager, crewId, true);
      const startAt = localToUtc(input.localStart),
        endAt = localToUtc(input.localEnd);
      if (startAt >= endAt) throw new BadRequestException('Unavailability start must precede end.');
      await manager.save(
        CrewUnavailability,
        manager.create(CrewUnavailability, {
          crewId,
          startAt,
          endAt,
          reason: input.reason,
          active: true,
          createdBy: actorId,
          updatedBy: actorId,
        }),
      );
      markRealtime(manager, { backoffice: ['planning'] });
      return this.read(manager, crew);
    });
  }
  async updateUnavailability(
    crewId: string,
    id: string,
    input: UpdateCrewUnavailabilityRequest,
    actorId: string,
    sessionId?: string,
  ): Promise<CrewAvailabilityResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      await lockExecutionUser(manager, { id: actorId, sessionId });
      const crew = await this.crew(manager, crewId, true);
      const interval = await manager.getRepository(CrewUnavailability).findOneBy({ id, crewId });
      if (!interval) throw new NotFoundException('Unavailability not found for this team.');
      const startAt =
          input.localStart === undefined ? interval.startAt : localToUtc(input.localStart),
        endAt = input.localEnd === undefined ? interval.endAt : localToUtc(input.localEnd);
      if (startAt >= endAt) throw new BadRequestException('Unavailability start must precede end.');
      Object.assign(interval, {
        startAt,
        endAt,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        ...(input.active === undefined ? {} : { active: input.active }),
        updatedBy: actorId,
      });
      await manager.save(CrewUnavailability, interval);
      markRealtime(manager, { backoffice: ['planning'] });
      return this.read(manager, crew);
    });
  }
}
