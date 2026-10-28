import { IsNull, type EntityManager } from 'typeorm';
import type {
  CompletionBlocker,
  CompletionReadinessRecord,
  CompletionRecordRecord,
} from '@furniture-delivery/contracts';
import { Order } from '../orders/order.entity';
import { OrderItem } from '../orders/order-item.entity';
import { Appointment } from '../planning/appointment.entity';
import { CrewAssignment } from '../planning/crew-assignment.entity';
import { Issue } from '../evidence/issue.entity';
import { ReturnVisitRequest } from '../execution/return-visit-request.entity';
import { readPhysicalReadiness } from '../execution/execution-state';
import { AcceptanceSnapshot } from '../acceptance/acceptance-snapshot.entity';
import { AcceptanceSlot } from '../acceptance/acceptance-slot.entity';
import { SignatureConfirmation } from '../acceptance/signature-confirmation.entity';
import { ExceptionReview } from '../acceptance/exception-review.entity';
import { CompletionRecord } from './completion-record.entity';
import { currentCompletionId } from './completion-state';

export function mapCompletion(record: CompletionRecord): CompletionRecordRecord {
  return {
    id: record.id,
    orderId: record.orderId,
    actorId: record.actorId,
    createdAt: record.createdAt.toISOString(),
    reason: record.reason,
    readiness: record.readiness,
  };
}
export async function readCompletionReadiness(
  manager: EntityManager,
  order: Order,
): Promise<CompletionReadinessRecord> {
  const facts = await readPhysicalReadiness(manager, order.id),
    blockers: CompletionBlocker[] = [];
  const add = (
    code: CompletionBlocker['code'],
    message: string,
    ids: Omit<CompletionBlocker, 'code' | 'message'> = {},
  ) => blockers.push({ code, message, ...ids });
  if (!facts.anyVisit)
    add(
      'NO_VISITS',
      'Schedule and actually perform the order work; an empty order cannot be closed.',
    );
  if (!facts.hasWork)
    add('NO_RECORDED_WORK', 'Record the physical work results before closing the order.');
  if (facts.incompleteTask)
    add(
      'INCOMPLETE_TASKS',
      'Complete or explicitly settle every unfinished task, including uncovered work from earlier visits.',
    );
  if (facts.uncoveredOutcomeCount)
    add(
      'UNCOVERED_EXECUTION',
      'Resolve the remaining work through its return request; historical partial or blocked outcomes are not erased.',
    );
  const items = await manager.getRepository(OrderItem).findBy({ orderId: order.id, active: true });
  for (const item of items)
    if (
      item.deliveredQuantity !== item.quantity ||
      (item.requiresAssembly && item.assembledQuantity !== item.quantity)
    )
      add(
        'INCOMPLETE_ITEMS',
        'The accumulated delivery or required assembly quantity is incomplete.',
        { itemId: item.id },
      );
  for (const issue of await manager
    .getRepository(Issue)
    .findBy({ orderId: order.id, status: 'OPEN' }))
    add('OPEN_ISSUES', 'Resolve the open issue before final closure.', {
      issueId: issue.id,
      ...(issue.appointmentId ? { appointmentId: issue.appointmentId } : {}),
    });
  const requests = await manager.getRepository(ReturnVisitRequest).findBy({ orderId: order.id });
  for (const request of requests)
    if (request.status !== 'RESOLVED')
      add(
        'RETURN_REQUIRED',
        'The repeat-visit need must be explicitly resolved; planning alone is insufficient.',
        { requestId: request.id, appointmentId: request.appointmentId },
      );
  const visits = await manager.getRepository(Appointment).find({
    where: { orderId: order.id, status: 'SCHEDULED' },
    order: { plannedStartAt: 'ASC', id: 'ASC' },
  });
  const snapshotIds: string[] = [],
    signatureIds: string[] = [],
    exceptionIds: string[] = [];
  let confirmationsReady = true;
  for (const visit of visits) {
    const assignments = await manager
      .getRepository(CrewAssignment)
      .find({ where: { appointmentId: visit.id, status: 'ASSIGNED' }, order: { id: 'ASC' } });
    if (!assignments.length)
      add('UNASSIGNED_VISIT', 'Assign or cancel the unstarted visit before closing.', {
        appointmentId: visit.id,
      });
    for (const assignment of assignments) {
      if (assignment.executionStatus === 'NOT_STARTED')
        add('UNSTARTED_VISIT', 'This scheduled team has not yet performed its visit.', {
          appointmentId: visit.id,
          assignmentId: assignment.id,
        });
      if (['ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS'].includes(assignment.executionStatus))
        add('ACTIVE_EXECUTION', 'Finish the active team participation first.', {
          appointmentId: visit.id,
          assignmentId: assignment.id,
        });
    }
    const participated = assignments.filter((a) => a.departedAt);
    if (!participated.length) continue;
    const snapshot = await manager
      .getRepository(AcceptanceSnapshot)
      .findOneBy({ appointmentId: visit.id, orderId: order.id, invalidatedAt: IsNull() });
    if (!snapshot) {
      confirmationsReady = false;
      const historical = await manager
        .getRepository(AcceptanceSnapshot)
        .existsBy({ appointmentId: visit.id, orderId: order.id });
      add(
        historical ? 'INVALIDATED_SNAPSHOT' : 'MISSING_SNAPSHOT',
        'Prepare a current immutable acknowledgement for this actually performed visit.',
        { appointmentId: visit.id },
      );
      continue;
    }
    snapshotIds.push(snapshot.id);
    const slots = await manager
      .getRepository(AcceptanceSlot)
      .find({ where: { snapshotId: snapshot.id }, order: { kind: 'ASC', id: 'ASC' } });
    if (
      slots.filter((s) => s.kind === 'CUSTOMER').length !== 1 ||
      participated.some(
        (a) => slots.filter((s) => s.kind === 'CREW' && s.assignmentId === a.id).length !== 1,
      )
    ) {
      confirmationsReady = false;
      add(
        'MISSING_CONFIRMATION',
        'The result is missing a required customer or participating team requirement.',
        { appointmentId: visit.id, snapshotId: snapshot.id },
      );
    }
    for (const slot of slots) {
      const ids = {
        appointmentId: visit.id,
        snapshotId: snapshot.id,
        slotId: slot.id,
        ...(slot.assignmentId ? { assignmentId: slot.assignmentId } : {}),
      };
      const confirmation = await manager
        .getRepository(SignatureConfirmation)
        .findOneBy({ slotId: slot.id, snapshotId: snapshot.id });
      if (confirmation?.method === 'SIGNED' && confirmation.snapshotHash === snapshot.hash) {
        signatureIds.push(confirmation.id);
        continue;
      }
      if (confirmation?.method === 'ABSENCE') {
        const review = await manager
          .getRepository(ExceptionReview)
          .findOneBy({ slotId: slot.id, confirmationId: confirmation.id });
        if (review?.decision === 'APPROVED') {
          exceptionIds.push(review.id);
          continue;
        }
        confirmationsReady = false;
        add(
          review ? 'REJECTED_EXCEPTION' : 'PENDING_EXCEPTION',
          review
            ? 'The missing-signature exception was rejected; invalidate the document explicitly to correct its confirmations.'
            : 'A dispatcher must separately review this missing signature.',
          ids,
        );
      } else {
        confirmationsReady = false;
        add(
          'MISSING_CONFIRMATION',
          'Record this specific signature or an individually reviewed absence.',
          ids,
        );
      }
    }
  }
  const currentId = await currentCompletionId(manager, order.id),
    record = currentId
      ? await manager
          .getRepository(CompletionRecord)
          .findOneByOrFail({ id: currentId, orderId: order.id })
      : null;
  if (record)
    add(
      'ALREADY_COMPLETED',
      'This order already has a current explicit completion. Reopen it with a reason before another closure.',
    );
  return {
    orderId: order.id,
    orderVersion: order.version,
    physicalReady: facts.workReady,
    confirmationsReady,
    canComplete: facts.workReady && confirmationsReady && !record,
    currentCompletion: record ? mapCompletion(record) : null,
    blockers,
    snapshotIds: [...new Set(snapshotIds)].sort(),
    signatureIds: [...new Set(signatureIds)].sort(),
    exceptionIds: [...new Set(exceptionIds)].sort(),
    coverageRequestIds: requests
      .filter((r) => r.status === 'RESOLVED')
      .map((r) => r.id)
      .sort(),
  };
}
