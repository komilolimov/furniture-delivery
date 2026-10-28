'use client';

import Link from 'next/link';
import type {
  AppointmentDetail,
  OrderDetail,
  OrderExecutionResponse,
} from '@furniture-delivery/contracts';
import { isOrderExecutionResponse } from '../lib/execution-guards';
import { executionStatusLabel, formatWorkTime, orderProgressLabel } from '../lib/execution-labels';
import { useOrderResource } from '../lib/use-order-resource';
import { ResourceNotice } from './form-parts';
import { CreateReturnRequestControl } from './return-request-panel';
import './backoffice-execution.css';

export function AppointmentExecutionReadout({
  appointment,
}: Readonly<{ appointment: AppointmentDetail }>) {
  const execution = appointment.execution;
  return (
    <div className="bo-execution-readout">
      <p>
        {execution.completedCount} completed · {execution.activeCount} active ·{' '}
        {execution.partiallyCompletedCount} partial · {execution.blockedCount} blocked ·{' '}
        {execution.notStartedCount} not started. Required tasks {execution.requiredDoneCount}/
        {execution.requiredCount} done.
      </p>
      {execution.maybeDelayed && (
        <p className="form-error">
          Possibly delayed · active team has no recorded finish after the planned end.
        </p>
      )}
      <p className="section-copy">
        Order: {orderProgressLabel(execution.orderProgress)} · {execution.openIssueCount} open
        issues{execution.returnVisitRequired ? ' · Return visit required' : ''}
        {execution.workReadyForReview ? ' · Ready for review' : ''}.
      </p>
    </div>
  );
}

