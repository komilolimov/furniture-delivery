import { In, type EntityManager } from 'typeorm';
import type { ReturnScopeCandidate } from '@furniture-delivery/contracts';
import { CrewAssignment } from '../planning/crew-assignment.entity';
import { Task } from '../planning/task.entity';
import { ReturnVisitRequest } from '../execution/return-visit-request.entity';
import { ReturnVisitAttempt } from '../execution/return-visit-attempt.entity';

/** Only live descendants from non-cancelled attempts supersede historical tasks. */
export async function returnScopeCandidates(
  manager: EntityManager,
  request: ReturnVisitRequest,
): Promise<ReturnScopeCandidate[]> {
  const attempts = await manager
    .getRepository(ReturnVisitAttempt)
    .findBy({ requestId: request.id });
  const validVisits = attempts
    .filter((a) => a.closedOutcome !== 'CANCELLED')
    .map((a) => a.appointmentId);
  const assignments = validVisits.length
    ? await manager
        .getRepository(CrewAssignment)
        .findBy({ appointmentId: In(validVisits), status: 'ASSIGNED' })
    : [];
  const ids = [request.assignmentId, ...assignments.map((a) => a.id)];
  const tasks = await manager.getRepository(Task).findBy({ assignmentId: In(ids), active: true });
  const superseded = new Set(tasks.flatMap((t) => (t.sourceTaskId ? [t.sourceTaskId] : [])));
  const visits = new Map(assignments.map((a) => [a.id, a.appointmentId]));
  visits.set(request.assignmentId, request.appointmentId);
  return tasks
    .filter(
      (t) =>
        t.resultStatus !== 'DONE' &&
        !(t.resultStatus === 'SKIPPED' && !t.required) &&
        !superseded.has(t.id),
    )
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map((t) => ({
      sourceTaskId: t.id,
      sourceAssignmentId: t.assignmentId,
      sourceAppointmentId: visits.get(t.assignmentId)!,
      name: t.name,
      description: t.description,
      required: t.required,
      severity: t.severity,
      priority: t.priority,
      resultStatus: t.resultStatus,
    }));
}
