import { In, type EntityManager } from 'typeorm';
import type {
  CrewReturnContext,
  ReturnAttemptRecord,
  ReturnRequestDetail,
} from '@furniture-delivery/contracts';
import { CrewAssignment } from '../planning/crew-assignment.entity';
import { Task } from '../planning/task.entity';
import { OrderItem } from '../orders/order-item.entity';
import { ReturnVisitRequest } from '../execution/return-visit-request.entity';
import { ReturnVisitAttempt } from '../execution/return-visit-attempt.entity';
import { FinishReport } from '../execution/finish-report.entity';
import { mapCrewItem, mapFinishReport, mapReturnRequest } from '../execution/execution-mappers';
import { readAppointment } from '../planning/planning-projection';
import { returnScopeCandidates } from './return-scope';
export { returnScopeCandidates } from './return-scope';
import { returnResolveBlockers } from './return-lifecycle';

export function mapReturnAttempt(a: ReturnVisitAttempt): ReturnAttemptRecord {
  return {
    id: a.id,
    requestId: a.requestId,
    appointmentId: a.appointmentId,
    current: a.current,
    closedOutcome: a.closedOutcome,
    scope: a.scope,
    returnRequested: a.returnRequested,
    createdBy: a.createdBy,
    createdAt: a.createdAt.toISOString(),
    closedAt: a.closedAt?.toISOString() ?? null,
    closedBy: a.closedBy,
    closeReason: a.closeReason,
  };
}
export async function readReturnDetail(
  manager: EntityManager,
  request: ReturnVisitRequest,
): Promise<ReturnRequestDetail> {
  const attempts = await manager
    .getRepository(ReturnVisitAttempt)
    .find({ where: { requestId: request.id }, order: { createdAt: 'ASC', id: 'ASC' } });
  const current =
    attempts.find((a) => a.current) ??
    (request.status === 'RESOLVED'
      ? attempts.find((a) => a.closedOutcome === 'RESOLVED')
      : undefined);
  const reasons =
    current && request.status === 'PLANNED'
      ? await returnResolveBlockers(manager, current)
      : ['Plan and complete a current follow-up before resolving this request.'];
  return {
    request: mapReturnRequest(request),
    sourceReport: mapFinishReport(
      await manager.getRepository(FinishReport).findOneByOrFail({ id: request.finishReportId }),
    ),
    scopeCandidates: await returnScopeCandidates(manager, request),
    items: (
      await manager.getRepository(OrderItem).find({
        where: { orderId: request.orderId, active: true },
        order: { sortOrder: 'ASC', id: 'ASC' },
      })
    ).map(mapCrewItem),
    attempts: attempts.map(mapReturnAttempt),
    currentAppointment: current ? await readAppointment(manager, current.appointmentId) : null,
    readyToResolve: request.status === 'PLANNED' && reasons.length === 0,
    resolveBlockedReasons: reasons,
  };
}
/** This allowlist never inherits a backoffice detail, old report or private attachment. */
export async function readCrewReturnContext(
  manager: EntityManager,
  assignment: CrewAssignment,
): Promise<CrewReturnContext | null> {
  const attempt = await manager
    .getRepository(ReturnVisitAttempt)
    .findOneBy({ appointmentId: assignment.appointmentId });
  if (!attempt) return null;
  const request = await manager
    .getRepository(ReturnVisitRequest)
    .findOneByOrFail({ id: attempt.requestId });
  const tasks = await manager
    .getRepository(Task)
    .findBy({ assignmentId: assignment.id, active: true });
  const keys = new Set(tasks.map((t) => t.returnScopeKey));
  const scopeTasks = attempt.scope.tasks
    .filter((t) => keys.has(t.key))
    .map((t) => ({ ...t, crewId: assignment.crewId }));
  const sourceIds = scopeTasks.flatMap((t) => (t.sourceTaskId ? [t.sourceTaskId] : []));
  const sources = sourceIds.length
    ? await manager.getRepository(Task).findBy({ id: In(sourceIds) })
    : [];
  return {
    requestId: request.id,
    sourceAppointmentId: request.appointmentId,
    reason: request.reason,
    remainingWork: request.remainingWork,
    scope: { tasks: scopeTasks, itemTargets: attempt.scope.itemTargets },
    sourceTasks: sources.map((t) => ({ id: t.id, name: t.name, resultStatus: t.resultStatus })),
  };
}
