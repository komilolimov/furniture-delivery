import type { EntityManager } from 'typeorm';
import type { OrderReopenSource } from '@furniture-delivery/contracts';
import { Order } from '../orders/order.entity';
import { ActivityLog } from '../orders/activity-log.entity';
import { PlanningConflict } from '../planning/planning-errors';
import { OrderReopenEvent } from './order-reopen-event.entity';

/** The pointer is deliberately not selected/inserted by legacy pre-M7 ORM seed fixtures. */
export async function currentCompletionId(
  manager: EntityManager,
  orderId: string,
): Promise<string | null> {
  const row = await manager
    .getRepository(Order)
    .createQueryBuilder('completion_order')
    .select('completion_order.currentCompletionId', 'current')
    .where('completion_order.id=:orderId', { orderId })
    .getRawOne<{ current: string | null }>();
  return row?.current ?? null;
}
export async function requireOpenOrder(manager: EntityManager, order: Order): Promise<void> {
  if (await currentCompletionId(manager, order.id))
    throw new PlanningConflict(
      'ORDER_COMPLETED_REOPEN_REQUIRED',
      'Explicitly reopen the completed order before changing its work or planning.',
    );
}
/** Caller holds the Order lock and must touch its revision in this same transaction. */
export async function reopenCurrentCompletionIn(
  manager: EntityManager,
  order: Order,
  actorId: string,
  reason: string,
  source: OrderReopenSource,
  sourceId: string | null,
): Promise<OrderReopenEvent | null> {
  const id = await currentCompletionId(manager, order.id);
  if (!id) return null;
  const event = await manager.save(
    OrderReopenEvent,
    manager.create(OrderReopenEvent, {
      orderId: order.id,
      completionId: id,
      actorId,
      reason,
      source,
      sourceId,
    }),
  );
  // Persist once through the caller's revision touch. TypeORM save() fills unloaded
  // nullable fields with null in this object; a second save would overwrite hidden seedKey.
  order.currentCompletionId = null;
  await manager.save(
    ActivityLog,
    manager.create(ActivityLog, {
      orderId: order.id,
      actorId,
      action: 'ORDER_REOPENED',
      targetId: event.id,
      changes: { completionId: id, source, sourceId },
      reason: reason.slice(0, 1000),
    }),
  );
  return event;
}
