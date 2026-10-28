import type { EntityManager } from 'typeorm';
import type { FinishCommand } from '@furniture-delivery/contracts';
import { ActivityLog } from '../orders/activity-log.entity';
import { OrderItem } from '../orders/order-item.entity';
import { Appointment } from '../planning/appointment.entity';
import { CrewAssignment } from '../planning/crew-assignment.entity';
import { Task } from '../planning/task.entity';
import { ReturnVisitRequest } from '../execution/return-visit-request.entity';
import { ReturnVisitAttempt } from '../execution/return-visit-attempt.entity';
import { returnScopeCandidates } from './return-scope';
import { PlanningConflict } from '../planning/planning-errors';

const terminal = new Set(['COMPLETED', 'PARTIALLY_COMPLETED', 'BLOCKED']);
export function bumpReturn(request: ReturnVisitRequest, actorId: string): void {
  if (request.version >= 2147483647)
    throw new PlanningConflict('REVISION_LIMIT', 'The return request revision limit was reached.');
  request.version += 1;
  request.updatedBy = actorId;
}
/** The caller already holds User -> Order -> Appointment -> sorted Crew locks. */
export async function returnResolveBlockers(
  manager: EntityManager,
  attempt: ReturnVisitAttempt,
): Promise<string[]> {
  const assignments = await manager
    .getRepository(CrewAssignment)
    .findBy({ appointmentId: attempt.appointmentId, status: 'ASSIGNED' });
  const reasons: string[] = [];
  if (!assignments.length || assignments.some((a) => a.executionStatus !== 'COMPLETED'))
    reasons.push('Every team in the current follow-up must complete its participation.');
  if (attempt.returnRequested) reasons.push('A team requested another visit during this attempt.');
  const tasks = assignments.length
    ? await manager
        .getRepository(Task)
        .createQueryBuilder('t')
        .where('t.assignmentId IN (:...ids) AND t.active', { ids: assignments.map((a) => a.id) })
        .getMany()
    : [];
  for (const scope of attempt.scope.tasks) {
    const matches = tasks.filter((t) => t.returnScopeKey === scope.key);
    if (matches.length !== 1 || (scope.required && matches[0]!.resultStatus !== 'DONE'))
      reasons.push(`The accepted task scope is incomplete: ${scope.name}.`);
  }
  const items = await manager
    .getRepository(OrderItem)
    .findBy({ orderId: attempt.orderId, active: true });
  for (const target of attempt.scope.itemTargets) {
    const item = items.find((i) => i.id === target.itemId);
    if (
      !item ||
      item.deliveredQuantity < target.deliveredQuantity ||
      item.assembledQuantity < target.assembledQuantity
    )
      reasons.push('The accepted accumulated item targets have not been reached.');
  }
  const request = await manager
    .getRepository(ReturnVisitRequest)
    .findOneByOrFail({ id: attempt.requestId });
  if ((await returnScopeCandidates(manager, request)).length)
    reasons.push(
      'Unfinished source work remains outside the completed scope; carry it into another attempt and complete or explicitly skip optional work.',
    );
  return [...new Set(reasons)];
}
export async function cancelReturnAttempt(
  manager: EntityManager,
  appointment: Appointment,
  actorId: string,
  reason: string,
): Promise<void> {
  const attempt = await manager
    .getRepository(ReturnVisitAttempt)
    .findOneBy({ appointmentId: appointment.id, current: true });
  if (!attempt) return;
  const request = await manager
    .getRepository(ReturnVisitRequest)
    .findOneByOrFail({ id: attempt.requestId });
  attempt.current = false;
  attempt.closedOutcome = 'CANCELLED';
  attempt.closedAt = new Date();
  attempt.closedBy = actorId;
  attempt.closeReason = reason;
  request.status = 'OPEN';
  bumpReturn(request, actorId);
  await manager.save(ReturnVisitAttempt, attempt);
  await manager.save(ReturnVisitRequest, request);
  await manager.save(
    ActivityLog,
    manager.create(ActivityLog, {
      orderId: request.orderId,
      actorId,
      action: 'RETURN_VISIT_REOPENED',
      targetId: request.id,
      changes: {
        appointmentId: appointment.id,
        attemptId: attempt.id,
        outcome: 'CANCELLED',
        version: request.version,
      },
      reason: reason.slice(0, 1000),
    }),
  );
}
/** Called after saving the immutable report and the terminal assignment, before the same commit. */
export async function finishReturnAttempt(
  manager: EntityManager,
  appointmentId: string,
  actorId: string,
  input: FinishCommand,
): Promise<void> {
  const attempt = await manager
    .getRepository(ReturnVisitAttempt)
    .findOneBy({ appointmentId, current: true });
  if (!attempt) return;
  const request = await manager
    .getRepository(ReturnVisitRequest)
    .findOneByOrFail({ id: attempt.requestId });
  if (input.returnVisitRequired) {
    attempt.returnRequested = true;
    await manager.save(
      ActivityLog,
      manager.create(ActivityLog, {
        orderId: request.orderId,
        actorId,
        action: 'RETURN_VISIT_REQUESTED',
        targetId: request.id,
        changes: {
          appointmentId,
          attemptId: attempt.id,
          additionalReason: input.returnReason,
          remainingWork: input.remainingWork,
        },
        reason: input.returnReason?.slice(0, 1000) ?? null,
      }),
    );
  }
  await manager.save(ReturnVisitAttempt, attempt);
  const assignments = await manager
    .getRepository(CrewAssignment)
    .findBy({ appointmentId, status: 'ASSIGNED' });
  if (!assignments.length || assignments.some((a) => !terminal.has(a.executionStatus))) return;
  const blockers = await returnResolveBlockers(manager, attempt);
  if (blockers.length) {
    attempt.current = false;
    attempt.closedOutcome = 'FAILED';
    attempt.closedAt = new Date();
    attempt.closedBy = actorId;
    attempt.closeReason = [input.reason, input.returnReason, input.remainingWork, ...blockers]
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000);
    request.status = 'OPEN';
    bumpReturn(request, actorId);
    await manager.save(ReturnVisitAttempt, attempt);
    await manager.save(ReturnVisitRequest, request);
    await manager.save(
      ActivityLog,
      manager.create(ActivityLog, {
        orderId: request.orderId,
        actorId,
        action: 'RETURN_VISIT_REOPENED',
        targetId: request.id,
        changes: {
          appointmentId,
          attemptId: attempt.id,
          outcome: 'FAILED',
          version: request.version,
          blockers,
        },
        reason: attempt.closeReason.slice(0, 1000),
      }),
    );
  }
}
