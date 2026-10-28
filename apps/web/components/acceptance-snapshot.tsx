import type { AcceptanceSnapshotRecord } from '@furniture-delivery/contracts';
import { executionStatusLabel, formatWorkTime } from '../lib/execution-labels';

export function AcceptanceSnapshotPreview({
  snapshot,
  ownAssignmentId,
}: Readonly<{ snapshot: AcceptanceSnapshotRecord; ownAssignmentId?: string }>) {
  const p = snapshot.payload;
  return (
    <section
      className="acceptance-snapshot"
      aria-label={`Recorded visit result revision ${snapshot.version}`}
    >
      <h3>Recorded visit result · revision {snapshot.version}</h3>
      <p>
        {p.order.number} · {p.order.customerName}
      </p>
      <p>
        {p.order.address}, {p.order.postalCode} {p.order.city}, {p.order.country}
      </p>
      <p>
        {p.order.serviceType === 'DELIVERY_ONLY' ? 'Delivery' : 'Delivery and assembly'} · planned{' '}
        {formatWorkTime(p.appointment.plannedStartAt)} –{' '}
        {formatWorkTime(p.appointment.plannedEndAt)}.
      </p>
      <p>
        Historical snapshot prepared {formatWorkTime(snapshot.createdAt)}. Current notes, quantities
        and issues elsewhere may be newer.
      </p>
      {snapshot.invalidatedAt && (
        <p className="conflict-notice">
          Historical document invalidated {formatWorkTime(snapshot.invalidatedAt)}:{' '}
          {snapshot.invalidationReason}. Its old confirmations do not apply to a new revision.
        </p>
      )}
      <p>
        Each team recorded accumulated order quantities at its own finish. These values are not
        added together.
      </p>
      {p.teams.map((team) => (
        <article
          key={team.assignmentId}
          className={`acceptance-team ${team.assignmentId === ownAssignmentId ? 'own-team' : ''}`}
        >
          <h4>
            {team.crewName}
            {team.assignmentId === ownAssignmentId ? ' · Your team’s part' : ''} ·{' '}
            {executionStatusLabel(team.outcome)}
          </h4>
          <p>{team.summary}</p>
          {team.reason && <p>Reason: {team.reason}</p>}
          {team.remainingWork && <p>Remaining work: {team.remainingWork}</p>}
          <p>
            Departed {formatWorkTime(team.departedAt)} · arrived {formatWorkTime(team.arrivedAt)} ·
            work started {formatWorkTime(team.actualStartAt)} · actual finish{' '}
            {formatWorkTime(team.actualEndAt)}.
          </p>
          <ul>
            {team.taskResults.map((task) => (
              <li key={task.id}>
                {task.name}: {task.resultStatus.toLowerCase()}
                {task.resultReason ? ` · ${task.resultReason}` : ''}.
              </li>
            ))}
          </ul>
          <p>Accumulated quantities recorded {formatWorkTime(team.reportCreatedAt)}:</p>
          <ul>
            {team.quantities.map((item) => (
              <li key={item.id}>
                {item.description}: delivered {item.deliveredQuantity}/{item.quantity}
                {item.requiresAssembly
                  ? `; assembled ${item.assembledQuantity}/${item.quantity}`
                  : '; assembly not required'}
                .
              </li>
            ))}
          </ul>
        </article>
      ))}
      <h4>Issues known in this snapshot</h4>
      {p.issues.length ? (
        <ul>
          {p.issues.map((issue) => (
            <li key={issue.id}>
              {issue.type.replaceAll('_', ' ')} · {issue.status} · {issue.description}
            </li>
          ))}
        </ul>
      ) : (
        <p>No visible issues were recorded in this snapshot.</p>
      )}
      {p.returnRequests.length > 0 && (
        <>
          <h4>Return needs known at preparation</h4>
          <ul>
            {p.returnRequests.map((request) => (
              <li key={request.id}>
                {request.status}: {request.reason} · {request.remainingWork}
              </li>
            ))}
          </ul>
        </>
      )}
      {p.evidence.length > 0 && (
        <>
          <h4>Evidence references at preparation</h4>
          <ul>
            {p.evidence.map((evidence) => (
              <li key={evidence.id}>
                {evidence.displayName} · {evidence.kind} · reference {evidence.id}
                {evidence.checksum ? ` · checksum ${evidence.checksum}` : ''}. Current access is
                checked separately in Evidence.
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="resource-notice">{p.confirmation.text}</p>
      <p className="section-copy">
        Content identifier SHA-256: {snapshot.hash}. This identifies document content; it does not
        verify identity or provide a certified digital signature.
      </p>
    </section>
  );
}
