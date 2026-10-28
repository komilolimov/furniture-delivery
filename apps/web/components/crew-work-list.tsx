'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CrewAssignmentListResponse, CrewWorkView } from '@furniture-delivery/contracts';
import {
  ArrowRight,
  CalendarCheck2,
  CalendarDays,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ClipboardList,
  MapPin,
  RefreshCw,
  Route,
  Truck,
  UsersRound,
  Wrench,
} from 'lucide-react';
import { isCrewAssignmentListResponse } from '../lib/execution-guards';
import { formatWorkTime } from '../lib/execution-labels';
import { useOrderResource } from '../lib/use-order-resource';
import {
  CrewConfirmationBadge,
  CrewExecutionBadge,
  CrewExecutionIcon,
} from './crew-work-presentation';
import { Badge } from './ui/badge';
import { Button, buttonVariants } from './ui/button';
import { NativeSelect } from './ui/native-select';
import './crew-workspace.css';

const views = {
  today: {
    label: 'Today',
    icon: CalendarDays,
    title: "Today's visits",
    description: 'Your planned visits for today, with the latest saved team status.',
  },
  upcoming: {
    label: 'Upcoming',
    icon: CalendarCheck2,
    title: 'Coming up next',
    description:
      'Future visits assigned to your team. Open a visit to review the work and access details.',
  },
  open: {
    label: 'Open',
    icon: ClipboardList,
    title: 'Work to follow up',
    description: 'Unfinished visits and partial or blocked outcomes that still need attention.',
  },
  completed: {
    label: 'Completed',
    icon: CheckCheck,
    title: 'Your saved results',
    description: 'Completed team visits. Final review of the whole order is a separate step.',
  },
};
export function CrewWorkList() {
  const [view, setView] = useState<CrewWorkView>('today');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const resource = useOrderResource<CrewAssignmentListResponse>(
    `/crew/assignments?view=${view}&page=${page}&pageSize=${pageSize}`,
    isCrewAssignmentListResponse,
    { retainDataOnRefresh: true },
  );
  const data = resource.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const ViewIcon = views[view].icon;
  return (
    <div className="crew-workspace-theme tw:grid tw:min-w-0 tw:gap-5 tw:text-[#18372e]">
      <header className="tw:flex tw:flex-wrap tw:items-end tw:justify-between tw:gap-4">
        <div className="tw:min-w-0">
          <p className="tw:mt-0 tw:mb-2.5 tw:flex tw:items-center tw:gap-2 tw:text-[10px] tw:font-bold tw:tracking-[1.6px] tw:text-[#60804f] tw:uppercase">
            <UsersRound size={14} aria-hidden="true" />
            Team workspace · Europe/Rome
          </p>
          <h1 className="tw:m-0 tw:text-[36px] tw:leading-[1.15] tw:font-medium tw:tracking-[-1.2px] tw:max-[600px]:text-[30px]">
            My team's work
          </h1>
          <p className="tw:mt-3 tw:mb-0 tw:max-w-[560px] tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
            Everything you need for your next visit, one step at a time.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={resource.pending}
          onClick={() => void resource.refresh()}
        >
          <RefreshCw aria-hidden="true" />
          Refresh work
        </Button>
      </header>
      <nav
        aria-label="Work views"
        className="tw:grid tw:grid-cols-4 tw:gap-1.5 tw:rounded-2xl tw:border tw:border-solid tw:border-[#dfe6d8] tw:bg-white tw:p-1.5"
      >
        {(['today', 'upcoming', 'open', 'completed'] as const).map((tab) => {
          const Icon = views[tab].icon;
          return (
            <Button
              key={tab}
              variant={view === tab ? 'default' : 'ghost'}
              className="tw:min-w-0 tw:flex-col tw:gap-1.5 tw:px-1 tw:py-3 tw:text-[11px] tw:sm:flex-row tw:sm:gap-2 tw:sm:px-3"
              aria-pressed={view === tab}
              onClick={() => {
                setView(tab);
                setPage(1);
              }}
            >
              <Icon aria-hidden="true" />
              {views[tab].label}
            </Button>
          );
        })}
      </nav>
      <section
        aria-label="Current work view"
        className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-4 tw:rounded-2xl tw:border tw:border-solid tw:border-[#dce5d1] tw:bg-[#eef4e6] tw:p-5"
      >
        <div className="tw:flex tw:min-w-0 tw:flex-1 tw:items-start tw:gap-3">
          <span className="tw:flex tw:size-11 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-xl tw:border tw:border-solid tw:border-[#d4e0c7] tw:bg-[#f9fcf4] tw:text-[#64834d]">
            <ViewIcon size={21} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="tw:min-w-0">
            <h2 className="tw:m-0 tw:text-base tw:font-semibold">{views[view].title}</h2>
            <p className="tw:mt-2 tw:mb-0 tw:max-w-[620px] tw:text-xs tw:leading-relaxed tw:text-[#65765c]">
              {views[view].description}
            </p>
          </div>
        </div>
        {data && (
          <Badge
            variant="outline"
            className="tw:border-[#cfddbf] tw:bg-[#f9fcf4] tw:px-3 tw:py-2 tw:text-[11px]"
          >
            {data.total} {data.total === 1 ? 'visit' : 'visits'} in this view
          </Badge>
        )}
      </section>
      <p className="tw:m-0 tw:text-[11px] tw:leading-relaxed tw:text-[#73816b]">
        Today follows the planned date in Europe/Rome{data ? ` (${data.businessDate})` : ''}. Open
        includes unfinished visits and partial or blocked attempts awaiting review.
      </p>
      {resource.pending && (
        <p role="status" className="tw:m-0 tw:text-xs tw:text-[#65716a]">
          {data ? 'Refreshing saved work…' : 'Loading assignments…'}
        </p>
      )}
      {!resource.pending && resource.error && (
        <div className="tw:grid tw:justify-items-start tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#ead7cf] tw:bg-[#fcf3ee] tw:p-4">
          <p role="alert" className="tw:m-0 tw:text-sm tw:leading-relaxed tw:text-[#97372a]">
            {resource.error}
          </p>
          <Button variant="outline" onClick={() => void resource.refresh()}>
            Retry
          </Button>
        </div>
      )}
      {data && (
        <>
          {data.assignments.length === 0 ? (
            <section className="tw:grid tw:justify-items-center tw:gap-3 tw:rounded-2xl tw:border tw:border-solid tw:border-[#e0e7d9] tw:bg-white tw:px-6 tw:py-12 tw:text-center">
              <span className="tw:flex tw:size-14 tw:items-center tw:justify-center tw:rounded-2xl tw:bg-[#f0f5e9] tw:text-[#6e8a5a]">
                <CalendarDays size={27} aria-hidden="true" />
              </span>
              <h3 className="tw:m-0 tw:text-lg tw:font-medium">No assignments in this view</h3>
              <p className="tw:m-0 tw:max-w-[320px] tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
                Try another view or contact your dispatcher.
              </p>
            </section>
          ) : (
            <div className="tw:grid tw:min-w-0 tw:gap-4 tw:md:grid-cols-2">
              {data.assignments.map((a) => {
                const ServiceIcon = a.serviceType === 'DELIVERY_ONLY' ? Truck : Wrench;
                return (
                  <article
                    key={a.id}
                    className="tw:flex tw:min-w-0 tw:flex-col tw:gap-4 tw:overflow-hidden tw:rounded-2xl tw:border tw:border-solid tw:border-[#dce5d4] tw:bg-white tw:p-5 tw:shadow-[0_3px_16px_#18372e04]"
                  >
                    <div className="tw:flex tw:min-w-0 tw:items-start tw:justify-between tw:gap-3">
                      <div className="tw:min-w-0">
                        <p className="tw:mt-0 tw:mb-2 tw:text-[10px] tw:font-bold tw:tracking-[1.2px] tw:text-[#748568] tw:uppercase">
                          {a.orderNumber}
                        </p>
                        <h3 className="tw:m-0 tw:text-xl tw:leading-snug tw:font-medium tw:tracking-[-0.4px] tw:wrap-anywhere">
                          <Link
                            className="tw:text-[#18372e] tw:no-underline tw:hover:text-[#52754b]"
                            href={`/crew/assignments/${a.id}`}
                          >
                            {a.customerName}
                          </Link>
                        </h3>
                        <p className="tw:mt-2 tw:mb-0 tw:flex tw:items-start tw:gap-1.5 tw:text-xs tw:leading-relaxed tw:text-[#71806a]">
                          <MapPin size={14} className="tw:mt-0.5 tw:shrink-0" aria-hidden="true" />
                          {a.city || 'City not provided'}
                        </p>
                      </div>
                      <span className="tw:flex tw:size-11 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-xl tw:bg-[#f2f5ec] tw:text-[#6c8658]">
                        <CrewExecutionIcon status={a.execution.status} className="tw:size-5" />
                      </span>
                    </div>
                    <div className="tw:flex tw:flex-wrap tw:gap-2">
                      <CrewExecutionBadge status={a.execution.status} />
                      <CrewConfirmationBadge status={a.confirmationStatus} />
                    </div>
                    <div className="tw:grid tw:min-w-0 tw:gap-2 tw:rounded-xl tw:border tw:border-solid tw:border-[#e3e9dc] tw:bg-[#f7f9f3] tw:p-3.5">
                      <p className="tw:m-0 tw:flex tw:items-center tw:gap-1.5 tw:text-[10px] tw:font-semibold tw:tracking-wide tw:text-[#758369] tw:uppercase">
                        <Clock3 size={13} aria-hidden="true" />
                        Planned visit · Europe/Rome
                      </p>
                      <p className="tw:m-0 tw:text-xs tw:leading-relaxed tw:font-medium tw:tabular-nums tw:wrap-anywhere">
                        {formatWorkTime(a.plannedStartAt)} → {formatWorkTime(a.plannedEndAt)}
                      </p>
                    </div>
                    <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-2 tw:text-[11px] tw:leading-relaxed tw:text-[#71806a]">
                      <span className="tw:inline-flex tw:items-center tw:gap-1.5">
                        <ServiceIcon size={14} aria-hidden="true" />
                        {a.serviceType === 'DELIVERY_ONLY' ? 'Delivery' : 'Delivery and assembly'}
                      </span>
                      <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:wrap-anywhere">
                        <UsersRound size={14} className="tw:shrink-0" aria-hidden="true" />
                        {a.crewName}
                      </span>
                    </div>
                    {a.execution.maybeDelayed && (
                      <p className="tw:m-0 tw:flex tw:items-start tw:gap-2 tw:rounded-xl tw:border tw:border-solid tw:border-[#ecdec1] tw:bg-[#fcf5e5] tw:p-3 tw:text-[11px] tw:leading-relaxed tw:text-[#966d32]">
                        <CircleAlert
                          size={15}
                          className="tw:mt-0.5 tw:shrink-0"
                          aria-hidden="true"
                        />
                        <span>
                          Possibly delayed: no finish recorded. The planned time is unchanged.
                        </span>
                      </p>
                    )}
                    <Link
                      className={buttonVariants({
                        className:
                          'tw:mt-auto tw:min-h-12 tw:w-full tw:justify-between tw:px-4 tw:py-3 tw:text-xs',
                      })}
                      href={`/crew/assignments/${a.id}`}
                    >
                      <span>Open my team's visit</span>
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </article>
                );
              })}
            </div>
          )}
          <footer className="tw:grid tw:gap-4 tw:rounded-2xl tw:border tw:border-solid tw:border-[#e0e7d9] tw:bg-white tw:p-4">
            <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
              <p className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
                {data.total} assignments · Page {data.page} of {pages}
              </p>
              <label className="tw:flex tw:items-center tw:gap-2 tw:text-[11px] tw:text-[#71806a]">
                Assignments per page
                <NativeSelect
                  className="tw:w-20"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </NativeSelect>
              </label>
            </div>
            <nav aria-label="Work pagination" className="tw:grid tw:grid-cols-2 tw:gap-3">
              <Button
                variant="outline"
                disabled={resource.pending || page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft aria-hidden="true" />
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={resource.pending || page * pageSize >= data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight aria-hidden="true" />
              </Button>
            </nav>
          </footer>
        </>
      )}
      <p className="tw:m-0 tw:flex tw:items-start tw:gap-2 tw:text-[11px] tw:leading-relaxed tw:text-[#7a886e]">
        <Route size={15} className="tw:mt-0.5 tw:shrink-0" aria-hidden="true" />
        Each visit belongs to your team. Completing your part keeps other teams and the final order
        review separate.
      </p>
    </div>
  );
}
