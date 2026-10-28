import { NotFoundException } from '@nestjs/common';
import type {
  AttachmentRecord,
  EvidenceLimits,
  EvidenceResponse,
  ExecutionNoteRecord,
  IssueRecord,
} from '@furniture-delivery/contracts';
import type { EntityManager } from 'typeorm';
import { Attachment } from './attachment.entity';
import { ExecutionNote } from './execution-note.entity';
import { currentCompletionId } from '../completion/completion-state';
import { Issue } from './issue.entity';
import { IssueEvent } from './issue-event.entity';
import { IssueItem } from './issue-item.entity';
import { IssueAttachment } from './issue-attachment.entity';
import type { EvidenceContext } from './evidence-access';
export function mapAttachment(
  file: Attachment,
  scope: { orderId?: string; assignmentId?: string },
): AttachmentRecord {
  const parent = scope.assignmentId
    ? `/api/crew/assignments/${scope.assignmentId}`
    : `/api/orders/${scope.orderId ?? file.orderId}`;
  return {
    id: file.id,
    orderId: file.orderId,
    appointmentId: file.appointmentId,
    assignmentId: file.assignmentId,
    itemId: file.itemId,
    visibility: file.visibility,
    proofType: file.proofType,
    kind: file.kind,
    displayName: file.displayName,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    width: file.width,
    height: file.height,
    authorId: file.authorId,
    createdAt: file.createdAt.toISOString(),
    withdrawnAt: file.withdrawnAt?.toISOString() ?? null,
    withdrawReason: scope.assignmentId ? null : file.withdrawReason,
    contentUrl: `${parent}/attachments/${file.id}/content`,
    thumbnailUrl: file.kind === 'IMAGE' ? `${parent}/attachments/${file.id}/thumbnail` : null,
  };
}
export function mapExecutionNote(note: ExecutionNote): ExecutionNoteRecord {
  return {
    id: note.id,
    orderId: note.orderId,
    appointmentId: note.appointmentId,
    assignmentId: note.assignmentId,
    itemId: note.itemId,
    visibility: note.visibility,
    text: note.text,
    authorId: note.authorId,
    createdAt: note.createdAt.toISOString(),
  };
}
export async function readIssue(
  manager: EntityManager,
  context: Pick<EvidenceContext, 'order' | 'crewVisible'>,
  issueId: string,
): Promise<IssueRecord> {
  const issue = await manager
    .getRepository(Issue)
    .findOneBy({ id: issueId, orderId: context.order.id });
  if (!issue || (context.crewVisible && issue.visibility !== 'CREW_VISIBLE'))
    throw new NotFoundException('Issue not found for this order.');
  const [events, itemLinks, attachmentLinks] = await Promise.all([
    manager
      .getRepository(IssueEvent)
      .find({ where: { issueId }, order: { createdAt: 'ASC', id: 'ASC' } }),
    manager.getRepository(IssueItem).find({ where: { issueId }, order: { itemId: 'ASC' } }),
    manager
      .getRepository(IssueAttachment)
      .find({ where: { issueId }, order: { attachmentId: 'ASC' } }),
  ]);
  const attachmentIds = [];
  for (const link of attachmentLinks) {
    const file = await manager
      .getRepository(Attachment)
      .findOneBy({ id: link.attachmentId, orderId: context.order.id });
    // Defense in depth: a private child never becomes public through a public issue.
    if (file && (!context.crewVisible || file.visibility === 'CREW_VISIBLE'))
      attachmentIds.push(file.id);
  }
  return {
    id: issue.id,
    orderId: issue.orderId,
    orderCompleted: Boolean(await currentCompletionId(manager, issue.orderId)),
    appointmentId: issue.appointmentId,
    assignmentId: issue.assignmentId,
    visibility: issue.visibility,
    type: issue.type,
    description: issue.description,
    reportedSource: issue.reportedSource,
    status: issue.status,
    version: issue.version,
    itemIds: itemLinks.map((link) => link.itemId),
    attachmentIds,
    authorId: issue.authorId,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
    resolvedAt: issue.resolvedAt?.toISOString() ?? null,
    resolvedBy: issue.resolvedBy,
    resolution: issue.resolution,
    events: events.map((event) => ({
      id: event.id,
      issueId: event.issueId,
      kind: event.kind,
      text: event.text,
      actorId: event.actorId,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
export async function readEvidence(
  manager: EntityManager,
  context: EvidenceContext,
  limits: EvidenceLimits,
): Promise<EvidenceResponse> {
  const filter = {
    orderId: context.order.id,
    ...(context.crewVisible ? { visibility: 'CREW_VISIBLE' as const } : {}),
  };
  const [notes, issues, attachments] = await Promise.all([
    manager
      .getRepository(ExecutionNote)
      .find({ where: filter, order: { createdAt: 'ASC', id: 'ASC' } }),
    manager.getRepository(Issue).find({ where: filter, order: { createdAt: 'DESC', id: 'DESC' } }),
    manager
      .getRepository(Attachment)
      .find({ where: { ...filter, state: 'READY' }, order: { createdAt: 'ASC', id: 'ASC' } }),
  ]);
  const scope = context.crewVisible
    ? { assignmentId: context.assignmentId! }
    : { orderId: context.order.id };
  return {
    notes: notes.map(mapExecutionNote),
    issues: await Promise.all(issues.map((issue) => readIssue(manager, context, issue.id))),
    attachments: attachments.map((file) => mapAttachment(file, scope)),
    limits,
  };
}
