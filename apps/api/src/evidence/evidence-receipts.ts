import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { ExecutionReceiptRecord } from '@furniture-delivery/contracts';
import { PlanningConflict } from '../planning/planning-errors';
import { EvidenceReceipt } from './evidence-receipt.entity';
/** Payloads are normalized by the DTO; the route-derived parent/target is included by the caller. */
export function evidenceFingerprint(payload: object): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
export async function findEvidenceReceipt(
  manager: EntityManager,
  actorId: string,
  orderId: string,
  action: string,
  operationKey: string,
  fingerprint: string,
): Promise<EvidenceReceipt | null> {
  const receipt = await manager
    .getRepository(EvidenceReceipt)
    .createQueryBuilder('receipt')
    .addSelect('receipt.fingerprint')
    .where(
      'receipt.actorId = :actorId AND receipt.orderId = :orderId AND receipt.action = :action AND receipt.operationKey = :operationKey',
      { actorId, orderId, action, operationKey },
    )
    .getOne();
  if (receipt && receipt.fingerprint !== fingerprint)
    throw new PlanningConflict(
      'OPERATION_KEY_REUSED',
      'This operation key was already used for different evidence details.',
    );
  return receipt;
}
export function saveEvidenceReceipt(
  manager: EntityManager,
  actorId: string,
  orderId: string,
  action: string,
  operationKey: string,
  fingerprint: string,
  resultId: string,
): Promise<EvidenceReceipt> {
  return manager.save(
    EvidenceReceipt,
    manager.create(EvidenceReceipt, {
      actorId,
      orderId,
      action,
      operationKey,
      fingerprint,
      resultId,
    }),
  );
}
export function mapEvidenceReceipt(receipt: EvidenceReceipt): ExecutionReceiptRecord {
  return {
    id: receipt.id,
    action: receipt.action,
    resultId: receipt.resultId,
    createdAt: receipt.createdAt.toISOString(),
  };
}
