import type { DataSource } from 'typeorm';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { UserRole } from '@furniture-delivery/contracts';
import { lockExecutionUser, type ExecutionActor } from '../execution/execution-access';
import { CrewMember } from '../identity/crew-member.entity';
import { CrewAssignment } from '../planning/crew-assignment.entity';
import { Appointment } from '../planning/appointment.entity';
export interface RealtimeScope {
  role: UserRole;
  crewId: string | null;
  assignmentIds: ReadonlySet<string>;
  orderIds: ReadonlySet<string>;
}
export const MAX_REALTIME_ASSIGNMENTS = 1000;
export async function readRealtimeScope(
  source: DataSource,
  actor: ExecutionActor,
): Promise<RealtimeScope> {
  if (!actor.sessionId) throw new UnauthorizedException('Authentication required.');
  return source.transaction('READ COMMITTED', async (manager) => {
    const user = await lockExecutionUser(manager, actor, ['ADMIN', 'DISPATCHER', 'CREW_MEMBER']);
    if (user.role !== 'CREW_MEMBER')
      return {
        role: user.role,
        crewId: null,
        assignmentIds: new Set<string>(),
        orderIds: new Set<string>(),
      };
    const member = await manager
      .getRepository(CrewMember)
      .findOneBy({ userId: actor.id, active: true });
    if (!member)
      return {
        role: user.role,
        crewId: null,
        assignmentIds: new Set<string>(),
        orderIds: new Set<string>(),
      };
    const rows = await manager
      .getRepository(CrewAssignment)
      .createQueryBuilder('a')
      .innerJoin(Appointment, 'v', 'v.id=a.appointmentId')
      .select('a.id', 'assignmentId')
      .addSelect('v.orderId', 'orderId')
      .where("a.crewId=:crewId AND a.status='ASSIGNED' AND v.status='SCHEDULED'", {
        crewId: member.crewId,
      })
      .limit(MAX_REALTIME_ASSIGNMENTS + 1)
      .getRawMany<{ assignmentId: string; orderId: string }>();
    if (rows.length > MAX_REALTIME_ASSIGNMENTS)
      throw new ServiceUnavailableException('Realtime scope is too large. Use periodic refresh.');
    return {
      role: user.role,
      crewId: member.crewId,
      assignmentIds: new Set(rows.map((row) => row.assignmentId)),
      orderIds: new Set(rows.map((row) => row.orderId)),
    };
  });
}
/** Additions need a list refresh; losing any old assignment invalidates private drafts. */
export function lostRealtimeAccess(before: RealtimeScope, after: RealtimeScope): boolean {
  return (
    before.role !== after.role ||
    before.crewId !== after.crewId ||
    [...before.assignmentIds].some((id) => !after.assignmentIds.has(id))
  );
}
