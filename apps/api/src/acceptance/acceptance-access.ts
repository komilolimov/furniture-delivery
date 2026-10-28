import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { Crew } from '../crews/crew.entity';
import { CrewMember } from '../identity/crew-member.entity';
import type { User } from '../identity/user.entity';
import { Order } from '../orders/order.entity';
import { Appointment } from '../planning/appointment.entity';
import { CrewAssignment } from '../planning/crew-assignment.entity';
import { lockExecutionUser, type ExecutionActor } from '../execution/execution-access';
import { AcceptanceSnapshot } from './acceptance-snapshot.entity';

export type AcceptanceScope =
  | { orderId: string; appointmentId: string }
  | { assignmentId: string }
  | { snapshotId: string };
export interface AcceptanceContext {
  user: User;
  order: Order;
  appointment: Appointment;
  assignments: CrewAssignment[];
  ownAssignmentId: string | null;
  crew: boolean;
}
/** Preliminary membership precedes foreign parent locks; all child Crew locks are stable and sorted. */
export async function authorizeAcceptance(
  manager: EntityManager,
  actor: ExecutionActor,
  scope: AcceptanceScope,
  lock: boolean,
): Promise<AcceptanceContext> {
  const roles =
    'orderId' in scope
      ? (['ADMIN', 'DISPATCHER'] as const)
      : 'assignmentId' in scope
        ? (['CREW_MEMBER'] as const)
        : (['ADMIN', 'DISPATCHER', 'CREW_MEMBER'] as const);
  let user = await lockExecutionUser(manager, actor, roles);
  let appointmentId: string, expectedOrderId: string | undefined;
  if ('assignmentId' in scope) {
    const assignment = await manager
      .getRepository(CrewAssignment)
      .findOneBy({ id: scope.assignmentId });
    if (!assignment) throw new NotFoundException('Visit acknowledgement not found.');
    appointmentId = assignment.appointmentId;
  } else if ('snapshotId' in scope) {
    const snapshot = await manager
      .getRepository(AcceptanceSnapshot)
      .findOneBy({ id: scope.snapshotId });
    if (!snapshot) throw new NotFoundException('Visit acknowledgement not found.');
    appointmentId = snapshot.appointmentId;
    expectedOrderId = snapshot.orderId;
  } else {
    appointmentId = scope.appointmentId;
    expectedOrderId = scope.orderId;
  }
  const initial = await manager
    .getRepository(Appointment)
    .findOneBy({ id: appointmentId, ...(expectedOrderId ? { orderId: expectedOrderId } : {}) });
  if (!initial) throw new NotFoundException('Visit acknowledgement not found.');
  let ownAssignmentId: string | null = null;
  const crew = user.role === 'CREW_MEMBER';
  if (crew) {
    const membership = await manager
      .getRepository(CrewMember)
      .findOneBy({ userId: actor.id, active: true });
    const own =
      membership &&
      (await manager.getRepository(CrewAssignment).findOneBy({
        appointmentId,
        crewId: membership.crewId,
        status: 'ASSIGNED',
        ...('assignmentId' in scope ? { id: scope.assignmentId } : {}),
      }));
    if (!own || initial.status !== 'SCHEDULED')
      throw new NotFoundException('Visit acknowledgement not found.');
    ownAssignmentId = own.id;
  }
  const locking = lock ? { lock: { mode: 'pessimistic_write' as const } } : {};
  const order = await manager
    .getRepository(Order)
    .findOne({ where: { id: initial.orderId }, ...locking });
  const appointment = await manager
    .getRepository(Appointment)
    .findOne({ where: { id: appointmentId, orderId: initial.orderId }, ...locking });
  if (!order || !appointment) throw new NotFoundException('Visit acknowledgement not found.');
  const assignments = await manager
    .getRepository(CrewAssignment)
    .find({ where: { appointmentId, status: 'ASSIGNED' }, order: { crewId: 'ASC', id: 'ASC' } });
  if (lock)
    for (const crewId of [...new Set(assignments.map((assignment) => assignment.crewId))].sort())
      await manager
        .getRepository(Crew)
        .findOne({ where: { id: crewId }, lock: { mode: 'pessimistic_write' } });
  user = await lockExecutionUser(manager, actor, roles);
  if (crew) {
    const own = assignments.find((assignment) => assignment.id === ownAssignmentId);
    if (
      !own ||
      appointment.status !== 'SCHEDULED' ||
      !(await manager
        .getRepository(CrewMember)
        .existsBy({ userId: actor.id, crewId: own.crewId, active: true }))
    )
      throw new NotFoundException('Visit acknowledgement not found.');
  }
  return { user, order, appointment, assignments, ownAssignmentId, crew };
}
export function requireBackoffice(context: AcceptanceContext): void {
  if (context.crew) throw new ForbiddenException('This action requires a dispatcher.');
}
export function slotAllowed(
  context: AcceptanceContext,
  kind: string,
  assignmentId: string | null,
): boolean {
  return kind === 'CUSTOMER' || (context.crew && assignmentId === context.ownAssignmentId);
}
