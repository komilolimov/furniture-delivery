'use client';

import type { AppointmentDetail } from '@furniture-delivery/contracts';
import Link from 'next/link';
import { CalendarDays, Clock, ExternalLink, MapPin, Users } from 'lucide-react';
import { displayRome } from '../lib/business-time';
import { executionStatusLabel, formatWorkTime, orderProgressLabel } from '../lib/execution-labels';
import { serviceLabels } from '../lib/order-labels';
import { activeTeams, rangeTime } from '../lib/planning-calendar-model';
import { appointmentHref } from './order-appointments';
import { Badge } from './ui/badge';
import { buttonVariants } from './ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';

const card = 'tw:rounded-xl tw:border tw:border-solid tw:border-[#e0e6d9] tw:bg-[#fffefa] tw:p-4';
export function PlanningVisitPreview({
  appointment,
  onClose,
  returnFocus,
}: Readonly<{
  appointment: AppointmentDetail | null;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}>) {
  return (
    <Sheet
      open={appointment !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        aria-label="Visit preview"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus?.isConnected) returnFocus.focus();
        }}
      >
        {appointment && (
          <>
            <SheetHeader>
              <p className="tw:m-0 tw:text-[10px] tw:font-bold tw:tracking-widest tw:text-[#226347] tw:uppercase">
                Visit · {appointment.orderNumber}
              </p>
              <SheetTitle>Visit preview</SheetTitle>
              <h3 className="tw:mt-2 tw:mb-0 tw:text-[25px] tw:leading-tight tw:font-medium tw:tracking-[-0.6px] tw:wrap-anywhere">
                {appointment.customerName}
              </h3>
              <SheetDescription>
                {appointment.city} · {serviceLabels[appointment.serviceType]}
              </SheetDescription>
            </SheetHeader>
            <div className="tw:flex tw:flex-wrap tw:gap-2">
              <Badge>{orderProgressLabel(appointment.execution.orderProgress)}</Badge>
              <Badge
                variant={appointment.confirmationStatus === 'CONFIRMED' ? 'success' : 'warning'}
              >
                {appointment.confirmationStatus === 'CONFIRMED'
                  ? 'Confirmed'
                  : 'Needs confirmation'}
              </Badge>
              {appointment.needsAttention && <Badge variant="destructive">Needs attention</Badge>}
              {appointment.execution.returnVisitRequired && (
                <Badge variant="warning">Return required</Badge>
              )}
              {appointment.execution.openIssueCount > 0 && (
                <Badge variant="destructive">
                  {appointment.execution.openIssueCount} open issues
                </Badge>
              )}
            </div>
            <section className={card}>
              <h3 className="tw:mt-0 tw:mb-3 tw:flex tw:items-center tw:gap-2 tw:text-sm tw:font-semibold">
                <CalendarDays size={16} aria-hidden="true" />
                Planned window
              </h3>
              <p className="tw:my-1 tw:text-sm tw:font-medium">
                {displayRome(appointment.plannedStartAt).split(',')[0]} · {rangeTime(appointment)}
              </p>
              <p className="tw:mb-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
                {appointment.durationMinutes} minutes · Europe/Rome. Travel buffers are reserved
                separately.
              </p>
            </section>
            <section>
              <h3 className="tw:mt-0 tw:mb-3 tw:flex tw:items-center tw:gap-2 tw:text-sm tw:font-semibold">
                <Users size={16} aria-hidden="true" />
                Assigned teams
              </h3>
              {activeTeams(appointment).length === 0 ? (
                <p className="tw:text-xs tw:text-[#65716a]">
                  Unassigned. Choose teams in the visit details.
                </p>
              ) : (
                <ul className="tw:m-0 tw:grid tw:list-none tw:gap-3 tw:p-0">
                  {activeTeams(appointment).map((team) => (
                    <li key={team.id} className={card}>
                      <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
                        <strong className="tw:text-sm tw:wrap-anywhere">
                          {team.crewName}
                          {team.crewActive ? '' : ' (inactive)'}
                        </strong>
                        <Badge variant="outline">
                          {executionStatusLabel(team.execution.status)}
                        </Badge>
                      </div>
                      <dl className="tw:mb-0 tw:grid tw:grid-cols-2 tw:gap-x-3 tw:gap-y-3 tw:text-xs">
                        {[
                          ['Departed', team.execution.departedAt],
                          ['Actual start', team.execution.actualStartAt],
                          ['Actual end', team.execution.actualEndAt],
                          ['Estimated finish', team.execution.estimatedFinishAt],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt className="tw:mb-1 tw:text-[10px] tw:text-[#65716a]">{label}</dt>
                            <dd className="tw:m-0 tw:leading-relaxed">
                              {formatWorkTime(value ?? null)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <p className="tw:mb-0 tw:flex tw:items-center tw:gap-1.5 tw:text-[11px] tw:text-[#65716a]">
                        <Clock size={13} aria-hidden="true" />
                        Travel buffer: {team.travelBufferMinutes} min after plan
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {appointment.needsAttention && (
              <section className="tw:rounded-xl tw:border tw:border-solid tw:border-[#ead8c6] tw:bg-[#fff7e9] tw:p-4">
                <h3 className="tw:mt-0 tw:text-sm">Schedule attention</h3>
                <ul className="tw:mb-0 tw:pl-4 tw:text-xs tw:leading-relaxed">
                  {appointment.attention.map((issue, index) => (
                    <li key={index}>{issue.message}</li>
                  ))}
                </ul>
              </section>
            )}
            {appointment.notes && (
              <section className={card}>
                <h3 className="tw:mt-0 tw:text-sm">Visit notes</h3>
                <p className="tw:mb-0 tw:text-xs tw:leading-relaxed tw:whitespace-pre-wrap tw:wrap-anywhere">
                  {appointment.notes}
                </p>
              </section>
            )}
            <p className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:text-[#65716a]">
              <MapPin size={14} aria-hidden="true" />
              Open the full visit for address, tasks and actions.
            </p>
            <div className="tw:sticky tw:bottom-0 tw:mt-auto tw:grid tw:gap-2 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e0e6d9] tw:bg-[#fffefa] tw:pt-4">
              <Link
                href={appointmentHref(appointment)}
                className={buttonVariants({ className: 'tw:w-full tw:gap-2' })}
              >
                Open full visit <ExternalLink aria-hidden="true" size={15} />
              </Link>
              <Link
                href={`/backoffice/orders/${appointment.orderId}`}
                className={buttonVariants({ variant: 'outline', className: 'tw:w-full' })}
              >
                Open order {appointment.orderNumber}
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
