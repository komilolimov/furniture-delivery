import { markRealtime } from '../realtime/post-commit';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateTaskTemplateRequest,
  TaskTemplateListResponse,
  TaskTemplateRecord,
  TaskTemplateResponse,
  UpdateTaskTemplateRequest,
} from '@furniture-delivery/contracts';
import { QueryFailedError } from 'typeorm';
import { DatabaseService } from '../database/database.service';
import { TaskTemplate } from './task-template.entity';
import { PlanningConflict } from './planning-errors';
import { lockExecutionUser } from '../execution/execution-access';

export function mapTemplate(template: TaskTemplate): TaskTemplateRecord {
  return {
    id: template.id,
    code: template.code,
    name: template.name,
    description: template.description,
    active: template.active,
    required: template.required,
    severity: template.severity,
    defaultPriority: template.defaultPriority,
    applicability: template.applicability,
    createdBy: template.createdBy,
    updatedBy: template.updatedBy,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}
@Injectable()
export class TaskTemplatesService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  async list(): Promise<TaskTemplateListResponse> {
    const source = await this.database.getDataSource();
    return {
      templates: (
        await source
          .getRepository(TaskTemplate)
          .find({ order: { defaultPriority: 'ASC', code: 'ASC' } })
      ).map(mapTemplate),
    };
  }
  async create(
    input: CreateTaskTemplateRequest,
    actorId: string,
    sessionId?: string,
  ): Promise<TaskTemplateResponse> {
    const source = await this.database.getDataSource();
    try {
      return await source.transaction('READ COMMITTED', async (manager) => {
        await lockExecutionUser(manager, { id: actorId, sessionId });
        const template = await manager
          .getRepository(TaskTemplate)
          .save({ ...input, createdBy: actorId, updatedBy: actorId });
        markRealtime(manager, { backoffice: ['templates', 'planning'] });
        return { template: mapTemplate(template) };
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      )
        throw new PlanningConflict('TEMPLATE_CODE_EXISTS', 'This template code already exists.');
      throw error;
    }
  }
  async update(
    id: string,
    input: UpdateTaskTemplateRequest,
    actorId: string,
    sessionId?: string,
  ): Promise<TaskTemplateResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      await lockExecutionUser(manager, { id: actorId, sessionId });
      const template = await manager
        .getRepository(TaskTemplate)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!template) throw new NotFoundException('Task template not found.');
      Object.assign(template, input, { updatedBy: actorId });
      await manager.save(TaskTemplate, template);
      markRealtime(manager, { backoffice: ['templates', 'planning'] });
      return { template: mapTemplate(template) };
    });
  }
}
