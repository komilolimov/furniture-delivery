import { markAcceptance } from '../realtime/realtime-marks';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ActivityAction,
  BackofficeAcceptanceResponse,
  CrewAcceptanceResponse,
  InvalidateAcceptanceCommand,
  PrepareAcceptanceCommand,
  ReportAbsenceCommand,
  ReviewExceptionCommand,
  SignAcceptanceCommand,
} from '@furniture-delivery/contracts';
import type { EntityManager } from 'typeorm';
import { IsNull } from 'typeorm';
import { DatabaseService } from '../database/database.service';
import { ActivityLog } from '../orders/activity-log.entity';
import { PlanningConflict } from '../planning/planning-errors';
import type { ExecutionActor } from '../execution/execution-access';
import {
  evidenceFingerprint,
  findEvidenceReceipt,
  mapEvidenceReceipt,
  saveEvidenceReceipt,
} from '../evidence/evidence-receipts';
import type { EvidenceReceipt } from '../evidence/evidence-receipt.entity';
import { AcceptanceSnapshot } from './acceptance-snapshot.entity';
import { AcceptanceSlot } from './acceptance-slot.entity';
import { SignatureConfirmation } from './signature-confirmation.entity';
import { ExceptionReview } from './exception-review.entity';
import {
  authorizeAcceptance,
  requireBackoffice,
  slotAllowed,
  type AcceptanceContext,
  type AcceptanceScope,
} from './acceptance-access';
import { preparationBlocker, readAcceptance } from './acceptance-projection';
import { buildAcceptancePayload, canonicalAcceptance } from './acceptance-payload';
import { reopenCurrentCompletionIn } from '../completion/completion-state';
import { Order } from '../orders/order.entity';
import { decodeSignaturePng } from './signature-png';

