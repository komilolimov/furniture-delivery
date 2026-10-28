import type { OrderProgress, OrderExecutionSummary } from '@furniture-delivery/contracts';
import type { EntityManager, EntityTarget, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { Order } from '../orders/order.entity';
import { OrderItem } from '../orders/order-item.entity';
import { Appointment } from '../planning/appointment.entity';
import { CrewAssignment } from '../planning/crew-assignment.entity';
import { Task } from '../planning/task.entity';
import { FinishReport } from './finish-report.entity';
import { ReturnVisitAttempt } from './return-visit-attempt.entity';
import { ReturnVisitRequest } from './return-visit-request.entity';
import { evidenceOpenIssueCountSql } from './execution-evidence-port';
import { mapFinishReport, mapReturnRequest } from './execution-mappers';
export interface ProgressFacts {
  plannedProgress: 'INBOX' | 'PLANNED' | 'ASSIGNED';
  hasActiveExecution: boolean;
  volumeReady: boolean;
  hasCompletedWork: boolean;
  hasPartialOutcome: boolean;
  hasBlockedOutcome: boolean;
  openIssueCount: number;
  openReturnCount: number;
  hasCurrentCompletion?: boolean;
}
export interface ResolvedExecutionState {
  progress: OrderProgress;
  workReadyForReview: boolean;
  openIssueCount: number;
  returnVisitRequired: boolean;
  currentCompletionId?: string | null;
}
/** The SQL form below follows this same precedence. Payment state is deliberately absent. */
export function resolveOrderProgress(f: ProgressFacts): ResolvedExecutionState {
  const blockers = f.openIssueCount > 0 || f.openReturnCount > 0;
  const progress: OrderProgress = f.hasCurrentCompletion
    ? 'COMPLETED'
    : f.hasActiveExecution
      ? 'IN_PROGRESS'
      : f.volumeReady
        ? blockers
          ? 'REQUIRES_ATTENTION'
          : 'AWAITING_REVIEW'
        : f.hasCompletedWork || f.hasPartialOutcome
          ? 'PARTIALLY_COMPLETED'
          : f.hasBlockedOutcome || blockers
            ? 'REQUIRES_ATTENTION'
            : f.plannedProgress;
  return {
    progress,
    workReadyForReview: f.volumeReady && !blockers && !f.hasActiveExecution,
    openIssueCount: f.openIssueCount,
    returnVisitRequired: f.openReturnCount > 0,
  };
}
export interface ExecutionSql {
  progressSql: string;
  workReadySql: string;
  openIssueCountSql: string;
  returnVisitRequiredSql: string;
  activeCountSql: string;
  completedCountSql: string;
  partialCountSql: string;
  blockedCountSql: string;
  physicalFacts: Record<
    | 'anyVisit'
    | 'hasWork'
    | 'unassignedVisit'
    | 'incompleteAssignment'
    | 'incompleteTask'
    | 'incompleteItem'
    | 'unstartedCount'
    | 'uncoveredOutcomeCount'
    | 'openReturnCount',
    string
  >;
}
export function executionStateSql(query: SelectQueryBuilder<Order>, alias: string): ExecutionSql {
  const table = <T extends ObjectLiteral>(entity: EntityTarget<T>) => {
    const metadata = query.connection.getMetadata(entity);
    return [metadata.schema, metadata.tableName]
      .filter(Boolean)
      .map((n) => query.connection.driver.escape(n!))
      .join('.');
  };
  const visits = table(Appointment),
    assignments = table(CrewAssignment),
    tasks = table(Task),
    items = table(OrderItem),
    returns = table(ReturnVisitRequest),
    attempts = table(ReturnVisitAttempt);
  const visitScope = `v.order_id = ${alias}.id AND v.status = 'SCHEDULED'`;
  const assignmentScope = `${visitScope} AND a.status = 'ASSIGNED'`;
  const assignmentFrom = `${assignments} a JOIN ${visits} v ON v.id = a.appointment_id`;
  const assignmentCount = (condition: string) =>
    `(SELECT COUNT(*)::int FROM ${assignmentFrom} WHERE ${assignmentScope} AND (${condition}))`;
  const activeCountSql = assignmentCount(
      "a.execution_status IN ('ON_THE_WAY','ARRIVED','IN_PROGRESS')",
    ),
    completedCountSql = assignmentCount("a.execution_status = 'COMPLETED'"),
    partialCountSql = assignmentCount("a.execution_status = 'PARTIALLY_COMPLETED'"),
    blockedCountSql = assignmentCount("a.execution_status = 'BLOCKED'");
  const anyVisit = `EXISTS(SELECT 1 FROM ${visits} v WHERE ${visitScope})`;
  const unassignedVisit = `EXISTS(SELECT 1 FROM ${visits} v WHERE ${visitScope} AND NOT EXISTS(SELECT 1 FROM ${assignments} a WHERE a.appointment_id = v.id AND a.status = 'ASSIGNED'))`;
  const planned = `(CASE WHEN NOT ${anyVisit} THEN 'INBOX' WHEN ${unassignedVisit} THEN 'PLANNED' ELSE 'ASSIGNED' END)`;
  const itemWork = `EXISTS(SELECT 1 FROM ${items} i WHERE i.order_id = ${alias}.id AND i.active AND (i.delivered_quantity > 0 OR i.assembled_quantity > 0))`;
  const taskWork = `EXISTS(SELECT 1 FROM ${tasks} t JOIN ${assignments} a ON a.id = t.assignment_id JOIN ${visits} v ON v.id = a.appointment_id WHERE ${assignmentScope} AND t.active AND t.result_status = 'DONE')`;
  const hasWork = `(${itemWork} OR ${taskWork} OR ${completedCountSql} > 0 OR ${partialCountSql} > 0)`;
  // A dispatcher-resolved chain may cover an old outcome; immutable historical rows stay intact.
  const coveredAssignment = `EXISTS(SELECT 1 FROM ${returns} rc WHERE rc.order_id = ${alias}.id AND rc.status = 'RESOLVED' AND EXISTS(SELECT 1 FROM ${attempts} final_attempt WHERE final_attempt.request_id = rc.id AND final_attempt.closed_outcome = 'RESOLVED') AND (rc.assignment_id = a.id OR EXISTS(SELECT 1 FROM ${attempts} old_attempt WHERE old_attempt.request_id = rc.id AND old_attempt.appointment_id = a.appointment_id AND old_attempt.closed_outcome <> 'CANCELLED')))`;
  const coveredTask = `(${coveredAssignment} AND EXISTS(WITH RECURSIVE carried AS (
    SELECT child.id, child.source_task_id, child.result_status, child.required, ARRAY[child.id] AS path
    FROM ${tasks} child JOIN ${assignments} ca ON ca.id = child.assignment_id JOIN ${visits} cv ON cv.id = ca.appointment_id
    WHERE child.source_task_id = t.id AND child.active AND ca.status = 'ASSIGNED' AND cv.status = 'SCHEDULED' AND cv.order_id = ${alias}.id
    UNION ALL
    SELECT child.id, child.source_task_id, child.result_status, child.required, carried.path || child.id
    FROM ${tasks} child JOIN carried ON child.source_task_id = carried.id JOIN ${assignments} ca ON ca.id = child.assignment_id JOIN ${visits} cv ON cv.id = ca.appointment_id
    WHERE child.active AND ca.status = 'ASSIGNED' AND cv.status = 'SCHEDULED' AND cv.order_id = ${alias}.id AND NOT child.id = ANY(carried.path)
  ) SELECT 1 FROM carried WHERE result_status = 'DONE' OR (NOT required AND result_status = 'SKIPPED')))`;
  const incompleteAssignment = `EXISTS(SELECT 1 FROM ${assignmentFrom} WHERE ${assignmentScope} AND a.execution_status <> 'COMPLETED' AND NOT ${coveredAssignment})`;
  const incompleteTask = `EXISTS(SELECT 1 FROM ${tasks} t JOIN ${assignments} a ON a.id = t.assignment_id JOIN ${visits} v ON v.id = a.appointment_id WHERE ${assignmentScope} AND t.active AND (t.result_status = 'PENDING' OR (t.required AND t.result_status <> 'DONE')) AND NOT ${coveredTask})`;
  const incompleteItem = `EXISTS(SELECT 1 FROM ${items} i WHERE i.order_id = ${alias}.id AND i.active AND (i.delivered_quantity <> i.quantity OR (i.requires_assembly AND i.assembled_quantity <> i.quantity)))`;
  const volumeReady = `(${hasWork} AND ${anyVisit} AND NOT ${unassignedVisit} AND NOT ${incompleteAssignment} AND NOT ${incompleteTask} AND NOT ${incompleteItem})`;
  const openIssueCountSql = evidenceOpenIssueCountSql(query, alias);
  const openReturnCount = `(SELECT COUNT(*)::int FROM ${returns} r WHERE r.order_id = ${alias}.id AND r.status IN ('OPEN','PLANNED'))`;
  const blockers = `((${openIssueCountSql}) > 0 OR ${openReturnCount} > 0)`;
  const workReadySql = `(${volumeReady} AND NOT ${blockers} AND ${activeCountSql} = 0)`;
  const progressSql = `(CASE WHEN ${alias}.current_completion_id IS NOT NULL THEN 'COMPLETED' WHEN ${activeCountSql} > 0 THEN 'IN_PROGRESS' WHEN ${volumeReady} THEN CASE WHEN ${blockers} THEN 'REQUIRES_ATTENTION' ELSE 'AWAITING_REVIEW' END WHEN ${hasWork} THEN 'PARTIALLY_COMPLETED' WHEN ${blockedCountSql} > 0 OR ${blockers} THEN 'REQUIRES_ATTENTION' ELSE ${planned} END)`;
  return {
    progressSql,
    workReadySql,
    openIssueCountSql,
    returnVisitRequiredSql: `(${openReturnCount} > 0)`,
    activeCountSql,
    completedCountSql,
    partialCountSql,
    blockedCountSql,
    physicalFacts: {
      anyVisit,
      hasWork,
      unassignedVisit,
      incompleteAssignment,
      incompleteTask,
      incompleteItem,
      unstartedCount: assignmentCount("a.execution_status = 'NOT_STARTED'"),
      uncoveredOutcomeCount: assignmentCount(
        `a.execution_status IN ('PARTIALLY_COMPLETED','BLOCKED') AND NOT ${coveredAssignment}`,
      ),
      openReturnCount,
    },
  };
}
export async function readOrderExecutionState(
  manager: EntityManager,
  orderId: string,
): Promise<ResolvedExecutionState> {
  const query = manager.getRepository(Order).createQueryBuilder('execution_order');
  const sql = executionStateSql(query, 'execution_order');
  const row = await query
    .select(sql.progressSql, 'progress')
    .addSelect(sql.workReadySql, 'ready')
    .addSelect(sql.openIssueCountSql, 'issues')
    .addSelect(sql.returnVisitRequiredSql, 'returns')
    .addSelect('execution_order.currentCompletionId', 'completion')
    .where('execution_order.id = :orderId', { orderId })
    .getRawOne<{
      progress: OrderProgress;
      ready: boolean;
      issues: number | string;
      returns: boolean;
      completion: string | null;
    }>();
  return {
    progress: row?.progress ?? 'INBOX',
    workReadyForReview: row?.ready ?? false,
    openIssueCount: Number(row?.issues ?? 0),
    returnVisitRequired: row?.returns ?? false,
    currentCompletionId: row?.completion ?? null,
  };
}
export async function readOrderExecution(
  manager: EntityManager,
  orderId: string,
): Promise<OrderExecutionSummary> {
  const query = manager.getRepository(Order).createQueryBuilder('execution_order');
  const sql = executionStateSql(query, 'execution_order');
  const [row, state, reports, returns] = await Promise.all([
    query
      .select(sql.activeCountSql, 'active')
      .addSelect(sql.completedCountSql, 'completed')
      .addSelect(sql.partialCountSql, 'partial')
      .addSelect(sql.blockedCountSql, 'blocked')
      .where('execution_order.id = :orderId', { orderId })
      .getRawOne<{ active: string; completed: string; partial: string; blocked: string }>(),
    readOrderExecutionState(manager, orderId),
    manager
      .getRepository(FinishReport)
      .find({ where: { orderId }, order: { createdAt: 'ASC', id: 'ASC' } }),
    manager
      .getRepository(ReturnVisitRequest)
      .find({ where: { orderId }, order: { createdAt: 'ASC', id: 'ASC' } }),
  ]);
  return {
    workReadyForReview: state.workReadyForReview,
    openIssueCount: state.openIssueCount,
    returnVisitRequired: state.returnVisitRequired,
    activeAssignmentCount: Number(row?.active ?? 0),
    completedAssignmentCount: Number(row?.completed ?? 0),
    partiallyCompletedAssignmentCount: Number(row?.partial ?? 0),
    blockedAssignmentCount: Number(row?.blocked ?? 0),
    finishReports: reports.map(mapFinishReport),
    returnRequests: returns.map(mapReturnRequest),
  };
}

/** M7 consumes exactly the same M6 predicates, including resolved return coverage. */
export async function readPhysicalReadiness(manager: EntityManager, orderId: string) {
  const query = manager.getRepository(Order).createQueryBuilder('physical_order');
  const sql = executionStateSql(query, 'physical_order');
  query
    .select(sql.workReadySql, 'workReady')
    .addSelect(sql.activeCountSql, 'activeCount')
    .addSelect(sql.openIssueCountSql, 'openIssueCount');
  for (const [name, expression] of Object.entries(sql.physicalFacts))
    query.addSelect(expression, name);
  const row = await query
    .where('physical_order.id = :orderId', { orderId })
    .getRawOne<Record<string, boolean | number | string>>();
  const flag = (key: string) => row?.[key] === true;
  const count = (key: string) => Number(row?.[key] ?? 0);
  return {
    workReady: flag('workReady'),
    anyVisit: flag('anyVisit'),
    hasWork: flag('hasWork'),
    unassignedVisit: flag('unassignedVisit'),
    incompleteAssignment: flag('incompleteAssignment'),
    incompleteTask: flag('incompleteTask'),
    incompleteItem: flag('incompleteItem'),
    activeCount: count('activeCount'),
    unstartedCount: count('unstartedCount'),
    uncoveredOutcomeCount: count('uncoveredOutcomeCount'),
    openIssueCount: count('openIssueCount'),
    openReturnCount: count('openReturnCount'),
  };
}
