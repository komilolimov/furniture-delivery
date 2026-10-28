import type { AcceptanceSnapshotPayload } from '@furniture-delivery/contracts';
import type { EntityManager } from 'typeorm';
import { Order } from '../orders/order.entity';
import { OrderItem } from '../orders/order-item.entity';
import { Appointment } from '../planning/appointment.entity';
import { CrewAssignment } from '../planning/crew-assignment.entity';
import { Crew } from '../crews/crew.entity';
import { FinishReport } from '../execution/finish-report.entity';
import { ReturnVisitRequest } from '../execution/return-visit-request.entity';
import { Attachment } from '../evidence/attachment.entity';
import { Issue } from '../evidence/issue.entity';
import { IssueItem } from '../evidence/issue-item.entity';
import { PlanningConflict } from '../planning/planning-errors';

/** Canonical JSON preserves meaningful array order and sorts every object's own keys. */
export function canonicalAcceptance(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalAcceptance).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => JSON.stringify(key) + ':' + canonicalAcceptance(child))
        .join(',') +
      '}'
    );
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Acceptance content must be JSON.');
  return encoded;
}
/** Caller holds the Order/Appointment locks. Published payloads never reread live totals. */
export async function buildAcceptancePayload(
  manager: EntityManager,
  order: Order,
  appointment: Appointment,
  assignments: CrewAssignment[],
  actorId: string,
): Promise<AcceptanceSnapshotPayload> {
  const teams: AcceptanceSnapshotPayload['teams'] = [];
  for (const assignment of [...assignments].sort((a, b) => a.id.localeCompare(b.id))) {
    const report = await manager
      .getRepository(FinishReport)
      .findOneBy({ assignmentId: assignment.id, appointmentId: appointment.id, orderId: order.id });
    if (!report || !assignment.departedAt || !assignment.actualEndAt)
      throw new PlanningConflict(
        'FINISH_REPORT_REQUIRED',
        'Every participating team needs its immutable finish report before preparing this visit result.',
      );
    const crew = await manager.getRepository(Crew).findOneByOrFail({ id: assignment.crewId });
    teams.push({
      assignmentId: assignment.id,
      crewId: crew.id,
      crewName: crew.name,
      finishReportId: report.id,
      reportCreatedAt: report.createdAt.toISOString(),
      authorId: report.authorId,
      outcome: report.outcome,
      summary: report.summary,
      reason: report.reason,
      remainingWork: report.remainingWork,
      departedAt: assignment.departedAt.toISOString(),
      arrivedAt: assignment.arrivedAt?.toISOString() ?? null,
      actualStartAt: assignment.actualStartAt?.toISOString() ?? null,
      actualEndAt: report.actualEndAt.toISOString(),
      taskResults: report.taskResults,
      quantities: report.quantities,
    });
  }
  const items = await manager
    .getRepository(OrderItem)
    .find({ where: { orderId: order.id, active: true }, order: { sortOrder: 'ASC', id: 'ASC' } });
  // The common signer document contains the same crew-visible working material for everyone.
  const issues = await manager.getRepository(Issue).find({
    where: { orderId: order.id, visibility: 'CREW_VISIBLE' },
    order: { createdAt: 'ASC', id: 'ASC' },
  });
  const issueRefs: AcceptanceSnapshotPayload['issues'] = [];
  for (const issue of issues) {
    const links = await manager
      .getRepository(IssueItem)
      .find({ where: { issueId: issue.id, orderId: order.id }, order: { itemId: 'ASC' } });
    issueRefs.push({
      id: issue.id,
      type: issue.type,
      description: issue.description,
      status: issue.status,
      itemIds: links.map((link) => link.itemId),
    });
  }
  const requests = await manager
    .getRepository(ReturnVisitRequest)
    .find({ where: { orderId: order.id }, order: { createdAt: 'ASC', id: 'ASC' } });
  const files = await manager.getRepository(Attachment).find({
    where: { orderId: order.id, visibility: 'CREW_VISIBLE', state: 'READY' },
    order: { createdAt: 'ASC', id: 'ASC' },
  });
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    createdBy: actorId,
    order: {
      id: order.id,
      number: order.number,
      customerName: order.customerName,
      address: order.address,
      city: order.city,
      country: order.country,
      postalCode: order.postalCode,
      serviceType: order.serviceType,
      items: items.map((item) => ({
        id: item.id,
        description: item.description,
        quantity: item.quantity,
        configuration: item.configuration,
        ambient: item.ambient,
        requiresAssembly: item.requiresAssembly,
      })),
    },
    appointment: {
      id: appointment.id,
      plannedStartAt: appointment.plannedStartAt.toISOString(),
      plannedEndAt: appointment.plannedEndAt.toISOString(),
    },
    teams,
    issues: issueRefs,
    returnRequests: requests.map((r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason,
      remainingWork: r.remainingWork,
      appointmentId: r.appointmentId,
    })),
    evidence: files
      .filter((file) => !file.withdrawnAt)
      .map((file) => ({
        id: file.id,
        appointmentId: file.appointmentId,
        assignmentId: file.assignmentId,
        itemId: file.itemId,
        kind: file.kind,
        contentType: file.contentType,
        proofType: file.proofType,
        displayName: file.displayName,
        checksum: null,
      })),
    confirmation: {
      version: 'MVP-VISIT-1',
      text: 'I acknowledge the results recorded in this dated visit snapshot, including partial work, stated remaining work and known shared problems. Each team quantity is an accumulated order snapshot and must not be added to another team report. This acknowledgement does not waive rights, confirm the absence of all problems, or close the entire order. Events after this snapshot remain separate.',
    },
  };
}
