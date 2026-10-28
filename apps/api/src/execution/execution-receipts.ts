import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { ExecutionReceiptRecord } from '@furniture-delivery/contracts';
import { PlanningConflict } from '../planning/planning-errors';
import { ExecutionReceipt } from './execution-receipt.entity';
export function executionFingerprint(payload: object): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
export async function findExecutionReceipt(
  manager: EntityManager,
  actorId: string,
  assignmentId: string,
  action: string,
  operationKey: string,
  fingerprint: string,
): Promise<ExecutionReceipt | null> {
  const receipt = await manager
    .getRepository(ExecutionReceipt)
    .createQueryBuilder('receipt')
    .addSelect('receipt.fingerprint')
    .where(
      'receipt.actorId = :actorId AND receipt.assignmentId = :assignmentId AND receipt.action = :action AND receipt.operationKey = :operationKey',
      { actorId, assignmentId, action, operationKey },
    )
    .getOne();
  if (receipt && receipt.fingerprint !== fingerprint)
    throw new PlanningConflict(
      'OPERATION_KEY_REUSED',
      'This operation key was already used for different command details.',
    );
  return receipt;
}
export function saveExecutionReceipt(
  manager: EntityManager,
  actorId: string,
  assignmentId: string,
  action: string,
  operationKey: string,
  fingerprint: string,
  resultId: string | null = null,
): Promise<ExecutionReceipt> {
  return manager.save(
    ExecutionReceipt,
    manager.create(ExecutionReceipt, {
      actorId,
      assignmentId,
      action,
      operationKey,
      fingerprint,
      resultId,
    }),
  );
}
export function mapExecutionReceipt(receipt: ExecutionReceipt): ExecutionReceiptRecord {
  return {
    id: receipt.id,
    action: receipt.action,
    resultId: receipt.resultId,
    createdAt: receipt.createdAt.toISOString(),
  };
}
