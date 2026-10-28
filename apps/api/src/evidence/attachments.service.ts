import { markEvidence } from '../realtime/realtime-marks';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type {
  AttachmentResponse,
  UploadAttachmentMetadata,
  WithdrawAttachmentRequest,
} from '@furniture-delivery/contracts';
import type { EntityManager } from 'typeorm';
import { DatabaseService } from '../database/database.service';
import type { ExecutionActor } from '../execution/execution-access';
import { Order } from '../orders/order.entity';
import { ActivityLog } from '../orders/activity-log.entity';
import { PlanningConflict } from '../planning/planning-errors';
import { Attachment } from './attachment.entity';
import { IssueAttachment } from './issue-attachment.entity';
import { authorizeEvidence, assertEvidenceLinks, evidenceProvenance } from './evidence-access';
import type { EvidenceContext, EvidenceScope } from './evidence-access';
import { mapAttachment } from './evidence-projection';
import {
  evidenceFingerprint,
  findEvidenceReceipt,
  saveEvidenceReceipt,
  mapEvidenceReceipt,
} from './evidence-receipts';
import { PrivateStorage } from './private-storage';
import type { StagedUpload, ValidatedUpload } from './private-storage';
@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PrivateStorage) private readonly storage: PrivateStorage,
  ) {}
  async preflight(actor: ExecutionActor, scope: EvidenceScope): Promise<void> {
    const source = await this.database.getDataSource();
    await source.transaction('READ COMMITTED', (manager) =>
      authorizeEvidence(manager, actor, scope, { lock: false, requireDeparted: true }),
    );
  }
  private async file(
    manager: EntityManager,
    c: EvidenceContext,
    id: string,
    secrets = false,
  ): Promise<Attachment> {
    const q = manager
      .getRepository(Attachment)
      .createQueryBuilder('file')
      .where('file.id=:id AND file.orderId=:orderId', { id, orderId: c.order.id });
    if (secrets) q.addSelect('file.storageKey');
    const file = await q.getOne();
    if (!file || (c.crewVisible && file.visibility !== 'CREW_VISIBLE'))
      throw new NotFoundException('Attachment not found.');
    return file;
  }
  private async replay(
    manager: EntityManager,
    c: EvidenceContext,
    scope: EvidenceScope,
    actor: ExecutionActor,
    input: UploadAttachmentMetadata,
    fingerprint: string,
  ): Promise<AttachmentResponse | null> {
    const receipt = await findEvidenceReceipt(
      manager,
      actor.id,
      c.order.id,
      'ATTACHMENT_UPLOAD',
      input.operationKey,
      fingerprint,
    );
    if (!receipt) return null;
    const file = await this.file(manager, c, receipt.resultId!);
    return { attachment: mapAttachment(file, scope), receipt: mapEvidenceReceipt(receipt) };
  }
  async upload(
    actor: ExecutionActor,
    scope: EvidenceScope,
    input: UploadAttachmentMetadata,
    file: StagedUpload,
  ): Promise<AttachmentResponse> {
    const source = await this.database.getDataSource();
    let validated: ValidatedUpload | undefined;
    try {
      const sourceHash = await this.storage.hash(file),
        displayName = this.storage.displayName(file.originalname);
      const fingerprint = evidenceFingerprint({ scope, metadata: input, displayName, sourceHash });
      const old = await source.transaction('READ COMMITTED', async (manager) => {
        const c = await authorizeEvidence(manager, actor, scope, {
          lock: true,
          requireDeparted: true,
        });
        return this.replay(manager, c, scope, actor, input, fingerprint);
      });
      if (old) return old;
      validated = await this.storage.validate(file, sourceHash, !!scope.assignmentId);
      const runner = source.createQueryRunner();
      let promoted = false,
        commitAttempted = false,
        released = false;
      const attachmentId = randomUUID();
      let orderId: string | undefined;
      try {
        await runner.connect();
        await runner.startTransaction('READ COMMITTED');
        const manager = runner.manager,
          c = await authorizeEvidence(manager, actor, scope, { lock: true, requireDeparted: true });
        orderId = c.order.id;
        const repeated = await this.replay(manager, c, scope, actor, input, fingerprint);
        if (repeated) {
          await runner.commitTransaction();
          return repeated;
        }
        const provenance = await evidenceProvenance(manager, c, input);
        await assertEvidenceLinks(manager, c, {
          issueId: input.issueId,
          visibility: input.visibility,
        });
        const usage = await manager
          .getRepository(Attachment)
          .createQueryBuilder('file')
          .select('COUNT(*)', 'count')
          .addSelect('COALESCE(SUM(file.sizeBytes),0)', 'bytes')
          .where("file.orderId=:orderId AND file.state='READY' AND file.withdrawnAt IS NULL", {
            orderId,
          })
          .getRawOne<{ count: string; bytes: string }>();
        if (
          Number(usage?.count ?? 0) >= this.storage.config.orderMaxFiles ||
          Number(usage?.bytes ?? 0) + validated.sizeBytes > this.storage.config.orderMaxBytes
        )
          throw new PlanningConflict(
            'ATTACHMENT_QUOTA',
            'This order has reached its file count or byte quota.',
          );
        await this.storage.promote(validated);
        promoted = true;
        const saved = await manager.save(
          Attachment,
          manager.create(Attachment, {
            id: attachmentId,
            orderId,
            ...provenance,
            visibility: input.visibility!,
            proofType: input.proofType ?? null,
            kind: validated.kind,
            state: 'READY',
            displayName: validated.displayName,
            contentType: validated.contentType,
            sizeBytes: validated.sizeBytes,
            width: validated.width,
            height: validated.height,
            storageKey: validated.storageKey,
            sourceHash: validated.sourceHash,
            authorId: actor.id,
            withdrawnAt: null,
            withdrawnBy: null,
            withdrawReason: null,
          }),
        );
        if (input.issueId)
          await manager.save(
            IssueAttachment,
            manager.create(IssueAttachment, {
              issueId: input.issueId,
              attachmentId: saved.id,
              orderId,
            }),
          );
        await manager.save(
          ActivityLog,
          manager.create(ActivityLog, {
            orderId,
            actorId: actor.id,
            action: 'ATTACHMENT_UPLOADED',
            targetId: saved.id,
            reason: null,
            changes: { visibility: saved.visibility, kind: saved.kind, sizeBytes: saved.sizeBytes },
          }),
        );
        const receipt = await saveEvidenceReceipt(
          manager,
          actor.id,
          orderId,
          'ATTACHMENT_UPLOAD',
          input.operationKey,
          fingerprint,
          saved.id,
        );
        markEvidence(manager, orderId, saved.visibility);
        commitAttempted = true;
        await runner.commitTransaction();
        return { attachment: mapAttachment(saved, scope), receipt: mapEvidenceReceipt(receipt) };
      } catch (error) {
        let knownRollback = false;
        try {
          if (runner.isTransactionActive) await runner.rollbackTransaction();
          knownRollback = true;
        } catch {
          /* Resolve an ambiguous COMMIT separately before any final-file cleanup. */
        }
        await runner.release();
        released = true;
        if (promoted && validated) {
          if (!commitAttempted && knownRollback)
            await this.storage.cleanup(this.storage.finalPath(validated.storageKey), 'final');
          else {
            try {
              const exists = await source.transaction('READ COMMITTED', async (manager) => {
                await manager
                  .getRepository(Order)
                  .findOne({ where: { id: orderId! }, lock: { mode: 'pessimistic_write' } });
                return manager.getRepository(Attachment).existsBy({ id: attachmentId });
              });
              if (!exists)
                await this.storage.cleanup(this.storage.finalPath(validated.storageKey), 'final');
            } catch {
              /* Keep a potentially committed file; dry-run inspection reports unresolved orphans. */
            }
          }
        }
        if (commitAttempted)
          throw new ServiceUnavailableException(
            'Upload result is unknown. Refresh the gallery, then retry the same file and operation.',
          );
        throw error;
      } finally {
        if (!released) await runner.release();
      }
    } finally {
      await this.storage.cleanup(file.path, 'staging');
      await this.storage.cleanup(validated?.path, 'validated');
    }
  }
  async withdraw(
    actor: ExecutionActor,
    scope: EvidenceScope,
    id: string,
    input: WithdrawAttachmentRequest,
  ): Promise<AttachmentResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      const c = await authorizeEvidence(manager, actor, scope, { lock: true });
      const file = await this.file(manager, c, id);
      const fingerprint = evidenceFingerprint({ scope, id, ...input });
      const prior = await findEvidenceReceipt(
        manager,
        actor.id,
        c.order.id,
        'ATTACHMENT_WITHDRAW',
        input.operationKey,
        fingerprint,
      );
      if (prior)
        return { attachment: mapAttachment(file, scope), receipt: mapEvidenceReceipt(prior) };
      if (!file.withdrawnAt) {
        file.withdrawnAt = new Date();
        file.withdrawnBy = actor.id;
        file.withdrawReason = input.reason;
        await manager.save(Attachment, file);
        markEvidence(manager, c.order.id, file.visibility);
        await manager.save(
          ActivityLog,
          manager.create(ActivityLog, {
            orderId: c.order.id,
            actorId: actor.id,
            action: 'ATTACHMENT_WITHDRAWN',
            targetId: id,
            reason: input.reason.slice(0, 1000),
            changes: { withdrawn: true },
          }),
        );
      }
      const receipt = await saveEvidenceReceipt(
        manager,
        actor.id,
        c.order.id,
        'ATTACHMENT_WITHDRAW',
        input.operationKey,
        fingerprint,
        id,
      );
      return { attachment: mapAttachment(file, scope), receipt: mapEvidenceReceipt(receipt) };
    });
  }
  async content(actor: ExecutionActor, scope: EvidenceScope, id: string, thumbnail: boolean) {
    const source = await this.database.getDataSource();
    return source.transaction('REPEATABLE READ', async (manager) => {
      const c = await authorizeEvidence(manager, actor, scope, { lock: false });
      const file = await this.file(manager, c, id, true);
      if (file.withdrawnAt || (thumbnail && file.kind !== 'IMAGE'))
        throw new NotFoundException('Attachment content not found.');
      let content;
      try {
        content = await this.storage.content(file.storageKey);
      } catch {
        throw new ServiceUnavailableException('Attachment content is unavailable.');
      }
      return { file, content };
    });
  }
}
