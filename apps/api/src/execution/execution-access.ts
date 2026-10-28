import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { UserRole } from '@furniture-delivery/contracts';
import type { EntityManager } from 'typeorm';
import { User } from '../identity/user.entity';
import { AuthSession } from '../identity/auth-session.entity';
import { CrewMember } from '../identity/crew-member.entity';
import { Crew } from '../crews/crew.entity';
import { Order } from '../orders/order.entity';
import { Appointment } from '../planning/appointment.entity';
import { CrewAssignment } from '../planning/crew-assignment.entity';

export interface ExecutionActor {
  id: string;
  sessionId?: string;
}
export interface CrewExecutionContext {
  user: User;
  crew: Crew;
  order: Order;
  appointment: Appointment;
  assignment: CrewAssignment;
}
async function currentUser(
  manager: EntityManager,
  actor: ExecutionActor,
  roles: readonly UserRole[],
  lock: boolean,
): Promise<User> {
  const user = await manager.getRepository(User).findOne({
    where: { id: actor.id },
    ...(lock ? { lock: { mode: 'pessimistic_read' as const } } : {}),
  });
  if (!user?.active) throw new UnauthorizedException('The account is unavailable.');
  if (!roles.includes(user.role)) throw new ForbiddenException('This action is not permitted.');
  if (actor.sessionId) {
    const session = await manager
      .getRepository(AuthSession)
      .findOneBy({ id: actor.sessionId, userId: actor.id });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedException('The session has expired.');
  }
  return user;
}
/** SHARE, never KEY SHARE or a later upgrade: M2 account/membership updates lock User first. */
export function lockExecutionUser(
  manager: EntityManager,
  actor: ExecutionActor | string,
  roles: readonly UserRole[] = ['ADMIN', 'DISPATCHER'],
): Promise<User> {
  return currentUser(manager, typeof actor === 'string' ? { id: actor } : actor, roles, true);
}
export async function authorizeCrewAssignment(
  manager: EntityManager,
  actor: ExecutionActor,
  assignmentId: string,
  options: { lock: boolean; requireDeparted?: boolean },
): Promise<CrewExecutionContext> {
  await currentUser(manager, actor, ['CREW_MEMBER'], options.lock);
  const initial = await manager.getRepository(CrewAssignment).findOneBy({ id: assignmentId });
  const visit =
    initial && (await manager.getRepository(Appointment).findOneBy({ id: initial.appointmentId }));
  if (!initial || !visit) throw new NotFoundException('Assignment not found.');
  const initialMembership = await manager
    .getRepository(CrewMember)
    .existsBy({ userId: actor.id, crewId: initial.crewId, active: true });
  if (!initialMembership) throw new NotFoundException('Assignment not found.');
  // Immutable parent IDs are read before locking. All writers acquire these same locks in this order.
  const lock = options.lock ? { lock: { mode: 'pessimistic_write' as const } } : {};
  const order = await manager
    .getRepository(Order)
    .findOne({ where: { id: visit.orderId }, ...lock });
  const appointment = await manager
    .getRepository(Appointment)
    .findOne({ where: { id: visit.id }, ...lock });
  const crew = await manager
    .getRepository(Crew)
    .findOne({ where: { id: initial.crewId }, ...lock });
  const assignment = await manager
    .getRepository(CrewAssignment)
    .findOne({ where: { id: assignmentId }, ...lock });
  // Recheck authorization after every possibly waiting business lock. User SHARE serializes M2 changes.
  const user = await currentUser(manager, actor, ['CREW_MEMBER'], false);
  const membership = await manager
    .getRepository(CrewMember)
    .findOneBy({ userId: actor.id, crewId: initial.crewId, active: true });
  if (
    !order ||
    !appointment ||
    !crew ||
    !assignment ||
    !membership ||
    assignment.status !== 'ASSIGNED' ||
    appointment.status !== 'SCHEDULED'
  )
    throw new NotFoundException('Assignment not found.');
  if (options.requireDeparted && assignment.executionStatus === 'NOT_STARTED')
    throw new ForbiddenException('Depart before adding execution evidence.');
  return { user, crew, order, appointment, assignment };
}
