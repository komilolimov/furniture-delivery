'use client';
import { memo, useEffect, useRef } from 'react';
import Link from 'next/link';
import type { RiskBoardResponse, RiskQuery } from '@furniture-delivery/contracts';
import { displayRome } from '../lib/business-time';
import { formatWorkTime } from '../lib/execution-labels';
import { isRiskBoardResponse } from '../lib/rescheduling-guards';
import { useOrderResource } from '../lib/use-order-resource';
import { useRealtimeCoordinator } from '../lib/realtime-context';
import { ResourceNotice } from './form-parts';
import './rescheduling.css';
const labels = {
  NOT_DEPARTED: 'Departure needs checking',
  OVERRUN: 'Possible overrun',
  ESTIMATE_STALE: 'Estimate is stale',
  NEXT_VISIT_AT_RISK: 'Next visit at risk',
  UNKNOWN_RELEASE: 'Release time unknown',
};
export const RiskPanel = memo(function RiskPanel({
  query,
  refreshSignal = 0,
}: Readonly<{ query: RiskQuery; refreshSignal?: number }>) {
  const live = useRealtimeCoordinator();
  const params = new URLSearchParams({
    from: query.from,
    to: query.to,
    allTeams: String(query.allTeams),
    ...(query.allTeams ? {} : { crewIds: query.crewIds.join(',') }),
  });
  const resource = useOrderResource<RiskBoardResponse>(
    `/planning/risks?${params}`,
    isRiskBoardResponse,
  );
  const previousRefresh = useRef(refreshSignal);
  useEffect(() => {
    if (previousRefresh.current === refreshSignal) return;
    previousRefresh.current = refreshSignal;
    void resource.refresh();
  }, [refreshSignal, resource.refresh]);
  useEffect(() => {
    if (live) return;
    const refresh = () => {
      void resource.refresh();
    };
    window.addEventListener('fd:planning-changed', refresh);
    return () => window.removeEventListener('fd:planning-changed', refresh);
  }, [resource.refresh, live]);
  return (
    <section className="content-card risk-panel" aria-label="Schedule risks">
      <div className="card-line">
        <h2>Schedule risks</h2>
        <button
          type="button"
          className="secondary-button"
          disabled={resource.pending}
          onClick={() => void resource.refresh()}
        >
          Refresh risks
        </button>
      </div>
      <p className="section-copy">
        Warnings suggest a dispatcher review. No visit is moved automatically. Dates and team
        filters follow the calendar.
      </p>
      <ResourceNotice
        pending={resource.pending}
        error={resource.error}
        retry={() => void resource.refresh()}
      />
      {resource.data && (
        <>
          <p className="section-copy">
            Calculated {displayRome(resource.data.dataAsOf)} · Europe/Rome.
          </p>
          {resource.data.risks.length === 0 && (
            <p className="empty-copy">No schedule risks in this range.</p>
          )}
          <ul>
            {resource.data.risks.map((visit) => (
              <li key={visit.appointmentId}>
                <Link
                  href={`/backoffice/planning/orders/${visit.orderId}/appointments/${visit.appointmentId}`}
                >
                  {visit.orderNumber} · {displayRome(visit.plannedStartAt)} –{' '}
                  {displayRome(visit.plannedEndAt)}
                </Link>
                <ul>
                  {visit.reasons.map((reason) => (
                    <li key={`${reason.code}:${reason.crewId}:${reason.sourceAssignmentId}`}>
                      <strong>
                        {reason.crewName}: {labels[reason.code]}
                      </strong>
                      <p>{reason.message}</p>
                      <p className="section-copy">
                        Source visit {reason.sourceAppointmentId}. Plan{' '}
                        {formatWorkTime(reason.sourcePlannedStartAt)} –{' '}
                        {formatWorkTime(reason.sourcePlannedEndAt)} · estimate{' '}
                        {formatWorkTime(reason.sourceEstimatedFinishAt)} · actual end{' '}
                        {formatWorkTime(reason.sourceActualEndAt)} · buffer{' '}
                        {reason.travelBufferMinutes} min · release{' '}
                        {reason.expectedReleaseAt
                          ? formatWorkTime(reason.expectedReleaseAt)
                          : 'Unknown'}{' '}
                        · basis {reason.basis.toLowerCase()}.
                      </p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
});