export function BackofficeExecutionPanel({
  order,
  appointmentId,
  onRefresh,
}: Readonly<{ order: OrderDetail; appointmentId?: string; onRefresh?: () => Promise<void> }>) {
  const resource = useOrderResource<OrderExecutionResponse>(
    `/orders/${order.id}/execution`,
    isOrderExecutionResponse,
    { retainDataOnRefresh: true },
  );
  const body = resource.data;
  const appointments =
    body?.appointments.filter(
      (appointment) => !appointmentId || appointment.id === appointmentId,
    ) ?? [];
  const reports =
    body?.execution.finishReports.filter(
      (report) => !appointmentId || report.appointmentId === appointmentId,
    ) ?? [];
  const returns =
    body?.execution.returnRequests.filter(
      (request) => !appointmentId || request.appointmentId === appointmentId,
    ) ?? [];
  async function refresh() {
    await Promise.all([resource.refresh(), onRefresh?.()]);
  }
  return (
    <section className="content-card bo-execution-panel" aria-label="Work execution">
      <div className="card-line">
        <div>
          <h2>{appointmentId ? 'Visit execution' : 'Work execution'}</h2>
          <p className="section-copy">
            Each team finishes its own participation. The order is not finally closed here.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={resource.pending}
          onClick={() => void refresh()}
        >
          Refresh execution
        </button>
      </div>
      <ResourceNotice
        pending={resource.pending}
        error={resource.error}
        retry={() => void refresh()}
      />
      {body && (
        <>
          <div className="bo-execution-badges">
            <span className="service-badge unknown">
              {orderProgressLabel(body.appointments[0]?.execution.orderProgress ?? order.progress)}
            </span>
            <span className="service-badge unknown">
              {body.execution.openIssueCount} open issues
            </span>
            {body.execution.returnVisitRequired && (
              <span className="service-badge down">Return visit required</span>
            )}
            {body.execution.workReadyForReview && (
              <span className="service-badge up">
                Ready for review · final confirmation still pending
              </span>
            )}
          </div>
          <h3>Accumulated quantities across the order</h3>
          <p className="section-copy">
            Shared across all teams and visits; these totals are not attributed to this team alone.
          </p>
          <ul className="bo-execution-items">
            {order.items
              .filter((item) => item.active)
              .map((item) => (
                <li key={item.id}>
                  <strong>{item.description}</strong>
                  <p>
                    Delivered {item.deliveredQuantity}/{item.quantity} · remaining{' '}
                    {item.quantity - item.deliveredQuantity}.
                  </p>
                  <p>
                    {item.requiresAssembly
                      ? `Assembled ${item.assembledQuantity}/${item.quantity} · remaining ${item.quantity - item.assembledQuantity}.`
                      : 'Assembly not required.'}
                  </p>
                </li>
              ))}
          </ul>
          <h3>Teams and actual times</h3>
          {appointments.length === 0 && (
            <p className="empty-copy">No visits yet. Plan the first visit from this order.</p>
          )}
          {appointments.map((appointment) => (
            <section className="bo-execution-visit" key={appointment.id}>
              <h4>
                Planned {formatWorkTime(appointment.plannedStartAt)} –{' '}
                {formatWorkTime(appointment.plannedEndAt)}
              </h4>
              <AppointmentExecutionReadout appointment={appointment} />
              {appointment.assignments.map((assignment) => (
                <div className="bo-execution-assignment" key={assignment.id}>
                  <h5>
                    {assignment.crewName} ·{' '}
                    {assignment.status === 'CANCELLED'
                      ? 'Removed booking'
                      : executionStatusLabel(assignment.execution.status)}
                  </h5>
                  <dl className="order-facts">
                    <div>
                      <dt>Departed</dt>
                      <dd>{formatWorkTime(assignment.execution.departedAt)}</dd>
                    </div>
                    <div>
                      <dt>Arrived</dt>
                      <dd>{formatWorkTime(assignment.execution.arrivedAt)}</dd>
                    </div>
                    <div>
                      <dt>Work started</dt>
                      <dd>{formatWorkTime(assignment.execution.actualStartAt)}</dd>
                    </div>
                    <div>
                      <dt>Work ended</dt>
                      <dd>{formatWorkTime(assignment.execution.actualEndAt)}</dd>
                    </div>
                  </dl>
                  <ul className="planned-tasks">
                    {assignment.tasks
                      .filter((task) => task.active)
                      .map((task) => (
                        <li key={task.id}>
                          <strong>
                            {task.name} · {task.resultStatus.toLowerCase()}
                          </strong>
                          <span>
                            {task.required ? 'Required' : 'Optional'} ·{' '}
                            {task.severity.toLowerCase()} · priority {task.priority}
                          </span>
                          {task.doneAt && (
                            <span>
                              {formatWorkTime(task.doneAt)} · author {task.doneBy}
                            </span>
                          )}
                          {task.resultReason && (
                            <p className="bo-execution-text">{task.resultReason}</p>
                          )}
                        </li>
                      ))}
                  </ul>
                  {assignment.status === 'ASSIGNED' &&
                    ['PARTIALLY_COMPLETED', 'BLOCKED'].includes(assignment.execution.status) && (
                      <CreateReturnRequestControl
                        assignmentId={assignment.id}
                        executionVersion={assignment.execution.version}
                        existingRequestId={
                          appointment.returnRequestId ??
                          body.execution.returnRequests.find(
                            (request) => request.assignmentId === assignment.id,
                          )?.id
                        }
                        onRefresh={refresh}
                      />
                    )}
                </div>
              ))}
            </section>
          ))}
          <h3>Frozen finish reports</h3>
          <p className="section-copy">
            A report records what was known at finish. Later quantities and evidence remain live in
            the order.
          </p>
          {reports.length === 0 && (
            <p className="empty-copy">No team has recorded a finish report for this scope.</p>
          )}
          {reports.map((report) => (
            <details key={report.id} className="bo-execution-report">
              <summary>
                {executionStatusLabel(report.outcome)} · {formatWorkTime(report.actualEndAt)} ·{' '}
                {body.appointments
                  .flatMap((appointment) => appointment.assignments)
                  .find((assignment) => assignment.id === report.assignmentId)?.crewName ?? 'Team'}
              </summary>
              <p className="bo-execution-text">{report.summary}</p>
              {report.reason && <p className="bo-execution-text">Reason: {report.reason}</p>}
              {report.remainingWork && (
                <p className="bo-execution-text">Remaining work: {report.remainingWork}</p>
              )}
              <p>Author: {report.authorId}</p>
              <p>
                Tasks at finish:{' '}
                {report.taskResults
                  .map((task) => `${task.name}: ${task.resultStatus.toLowerCase()}`)
                  .join('; ') || 'No active tasks'}
                .
              </p>
              <p>Accumulated order snapshot · not this team’s individual delivery total:</p>
              <ul>
                {report.quantities.map((item) => (
                  <li key={item.id}>
                    {item.description}: delivered {item.deliveredQuantity}/{item.quantity}
                    {item.requiresAssembly
                      ? `; assembled ${item.assembledQuantity}/${item.quantity}`
                      : '; assembly not required'}
                    .
                  </li>
                ))}
              </ul>
              <p>
                {report.knownIssueIds.length} known issues · {report.attachmentIds.length} evidence
                references at finish. Current availability appears in Evidence below.
              </p>
            </details>
          ))}
          <h3>Return visit requests</h3>
          {returns.length === 0 && (
            <p className="empty-copy">No return visit requests for this scope.</p>
          )}
          {returns.map((request) => (
            <article className="bo-execution-report" key={request.id}>
              <h4>
                {request.status === 'OPEN'
                  ? 'Open return visit request'
                  : request.status === 'PLANNED'
                    ? 'Planned return visit · need remains open'
                    : 'Resolved return visit request'}
              </h4>
              <p className="bo-execution-text">Reason: {request.reason}</p>
              <p className="bo-execution-text">Remaining work: {request.remainingWork}</p>
              <p>
                {formatWorkTime(request.createdAt)} · author {request.authorId}
              </p>
              <p className="section-copy">
                Recording or resolving an issue does not clear this request. A planned follow-up
                remains open until its completed scope is reviewed by the dispatcher.
              </p>
              <Link href={`/backoffice/return-requests/${request.id}`}>
                Review request, attempts and remaining work
              </Link>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