type Response = BackofficeAcceptanceResponse | CrewAcceptanceResponse;
function conflict(code: string, message: string): never {
  throw new PlanningConflict(code, message);
}
function current(snapshot: AcceptanceSnapshot, expectedVersion: number): void {
  if (snapshot.version !== expectedVersion)
    conflict(
      'STALE_ACCEPTANCE_VERSION',
      'The displayed result revision is no longer current. Reload before preparing another draft.',
    );
  if (snapshot.invalidatedAt)
    conflict(
      'ACCEPTANCE_INVALIDATED',
      'This result was invalidated. Its confirmations remain historical; prepare a new result.',
    );
}
@Injectable()
export class AcceptanceService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  private async response(
    manager: EntityManager,
    context: AcceptanceContext,
    receipt?: EvidenceReceipt,
  ): Promise<Response> {
    return {
      ...(await readAcceptance(manager, context)),
      ...(receipt ? { receipt: mapEvidenceReceipt(receipt) } : {}),
    };
  }
  private async audit(
    manager: EntityManager,
    context: AcceptanceContext,
    action: ActivityAction,
    targetId: string,
    changes: Record<string, unknown>,
    reason: string | null = null,
  ): Promise<void> {
    if (context.order.version >= 2147483647)
      conflict('REVISION_LIMIT', 'The order revision limit was reached.');
    context.order.version += 1;
    context.order.updatedBy = context.user.id;
    await manager.save(Order, context.order);
    await manager.save(
      ActivityLog,
      manager.create(ActivityLog, {
        orderId: context.order.id,
        actorId: context.user.id,
        action,
        targetId,
        changes,
        reason: reason?.slice(0, 1000) ?? null,
      }),
    );
    if (action !== 'EXCEPTION_REVIEWED') markAcceptance(manager, context.order.id);
  }
  private async slot(
    manager: EntityManager,
    context: AcceptanceContext,
    snapshotId: string,
    slotId: string,
  ): Promise<{ snapshot: AcceptanceSnapshot; slot: AcceptanceSlot }> {
    const snapshot = await manager.getRepository(AcceptanceSnapshot).findOneBy({
      id: snapshotId,
      orderId: context.order.id,
      appointmentId: context.appointment.id,
    });
    const slot =
      snapshot &&
      (await manager.getRepository(AcceptanceSlot).findOneBy({
        id: slotId,
        snapshotId,
        orderId: context.order.id,
        appointmentId: context.appointment.id,
      }));
    if (!snapshot || !slot) throw new NotFoundException('Confirmation requirement not found.');
    return { snapshot, slot };
  }
  async read(actor: ExecutionActor, scope: AcceptanceScope): Promise<Response> {
    return (await this.database.getDataSource()).transaction('REPEATABLE READ', async (manager) =>
      this.response(manager, await authorizeAcceptance(manager, actor, scope, false)),
    );
  }
  async prepare(
    actor: ExecutionActor,
    scope: AcceptanceScope,
    input: PrepareAcceptanceCommand,
  ): Promise<Response> {
    return (await this.database.getDataSource()).transaction('READ COMMITTED', async (manager) => {
      const context = await authorizeAcceptance(manager, actor, scope, true);
      const fingerprint = evidenceFingerprint({ appointmentId: context.appointment.id, ...input });
      const replay = await findEvidenceReceipt(
        manager,
        actor.id,
        context.order.id,
        'ACCEPTANCE_PREPARE',
        input.operationKey,
        fingerprint,
      );
      if (replay) return this.response(manager, context, replay);
      let snapshot = await manager
        .getRepository(AcceptanceSnapshot)
        .findOneBy({ appointmentId: context.appointment.id, invalidatedAt: IsNull() });
      if (!snapshot) {
        const blocked = await preparationBlocker(manager, context);
        if (blocked) conflict('ACCEPTANCE_NOT_READY', blocked);
        const previous = await manager.getRepository(AcceptanceSnapshot).findOne({
          where: { appointmentId: context.appointment.id },
          order: { version: 'DESC' },
        });
        const version = (previous?.version ?? 0) + 1;
        if (version > 2147483646)
          conflict('REVISION_LIMIT', 'The result revision limit was reached.');
        const assignments = context.assignments.filter((assignment) => assignment.departedAt);
        const payload = await buildAcceptancePayload(
          manager,
          context.order,
          context.appointment,
          assignments,
          actor.id,
        );
        const canonical = canonicalAcceptance(payload),
          hash = createHash('sha256').update(canonical).digest('hex');
        snapshot = await manager.save(
          AcceptanceSnapshot,
          manager.create(AcceptanceSnapshot, {
            orderId: context.order.id,
            appointmentId: context.appointment.id,
            version,
            payload,
            canonical,
            hash,
            createdBy: actor.id,
            createdAt: new Date(payload.createdAt),
            invalidatedAt: null,
            invalidatedBy: null,
            invalidationReason: null,
          }),
        );
        await manager.save(
          AcceptanceSlot,
          manager.create(AcceptanceSlot, {
            snapshotId: snapshot.id,
            orderId: context.order.id,
            appointmentId: context.appointment.id,
            kind: 'CUSTOMER',
            assignmentId: null,
          }),
        );
        for (const assignment of assignments)
          await manager.save(
            AcceptanceSlot,
            manager.create(AcceptanceSlot, {
              snapshotId: snapshot.id,
              orderId: context.order.id,
              appointmentId: context.appointment.id,
              kind: 'CREW',
              assignmentId: assignment.id,
            }),
          );
        await this.audit(manager, context, 'ACCEPTANCE_PREPARED', snapshot.id, {
          snapshotId: snapshot.id,
          hash,
          version,
        });
      }
      const receipt = await saveEvidenceReceipt(
        manager,
        actor.id,
        context.order.id,
        'ACCEPTANCE_PREPARE',
        input.operationKey,
        fingerprint,
        snapshot.id,
      );
      return this.response(manager, context, receipt);
    });
  }
  async preflight(actor: ExecutionActor, snapshotId: string, slotId: string): Promise<void> {
    await (
      await this.database.getDataSource()
    ).transaction('READ COMMITTED', async (manager) => {
      const context = await authorizeAcceptance(manager, actor, { snapshotId }, false);
      const { slot } = await this.slot(manager, context, snapshotId, slotId);
      if (!slotAllowed(context, slot.kind, slot.assignmentId))
        throw new ForbiddenException(
          'Only the current team representative can sign that staff requirement.',
        );
    });
  }
  async sign(
    actor: ExecutionActor,
    snapshotId: string,
    slotId: string,
    input: SignAcceptanceCommand,
    sourcePng: Buffer,
  ): Promise<Response> {
    await this.preflight(actor, snapshotId, slotId);
    const image = await decodeSignaturePng(sourcePng);
    return (await this.database.getDataSource()).transaction('READ COMMITTED', async (manager) => {
      const context = await authorizeAcceptance(manager, actor, { snapshotId }, true);
      const { snapshot, slot } = await this.slot(manager, context, snapshotId, slotId);
      if (!slotAllowed(context, slot.kind, slot.assignmentId))
        throw new ForbiddenException(
          'Only the current team representative can sign that staff requirement.',
        );
      const fingerprint = evidenceFingerprint({
        snapshotId,
        slotId,
        input,
        sourceDigest: image.sourceDigest,
      });
      const replay = await findEvidenceReceipt(
        manager,
        actor.id,
        context.order.id,
        'ACCEPTANCE_SIGN',
        input.operationKey,
        fingerprint,
      );
      if (replay) return this.response(manager, context, replay);
      current(snapshot, input.expectedVersion);
      if (await manager.getRepository(SignatureConfirmation).existsBy({ slotId }))
        conflict(
          'ACCEPTANCE_SLOT_RECORDED',
          'This requirement already has a recorded confirmation. Correct it through explicit document invalidation.',
        );
      if (slot.kind === 'CUSTOMER' && !input.customerName)
        throw new BadRequestException('The declared customer representative name is required.');
      if (
        slot.kind === 'CREW' &&
        (input.customerName !== undefined || input.customerRelation !== undefined)
      )
        throw new BadRequestException('A staff signer name is taken from the current account.');
      const confirmation = await manager.save(
        SignatureConfirmation,
        manager.create(SignatureConfirmation, {
          slotId,
          snapshotId,
          snapshotHash: snapshot.hash,
          method: 'SIGNED',
          signerName: slot.kind === 'CUSTOMER' ? input.customerName! : context.user.displayName,
          signerRelation: slot.kind === 'CUSTOMER' ? (input.customerRelation ?? null) : null,
          capturedByUserId: actor.id,
          recordedAt: new Date(),
          png: image.png,
          imageDigest: image.digest,
          width: image.width,
          height: image.height,
          sizeBytes: image.sizeBytes,
          absenceKind: null,
          absenceReason: null,
        }),
      );
      await this.audit(manager, context, 'ACCEPTANCE_SIGNED', confirmation.id, {
        snapshotId,
        slotId,
        confirmationId: confirmation.id,
        kind: slot.kind,
        hash: snapshot.hash,
        imageDigest: image.digest,
      });
      const receipt = await saveEvidenceReceipt(
        manager,
        actor.id,
        context.order.id,
        'ACCEPTANCE_SIGN',
        input.operationKey,
        fingerprint,
        confirmation.id,
      );
      return this.response(manager, context, receipt);
    });
  }
  async absence(
    actor: ExecutionActor,
    snapshotId: string,
    slotId: string,
    input: ReportAbsenceCommand,
  ): Promise<Response> {
    return (await this.database.getDataSource()).transaction('READ COMMITTED', async (manager) => {
      const context = await authorizeAcceptance(manager, actor, { snapshotId }, true);
      const { snapshot, slot } = await this.slot(manager, context, snapshotId, slotId);
      if (context.crew && !slotAllowed(context, slot.kind, slot.assignmentId))
        throw new ForbiddenException('This requirement belongs to another team.');
      const fingerprint = evidenceFingerprint({ snapshotId, slotId, ...input });
      const replay = await findEvidenceReceipt(
        manager,
        actor.id,
        context.order.id,
        'ACCEPTANCE_ABSENCE',
        input.operationKey,
        fingerprint,
      );
      if (replay) return this.response(manager, context, replay);
      current(snapshot, input.expectedVersion);
      if (await manager.getRepository(SignatureConfirmation).existsBy({ slotId }))
        conflict(
          'ACCEPTANCE_SLOT_RECORDED',
          'This requirement already has a recorded confirmation. Correct it through explicit document invalidation.',
        );
      const confirmation = await manager.save(
        SignatureConfirmation,
        manager.create(SignatureConfirmation, {
          slotId,
          snapshotId,
          snapshotHash: snapshot.hash,
          method: 'ABSENCE',
          signerName: null,
          signerRelation: null,
          capturedByUserId: actor.id,
          recordedAt: new Date(),
          png: null,
          imageDigest: null,
          width: null,
          height: null,
          sizeBytes: null,
          absenceKind: input.kind,
          absenceReason: input.reason,
        }),
      );
      await this.audit(
        manager,
        context,
        'ACCEPTANCE_ABSENT',
        confirmation.id,
        {
          snapshotId,
          slotId,
          confirmationId: confirmation.id,
          kind: input.kind,
          hash: snapshot.hash,
        },
        input.reason,
      );
      const receipt = await saveEvidenceReceipt(
        manager,
        actor.id,
        context.order.id,
        'ACCEPTANCE_ABSENCE',
        input.operationKey,
        fingerprint,
        confirmation.id,
      );
      return this.response(manager, context, receipt);
    });
  }
  async review(
    actor: ExecutionActor,
    snapshotId: string,
    slotId: string,
    input: ReviewExceptionCommand,
  ): Promise<Response> {
    return (await this.database.getDataSource()).transaction('READ COMMITTED', async (manager) => {
      const context = await authorizeAcceptance(manager, actor, { snapshotId }, true);
      requireBackoffice(context);
      const { snapshot, slot } = await this.slot(manager, context, snapshotId, slotId);
      const fingerprint = evidenceFingerprint({ snapshotId, slotId, ...input });
      const replay = await findEvidenceReceipt(
        manager,
        actor.id,
        context.order.id,
        'ACCEPTANCE_REVIEW',
        input.operationKey,
        fingerprint,
      );
      if (replay) return this.response(manager, context, replay);
      current(snapshot, input.expectedVersion);
      const confirmation = await manager
        .getRepository(SignatureConfirmation)
        .findOneBy({ slotId, snapshotId });
      if (confirmation?.method !== 'ABSENCE')
        conflict(
          'EXCEPTION_NOT_RECORDED',
          'A recorded absence is required before reviewing this requirement.',
        );
      if (await manager.getRepository(ExceptionReview).existsBy({ slotId }))
        conflict(
          'EXCEPTION_ALREADY_REVIEWED',
          'This exception already has a decision. Correct it through explicit document invalidation.',
        );
      const review = await manager.save(
        ExceptionReview,
        manager.create(ExceptionReview, {
          slotId,
          confirmationId: confirmation.id,
          confirmationMethod: 'ABSENCE',
          decision: input.decision,
          reason: input.reason,
          reviewedByUserId: actor.id,
          reviewedAt: new Date(),
        }),
      );
      await this.audit(
        manager,
        context,
        'EXCEPTION_REVIEWED',
        review.id,
        {
          snapshotId,
          slotId,
          confirmationId: confirmation.id,
          reviewId: review.id,
          decision: input.decision,
          hash: snapshot.hash,
        },
        input.reason,
      );
      const reviewedCrew =
        slot.kind === 'CREW'
          ? snapshot.payload.teams.find((team) => team.assignmentId === slot.assignmentId)?.crewId
          : undefined;
      // Other teams can see a missing/staff status, never this private staff exception decision.
      markAcceptance(
        manager,
        context.order.id,
        slot.kind === 'CREW' ? (reviewedCrew ? [reviewedCrew] : []) : undefined,
      );
      const receipt = await saveEvidenceReceipt(
        manager,
        actor.id,
        context.order.id,
        'ACCEPTANCE_REVIEW',
        input.operationKey,
        fingerprint,
        review.id,
      );
      return this.response(manager, context, receipt);
    });
  }
  async invalidate(
    actor: ExecutionActor,
    snapshotId: string,
    input: InvalidateAcceptanceCommand,
  ): Promise<Response> {
    return (await this.database.getDataSource()).transaction('READ COMMITTED', async (manager) => {
      const context = await authorizeAcceptance(manager, actor, { snapshotId }, true);
      requireBackoffice(context);
      const snapshot = await manager
        .getRepository(AcceptanceSnapshot)
        .findOneByOrFail({ id: snapshotId });
      const fingerprint = evidenceFingerprint({ snapshotId, ...input });
      const replay = await findEvidenceReceipt(
        manager,
        actor.id,
        context.order.id,
        'ACCEPTANCE_INVALIDATE',
        input.operationKey,
        fingerprint,
      );
      if (replay) return this.response(manager, context, replay);
      current(snapshot, input.expectedVersion);
      snapshot.invalidatedAt = new Date();
      snapshot.invalidatedBy = actor.id;
      snapshot.invalidationReason = input.reason;
      await manager.save(AcceptanceSnapshot, snapshot);
      await reopenCurrentCompletionIn(
        manager,
        context.order,
        actor.id,
        'Invalidated visit acknowledgement ' + snapshotId,
        'SNAPSHOT',
        snapshotId,
      );
      await this.audit(
        manager,
        context,
        'ACCEPTANCE_INVALIDATED',
        snapshotId,
        { snapshotId, hash: snapshot.hash, version: snapshot.version },
        input.reason,
      );
      const receipt = await saveEvidenceReceipt(
        manager,
        actor.id,
        context.order.id,
        'ACCEPTANCE_INVALIDATE',
        input.operationKey,
        fingerprint,
        snapshotId,
      );
      return this.response(manager, context, receipt);
    });
  }
  async content(actor: ExecutionActor, snapshotId: string, signatureId: string): Promise<Buffer> {
    return (await this.database.getDataSource()).transaction('READ COMMITTED', async (manager) => {
      const context = await authorizeAcceptance(manager, actor, { snapshotId }, false);
      const confirmation = await manager
        .getRepository(SignatureConfirmation)
        .createQueryBuilder('c')
        .addSelect('c.png')
        .where('c.id=:signatureId AND c.snapshotId=:snapshotId', { signatureId, snapshotId })
        .getOne();
      const slot =
        confirmation &&
        (await manager
          .getRepository(AcceptanceSlot)
          .findOneBy({ id: confirmation.slotId, snapshotId }));
      if (
        !confirmation ||
        !slot ||
        confirmation.method !== 'SIGNED' ||
        !confirmation.png ||
        (context.crew && !slotAllowed(context, slot.kind, slot.assignmentId))
      )
        throw new NotFoundException('Signature content not found.');
      return confirmation.png;
    });
  }
}
