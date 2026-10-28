import { markEvidence } from '../realtime/realtime-marks';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ActivityAction,
  CreateExecutionNoteRequest,
  CreateIssueNoteRequest,
  CreateIssueRequest,
  EvidenceLimits,
  EvidenceResponse,
  ExecutionNoteResponse,
  IssueCommandRequest,
  IssueListQuery,
  IssueListResponse,
  IssueResponse,
} from '@furniture-delivery/contracts';
import type { EntityManager } from 'typeorm';
import { DatabaseService } from '../database/database.service';
import { reopenCurrentCompletionIn } from '../completion/completion-state';
import { Order } from '../orders/order.entity';
import { ActivityLog } from '../orders/activity-log.entity';
import { lockExecutionUser, type ExecutionActor } from '../execution/execution-access';
import { PlanningConflict } from '../planning/planning-errors';
import {
  authorizeEvidence,
  assertEvidenceLinks,
  evidenceProvenance,
  type EvidenceContext,
  type EvidenceScope,
} from './evidence-access';
import {
  evidenceFingerprint,
  findEvidenceReceipt,
  mapEvidenceReceipt,
  saveEvidenceReceipt,
} from './evidence-receipts';
import { mapExecutionNote, readEvidence, readIssue } from './evidence-projection';
import { ExecutionNote } from './execution-note.entity';
import { Issue } from './issue.entity';
import { IssueEvent } from './issue-event.entity';
import { IssueItem } from './issue-item.entity';
import { IssueAttachment } from './issue-attachment.entity';
import { EVIDENCE_LIMITS } from './evidence-config';
@Injectable()
export class EvidenceService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(EVIDENCE_LIMITS) private readonly limits: EvidenceLimits,
  ) {}
  private async audit(
    manager: EntityManager,
    context: EvidenceContext,
    actorId: string,
    action: ActivityAction,
    targetId: string,
    changes: Record<string, unknown>,
    reason: string | null = null,
  ): Promise<void> {
    await manager.save(
      ActivityLog,
      manager.create(ActivityLog, {
        orderId: context.order.id,
        actorId,
        action,
        targetId,
        changes: { ...changes, ...(reason ? { reason } : {}) },
        reason: reason?.slice(0, 1000) ?? null,
      }),
    );
    markEvidence(manager, context.order.id, String(changes.visibility ?? 'BACKOFFICE_ONLY'));
  }
  private async touch(
    manager: EntityManager,
    context: EvidenceContext,
    actorId: string,
  ): Promise<void> {
    if (context.order.version >= 2147483647)
      throw new PlanningConflict('VERSION_LIMIT', 'Order revision limit reached.');
    context.order.version++;
    context.order.updatedBy = actorId;
    await manager.save(Order, context.order);
  }
  private async event(
    manager: EntityManager,
    issueId: string,
    actorId: string,
    kind: IssueEvent['kind'],
    text: string,
  ): Promise<void> {
    await manager.save(IssueEvent, manager.create(IssueEvent, { issueId, actorId, kind, text }));
  }
  async read(actor: ExecutionActor, scope: EvidenceScope): Promise<EvidenceResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('REPEATABLE READ', async (manager) =>
      readEvidence(
        manager,
        await authorizeEvidence(manager, actor, scope, { lock: false }),
        this.limits,
      ),
    );
  }
  async createNote(
    actor: ExecutionActor,
    scope: EvidenceScope,
    input: CreateExecutionNoteRequest,
  ): Promise<ExecutionNoteResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      const context = await authorizeEvidence(manager, actor, scope, {
        lock: true,
        requireDeparted: true,
      });
      const provenance = await evidenceProvenance(manager, context, input);
      const fingerprint = evidenceFingerprint({ scope, ...input });
      const replay = await findEvidenceReceipt(
        manager,
        actor.id,
        context.order.id,
        'NOTE_CREATE',
        input.operationKey,
        fingerprint,
      );
      if (replay) {
        const note = await manager
          .getRepository(ExecutionNote)
          .findOneBy({ id: replay.resultId!, orderId: context.order.id });
        if (!note || (context.crewVisible && note.visibility !== 'CREW_VISIBLE'))
          throw new NotFoundException('Note not found.');
        return { note: mapExecutionNote(note), receipt: mapEvidenceReceipt(replay) };
      }
      const note = await manager.save(
        ExecutionNote,
        manager.create(ExecutionNote, {
          orderId: context.order.id,
          ...provenance,
          visibility: context.crewVisible
            ? 'CREW_VISIBLE'
            : (input.visibility ?? 'BACKOFFICE_ONLY'),
          text: input.text,
          authorId: actor.id,
        }),
      );
      await this.touch(manager, context, actor.id);
      await this.audit(manager, context, actor.id, 'EXECUTION_NOTE_ADDED', note.id, {
        assignmentId: note.assignmentId,
        itemId: note.itemId,
        visibility: note.visibility,
      });
      const receipt = await saveEvidenceReceipt(
        manager,
        actor.id,
        context.order.id,
        'NOTE_CREATE',
        input.operationKey,
        fingerprint,
        note.id,
      );
      return { note: mapExecutionNote(note), receipt: mapEvidenceReceipt(receipt) };
    });
  }
  async createIssue(
    actor: ExecutionActor,
    scope: EvidenceScope,
    input: CreateIssueRequest,
  ): Promise<IssueResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      const context = await authorizeEvidence(manager, actor, scope, {
        lock: true,
        requireDeparted: true,
      });
      const provenance = await evidenceProvenance(manager, context, input);
      const visibility = context.crewVisible
        ? 'CREW_VISIBLE'
        : (input.visibility ?? 'BACKOFFICE_ONLY');
      const fingerprint = evidenceFingerprint({ scope, ...input });
      const replay = await findEvidenceReceipt(
        manager,
        actor.id,
        context.order.id,
        'ISSUE_CREATE',
        input.operationKey,
        fingerprint,
      );
      if (replay)
        return {
          issue: await readIssue(manager, context, replay.resultId!),
          receipt: mapEvidenceReceipt(replay),
        };
      await assertEvidenceLinks(manager, context, {
        itemIds: input.itemIds,
        attachmentIds: input.attachmentIds,
        visibility,
      });
      const issue = await manager.save(
        Issue,
        manager.create(Issue, {
          orderId: context.order.id,
          appointmentId: provenance.appointmentId,
          assignmentId: provenance.assignmentId,
          visibility,
          type: input.type,
          description: input.description,
          reportedSource: input.reportedSource,
          status: 'OPEN',
          version: 1,
          authorId: actor.id,
          resolvedAt: null,
          resolvedBy: null,
          resolution: null,
        }),
      );
      for (const itemId of input.itemIds ?? [])
        await manager.save(
          IssueItem,
          manager.create(IssueItem, { issueId: issue.id, itemId, orderId: context.order.id }),
        );
      for (const attachmentId of input.attachmentIds ?? [])
        await manager.save(
          IssueAttachment,
          manager.create(IssueAttachment, {
            issueId: issue.id,
            attachmentId,
            orderId: context.order.id,
          }),
        );
      await reopenCurrentCompletionIn(
        manager,
        context.order,
        actor.id,
        'Reported issue ' + issue.id,
        'ISSUE',
        issue.id,
      );
      await this.event(manager, issue.id, actor.id, 'CREATED', input.description);
      if (input.notes) await this.event(manager, issue.id, actor.id, 'NOTE', input.notes);
      await this.touch(manager, context, actor.id);
      await this.audit(manager, context, actor.id, 'ISSUE_CREATED', issue.id, {
        type: issue.type,
        visibility,
        itemIds: input.itemIds ?? [],
        attachmentIds: input.attachmentIds ?? [],
      });
      const receipt = await saveEvidenceReceipt(
        manager,
        actor.id,
        context.order.id,
        'ISSUE_CREATE',
        input.operationKey,
        fingerprint,
        issue.id,
      );
      return {
        issue: await readIssue(manager, context, issue.id),
        receipt: mapEvidenceReceipt(receipt),
      };
    });
  }
  private async issueLock(
    manager: EntityManager,
    context: EvidenceContext,
    issueId: string,
  ): Promise<Issue> {
    const issue = await manager.getRepository(Issue).findOne({
      where: { id: issueId, orderId: context.order.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!issue || (context.crewVisible && issue.visibility !== 'CREW_VISIBLE'))
      throw new NotFoundException('Issue not found for this order.');
    return issue;
  }
  async issueNote(
    actor: ExecutionActor,
    scope: EvidenceScope,
    issueId: string,
    input: CreateIssueNoteRequest,
  ): Promise<IssueResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      const context = await authorizeEvidence(manager, actor, scope, {
        lock: true,
        requireDeparted: true,
      });
      const issue = await this.issueLock(manager, context, issueId);
      const fingerprint = evidenceFingerprint({ scope, issueId, ...input });
      const replay = await findEvidenceReceipt(
        manager,
        actor.id,
        context.order.id,
        'ISSUE_NOTE',
        input.operationKey,
        fingerprint,
      );
      if (replay)
        return {
          issue: await readIssue(manager, context, issueId),
          receipt: mapEvidenceReceipt(replay),
        };
      if (issue.version >= 2147483647)
        throw new PlanningConflict('VERSION_LIMIT', 'Issue revision limit reached.');
      issue.version++;
      await manager.save(Issue, issue);
      await this.event(manager, issue.id, actor.id, 'NOTE', input.text);
      await this.touch(manager, context, actor.id);
      await this.audit(manager, context, actor.id, 'ISSUE_NOTE_ADDED', issue.id, {
        visibility: issue.visibility,
        version: issue.version,
      });
      const receipt = await saveEvidenceReceipt(
        manager,
        actor.id,
        context.order.id,
        'ISSUE_NOTE',
        input.operationKey,
        fingerprint,
        issue.id,
      );
      return {
        issue: await readIssue(manager, context, issue.id),
        receipt: mapEvidenceReceipt(receipt),
      };
    });
  }
  async command(
    actor: ExecutionActor,
    orderId: string,
    issueId: string,
    action: 'RESOLVE' | 'REOPEN',
    input: IssueCommandRequest,
  ): Promise<IssueResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      const scope = { orderId };
      const context = await authorizeEvidence(manager, actor, scope, { lock: true });
      const issue = await this.issueLock(manager, context, issueId);
      const fingerprint = evidenceFingerprint({ scope, issueId, action, ...input });
      const replay = await findEvidenceReceipt(
        manager,
        actor.id,
        orderId,
        `ISSUE_${action}`,
        input.operationKey,
        fingerprint,
      );
      if (replay)
        return {
          issue: await readIssue(manager, context, issueId),
          receipt: mapEvidenceReceipt(replay),
        };
      if (issue.version !== input.expectedVersion)
        throw new PlanningConflict('STALE_ISSUE', 'This issue changed. Reload its current state.');
      if (action === 'RESOLVE' ? issue.status !== 'OPEN' : issue.status !== 'RESOLVED')
        throw new PlanningConflict(
          'ISSUE_TRANSITION',
          'This issue action is not available from its current state.',
        );
      if (issue.version >= 2147483647)
        throw new PlanningConflict('VERSION_LIMIT', 'Issue revision limit reached.');
      issue.version++;
      issue.status = action === 'RESOLVE' ? 'RESOLVED' : 'OPEN';
      issue.resolvedAt = action === 'RESOLVE' ? new Date() : null;
      issue.resolvedBy = action === 'RESOLVE' ? actor.id : null;
      issue.resolution = action === 'RESOLVE' ? input.reason : null;
      await manager.save(Issue, issue);
      if (action === 'REOPEN')
        await reopenCurrentCompletionIn(
          manager,
          context.order,
          actor.id,
          'Reopened issue ' + issue.id,
          'ISSUE',
          issue.id,
        );
      await this.event(
        manager,
        issue.id,
        actor.id,
        action === 'RESOLVE' ? 'RESOLVED' : 'REOPENED',
        input.reason,
      );
      await this.touch(manager, context, actor.id);
      await this.audit(
        manager,
        context,
        actor.id,
        action === 'RESOLVE' ? 'ISSUE_RESOLVED' : 'ISSUE_REOPENED',
        issue.id,
        { status: issue.status, version: issue.version, visibility: issue.visibility },
        input.reason,
      );
      const receipt = await saveEvidenceReceipt(
        manager,
        actor.id,
        orderId,
        `ISSUE_${action}`,
        input.operationKey,
        fingerprint,
        issue.id,
      );
      return {
        issue: await readIssue(manager, context, issue.id),
        receipt: mapEvidenceReceipt(receipt),
      };
    });
  }
  async listIssues(actor: ExecutionActor, input: IssueListQuery): Promise<IssueListResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('REPEATABLE READ', async (manager) => {
      await lockExecutionUser(manager, actor);
      const query = manager.getRepository(Issue).createQueryBuilder('issue');
      if (input.status) query.andWhere('issue.status = :status', { status: input.status });
      if (input.type) query.andWhere('issue.type = :type', { type: input.type });
      const total = await query.getCount();
      const rows = await query
        .orderBy('issue.createdAt', 'DESC')
        .addOrderBy('issue.id', 'DESC')
        .skip((input.page - 1) * input.pageSize)
        .take(input.pageSize)
        .getMany();
      const issues = [];
      for (const row of rows) {
        const order = await manager.getRepository(Order).findOneByOrFail({ id: row.orderId });
        issues.push(await readIssue(manager, { order, crewVisible: false }, row.id));
      }
      return { issues, total, page: input.page, pageSize: input.pageSize };
    });
  }
}
