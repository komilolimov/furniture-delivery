import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import type { Order } from '../orders/order.entity';
import { Issue } from '../evidence/issue.entity';
import { Attachment } from '../evidence/attachment.entity';
export interface ExecutionEvidenceSnapshot {
  openIssueCount: number;
  knownIssueIds: string[];
  knownAttachmentIds: string[];
}
/** Read-only seam: execution owns its snapshot, evidence owns its live metadata. Both serialize writes on Order. */
export async function readExecutionEvidence(
  manager: EntityManager,
  orderId: string,
  scope: { crewVisible?: boolean; assignmentId?: string } = {},
): Promise<ExecutionEvidenceSnapshot> {
  const visibility = scope.crewVisible ? { visibility: 'CREW_VISIBLE' as const } : {};
  const [issues, files] = await Promise.all([
    manager.getRepository(Issue).find({ where: { orderId, ...visibility }, order: { id: 'ASC' } }),
    manager
      .getRepository(Attachment)
      .find({ where: { orderId, ...visibility, state: 'READY' }, order: { id: 'ASC' } }),
  ]);
  return {
    openIssueCount: issues.filter((issue) => issue.status === 'OPEN').length,
    knownIssueIds: issues.map((issue) => issue.id),
    knownAttachmentIds: files.filter((file) => !file.withdrawnAt).map((file) => file.id),
  };
}
export function evidenceOpenIssueCountSql(
  query: SelectQueryBuilder<Order>,
  orderAlias: string,
): string {
  const metadata = query.connection.getMetadata(Issue);
  const table = [metadata.schema, metadata.tableName]
    .filter(Boolean)
    .map((name) => query.connection.driver.escape(name!))
    .join('.');
  return `(SELECT COUNT(*)::int FROM ${table} execution_issue WHERE execution_issue.order_id = ${orderAlias}.id AND execution_issue.status = 'OPEN')`;
}
