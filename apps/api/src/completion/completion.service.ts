import { markCompletion } from '../realtime/realtime-marks';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CompleteOrderCommand,
  CompletionHistoryResponse,
  CompletionOperationResponse,
  CompletionReadinessResponse,
  ReopenOrderCommand,
} from '@furniture-delivery/contracts';
import type { EntityManager } from 'typeorm';
import { DatabaseService } from '../database/database.service';
import { lockExecutionUser, type ExecutionActor } from '../execution/execution-access';
import { Order } from '../orders/order.entity';
import { ActivityLog } from '../orders/activity-log.entity';
import { PlanningConflict } from '../planning/planning-errors';
import {
  evidenceFingerprint,
  findEvidenceReceipt,
  mapEvidenceReceipt,
  saveEvidenceReceipt,
} from '../evidence/evidence-receipts';
import { CompletionRecord } from './completion-record.entity';
import { OrderReopenEvent } from './order-reopen-event.entity';
import { currentCompletionId, reopenCurrentCompletionIn } from './completion-state';
import { mapCompletion, readCompletionReadiness } from './completion-readiness';
import { readPhysicalReadiness } from '../execution/execution-state';
@Injectable()
export class CompletionService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  private async order(manager: EntityManager, id: string, lock = false): Promise<Order> {
    const query = manager
      .getRepository(Order)
      .createQueryBuilder('completion_order')
      .addSelect('completion_order.currentCompletionId')
      .where('completion_order.id=:id', { id });
    if (lock) query.setLock('pessimistic_write');
    const order = await query.getOne();
    if (!order) throw new NotFoundException('Order not found.');
    return order;
  }
  private async touch(m: EntityManager, o: Order, actorId: string) {
    if (o.version >= 2147483647)
      throw new PlanningConflict('REVISION_LIMIT', 'The order revision limit was reached.');
    o.version++;
    o.updatedBy = actorId;
    await m.save(Order, o);
  }
  async readiness(actor: ExecutionActor, id: string): Promise<CompletionReadinessResponse> {
    return (await this.database.getDataSource()).transaction('REPEATABLE READ', async (m) => {
      await lockExecutionUser(m, actor);
      return { readiness: await readCompletionReadiness(m, await this.order(m, id)) };
    });
  }
  async history(actor: ExecutionActor, id: string): Promise<CompletionHistoryResponse> {
    return (await this.database.getDataSource()).transaction('REPEATABLE READ', async (m) => {
      await lockExecutionUser(m, actor);
      await this.order(m, id);
      return {
        currentCompletionId: await currentCompletionId(m, id),
        completions: (
          await m
            .getRepository(CompletionRecord)
            .find({ where: { orderId: id }, order: { createdAt: 'ASC', id: 'ASC' } })
        ).map(mapCompletion),
        reopenEvents: (
          await m
            .getRepository(OrderReopenEvent)
            .find({ where: { orderId: id }, order: { createdAt: 'ASC', id: 'ASC' } })
        ).map((e) => ({
          id: e.id,
          orderId: e.orderId,
          completionId: e.completionId,
          actorId: e.actorId,
          createdAt: e.createdAt.toISOString(),
          reason: e.reason,
          source: e.source,
          sourceId: e.sourceId,
        })),
      };
    });
  }
  async complete(
    actor: ExecutionActor,
    id: string,
    input: CompleteOrderCommand,
  ): Promise<CompletionOperationResponse> {
    return (await this.database.getDataSource()).transaction('READ COMMITTED', async (m) => {
      await lockExecutionUser(m, actor);
      const order = await this.order(m, id, true);
      await lockExecutionUser(m, actor);
      const fingerprint = evidenceFingerprint({ id, ...input }),
        replay = await findEvidenceReceipt(
          m,
          actor.id,
          id,
          'ORDER_COMPLETE',
          input.operationKey,
          fingerprint,
        );
      if (replay)
        return {
          readiness: await readCompletionReadiness(m, order),
          receipt: mapEvidenceReceipt(replay),
        };
      if (order.version !== input.expectedVersion)
        throw new PlanningConflict(
          'STALE_COMPLETION_VERSION',
          'The operational decision changed. Refresh readiness and review the new preview.',
        );
      const readiness = await readCompletionReadiness(m, order);
      if (!readiness.canComplete)
        throw new PlanningConflict(
          'ORDER_NOT_READY',
          readiness.blockers.map((b) => b.message).join(' ') ||
            'The order is not ready for final closure.',
        );
      const record = await m.save(
        CompletionRecord,
        m.create(CompletionRecord, {
          orderId: id,
          actorId: actor.id,
          reason: input.reason,
          readiness: {
            schemaVersion: 1,
            orderVersion: order.version,
            snapshotIds: readiness.snapshotIds,
            signatureIds: readiness.signatureIds,
            exceptionIds: readiness.exceptionIds,
            coverageRequestIds: readiness.coverageRequestIds,
            operationalDetails: await readPhysicalReadiness(m, id),
          },
        }),
      );
      order.currentCompletionId = record.id;
      await this.touch(m, order, actor.id);
      await m.save(
        ActivityLog,
        m.create(ActivityLog, {
          orderId: id,
          actorId: actor.id,
          action: 'ORDER_COMPLETED',
          targetId: record.id,
          changes: {
            completionId: record.id,
            snapshotIds: readiness.snapshotIds,
            signatureIds: readiness.signatureIds,
            exceptionIds: readiness.exceptionIds,
            coverageRequestIds: readiness.coverageRequestIds,
          },
          reason: input.reason.slice(0, 1000),
        }),
      );
      markCompletion(m, id);
      const receipt = await saveEvidenceReceipt(
        m,
        actor.id,
        id,
        'ORDER_COMPLETE',
        input.operationKey,
        fingerprint,
        record.id,
      );
      return {
        readiness: await readCompletionReadiness(m, order),
        receipt: mapEvidenceReceipt(receipt),
      };
    });
  }
  async reopen(
    actor: ExecutionActor,
    id: string,
    input: ReopenOrderCommand,
  ): Promise<CompletionOperationResponse> {
    return (await this.database.getDataSource()).transaction('READ COMMITTED', async (m) => {
      await lockExecutionUser(m, actor);
      const order = await this.order(m, id, true);
      await lockExecutionUser(m, actor);
      const fingerprint = evidenceFingerprint({ id, ...input }),
        replay = await findEvidenceReceipt(
          m,
          actor.id,
          id,
          'ORDER_REOPEN',
          input.operationKey,
          fingerprint,
        );
      if (replay)
        return {
          readiness: await readCompletionReadiness(m, order),
          receipt: mapEvidenceReceipt(replay),
        };
      if (order.version !== input.expectedVersion)
        throw new PlanningConflict(
          'STALE_COMPLETION_VERSION',
          'The order changed. Refresh the current completion before reopening.',
        );
      if (order.currentCompletionId !== input.expectedCompletionId)
        throw new PlanningConflict(
          'STALE_CURRENT_COMPLETION',
          'The expected current completion is no longer active.',
        );
      const event = await reopenCurrentCompletionIn(
        m,
        order,
        actor.id,
        input.reason,
        'MANUAL',
        null,
      );
      if (!event) throw new PlanningConflict('ORDER_NOT_COMPLETED', 'The order is already open.');
      await this.touch(m, order, actor.id);
      markCompletion(m, id);
      const receipt = await saveEvidenceReceipt(
        m,
        actor.id,
        id,
        'ORDER_REOPEN',
        input.operationKey,
        fingerprint,
        event.id,
      );
      return {
        readiness: await readCompletionReadiness(m, order),
        receipt: mapEvidenceReceipt(receipt),
      };
    });
  }
}
