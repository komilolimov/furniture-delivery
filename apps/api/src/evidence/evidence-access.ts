import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { EvidenceProvenance } from '@furniture-delivery/contracts';
import { Order } from '../orders/order.entity';
import { Appointment } from '../planning/appointment.entity';
import { CrewAssignment } from '../planning/crew-assignment.entity';
import { OrderItem } from '../orders/order-item.entity';
import { User } from '../identity/user.entity';
import {
  authorizeCrewAssignment,
  lockExecutionUser,
  type ExecutionActor,
} from '../execution/execution-access';
import { Attachment } from './attachment.entity';
import { Issue } from './issue.entity';
export type EvidenceScope =
  | { orderId: string; assignmentId?: never }
  | { assignmentId: string; orderId?: never };
export interface EvidenceContext {
  user: User;
  order: Order;
  appointmentId: string | null;
  assignmentId: string | null;
  crewVisible: boolean;
}
export async function authorizeEvidence(
  manager: EntityManager,
  actor: ExecutionActor,
  scope: EvidenceScope,
  options: { lock: boolean; requireDeparted?: boolean },
): Promise<EvidenceContext> {
  if (scope.assignmentId) {
    if (!options.lock) await lockExecutionUser(manager, actor, ['CREW_MEMBER']);
    const c = await authorizeCrewAssignment(manager, actor, scope.assignmentId, options);
    return {
      user: c.user,
      order: c.order,
      appointmentId: c.appointment.id,
      assignmentId: c.assignment.id,
      crewVisible: true,
    };
  }
  await lockExecutionUser(manager, actor);
  const order = await manager.getRepository(Order).findOne({
    where: { id: scope.orderId },
    ...(options.lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
  });
  if (!order) throw new NotFoundException('Order not found.');
  const user = await lockExecutionUser(manager, actor);
  return { user, order, appointmentId: null, assignmentId: null, crewVisible: false };
}
export async function evidenceProvenance(
  manager: EntityManager,
  context: EvidenceContext,
  input: EvidenceProvenance,
): Promise<{ appointmentId: string | null; assignmentId: string | null; itemId: string | null }> {
  let appointmentId = context.appointmentId,
    assignmentId = context.assignmentId;
  if (!context.crewVisible) {
    if (input.assignmentId) {
      const assignment = await manager
        .getRepository(CrewAssignment)
        .findOneBy({ id: input.assignmentId });
      const appointment =
        assignment &&
        (await manager
          .getRepository(Appointment)
          .findOneBy({ id: assignment.appointmentId, orderId: context.order.id }));
      if (!assignment || !appointment)
        throw new NotFoundException('Assignment not found for this order.');
      if (input.appointmentId && input.appointmentId !== appointment.id)
        throw new BadRequestException('Assignment and appointment do not match.');
      assignmentId = assignment.id;
      appointmentId = appointment.id;
    } else if (input.appointmentId) {
      const appointment = await manager
        .getRepository(Appointment)
        .findOneBy({ id: input.appointmentId, orderId: context.order.id });
      if (!appointment) throw new NotFoundException('Appointment not found for this order.');
      appointmentId = appointment.id;
    }
  }
  if (
    input.itemId &&
    !(await manager
      .getRepository(OrderItem)
      .existsBy({ id: input.itemId, orderId: context.order.id }))
  )
    throw new NotFoundException('Item not found for this order.');
  return { appointmentId, assignmentId, itemId: input.itemId ?? null };
}
export async function assertEvidenceLinks(
  manager: EntityManager,
  context: EvidenceContext,
  input: {
    itemIds?: readonly string[];
    attachmentIds?: readonly string[];
    issueId?: string;
    visibility?: string;
  },
): Promise<void> {
  for (const id of input.itemIds ?? [])
    if (
      !(await manager
        .getRepository(OrderItem)
        .existsBy({ id, orderId: context.order.id, active: true }))
    )
      throw new NotFoundException('Item not found for this order.');
  const visibleOnly = context.crewVisible || input.visibility === 'CREW_VISIBLE';
  for (const id of input.attachmentIds ?? []) {
    const file = await manager
      .getRepository(Attachment)
      .findOneBy({ id, orderId: context.order.id });
    if (
      !file ||
      file.state !== 'READY' ||
      file.withdrawnAt ||
      (visibleOnly && file.visibility !== 'CREW_VISIBLE')
    )
      throw new NotFoundException('Attachment not found for this order.');
  }
  if (input.issueId) {
    const issue = await manager
      .getRepository(Issue)
      .findOneBy({ id: input.issueId, orderId: context.order.id });
    if (!issue || (visibleOnly && issue.visibility !== 'CREW_VISIBLE'))
      throw new NotFoundException('Issue not found for this order.');
  }
}
