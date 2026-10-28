'use client';

import type {
  AppointmentDetail,
  CalendarResponse,
  CrewListResponse,
} from '@furniture-delivery/contracts';
import Link from 'next/link';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react';
import { businessToday, displayRome } from '../lib/business-time';
import { isCrewListResponse } from '../lib/contracts-guards';
import { isCalendarResponse } from '../lib/planning-guards';
import { useApiResource } from '../lib/use-api-resource';
import { useOrderResource } from '../lib/use-order-resource';
import { useRealtimeCoordinator } from '../lib/realtime-context';
import {
  activeTeams,
  isPlanningDate,
  planningRange,
  planningRangeLabel,
  planningTeamColor,
  rangeTime,
  shiftPlanningDate,
  teamNames,
  type PlanningView,
} from '../lib/planning-calendar-model';
import { orderProgressLabel } from '../lib/execution-labels';
import { ResourceNotice } from './form-parts';
import { appointmentHref } from './order-appointments';
import { PlanningCalendar } from './planning-calendar';
import {
  PlanningFilters,
  initialPlanningFilters,
  type PlanningFilterValue,
} from './planning-filters';
import { PlanningMiniMonth } from './planning-mini-month';
import { PlanningVisitPreview } from './planning-visit-preview';
import { RiskPanel } from './risk-panel';
import { Badge } from './ui/badge';
import { Button, buttonVariants } from './ui/button';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { SelectField } from './ui/select';
import { cn } from '../lib/utils';
import './planning.css';
import './orders-detail.css';
import './planning-workspace.css';

export { planningTeamColor } from '../lib/planning-calendar-model';
const EMPTY_VISITS: AppointmentDetail[] = [];
const EMPTY_CREWS: CrewListResponse['crews'] = [];
const views: ReadonlyArray<{ value: PlanningView; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'list', label: 'List' },
];
// Search input state belongs here so typing never rerenders the calendar or calls the API.
const RangeSearch = memo(function RangeSearch({
  value,
  onApply,
}: Readonly<{ value: string; onApply: (value: string) => void }>) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <form
      role="search"
      aria-label="Search current planning range"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(draft.trim());
      }}
      className="tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-2"
    >
      <div className="tw:relative tw:min-w-0 tw:flex-1">
        <Search
          aria-hidden="true"
          className="tw:pointer-events-none tw:absolute tw:top-3.5 tw:left-3 tw:size-4 tw:text-[#75856b]"
        />
        <Input
          aria-label="Search this range"
          placeholder="Search visits, customers, city or team…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="tw:pl-9 tw:pr-10"
          maxLength={200}
        />
        {draft && (
          <button
            type="button"
            aria-label="Clear visit search"
            className="tw:absolute tw:top-1 tw:right-1 tw:grid tw:size-9 tw:cursor-pointer tw:place-items-center tw:rounded-md tw:border-0 tw:bg-transparent tw:text-[#75856b] tw:hover:bg-[#edf3e8] tw:focus-visible:outline-2 tw:focus-visible:outline-[#739b74]"
            onClick={() => {
              setDraft('');
              onApply('');
            }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <Button type="submit" variant="outline" size="sm">
        Search
      </Button>
    </form>
  );
});

const CompleteVisitList = memo(function CompleteVisitList({
  visits,
  onSelect,
}: Readonly<{ visits: AppointmentDetail[]; onSelect: (id: string) => void }>) {
  const [expanded, setExpanded] = useState(false);
  const sorted = useMemo(
    () =>
      expanded
        ? [...visits].sort(
            (a, b) => a.plannedStartAt.localeCompare(b.plannedStartAt) || a.id.localeCompare(b.id),
          )
        : EMPTY_VISITS,
    [visits, expanded],
  );
  return (
    <details
      className="planning-complete-list"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="tw:flex tw:min-h-12 tw:cursor-pointer tw:items-center tw:gap-2 tw:px-5 tw:py-3 tw:text-xs tw:font-semibold">
        Complete visit list ({visits.length})
        <ChevronDown
          className="planning-complete-list-chevron tw:ml-auto tw:size-4 tw:shrink-0"
          aria-hidden="true"
        />
      </summary>
      {expanded && (
        <ul className="tw:m-0 tw:grid tw:list-none tw:gap-0 tw:p-0">
          {sorted.map((visit) => (
            <li
              key={visit.id}
              className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e6ebdf] tw:px-5 tw:py-4"
            >
              <button
                type="button"
                className="tw:min-w-0 tw:flex-1 tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-[#18372e] tw:focus-visible:outline-2 tw:focus-visible:outline-[#739b74] tw:focus-visible:outline-offset-4"
                onClick={() => onSelect(visit.id)}
              >
                <strong className="tw:block tw:text-xs tw:font-semibold tw:wrap-anywhere">
                  {visit.orderNumber} · {visit.customerName}
                </strong>
                <span className="tw:mt-1 tw:block tw:text-[11px] tw:leading-relaxed tw:text-[#65716a]">
                  {displayRome(visit.plannedStartAt)} · {rangeTime(visit)} · {visit.city}
                </span>
                <span className="tw:mt-1 tw:block tw:text-[11px] tw:leading-relaxed tw:text-[#65716a]">
                  {teamNames(visit)}
                </span>
              </button>
              <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                <Badge variant="outline">{orderProgressLabel(visit.execution.orderProgress)}</Badge>
                {visit.needsAttention && <Badge variant="warning">Needs attention</Badge>}
                <Link
                  className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                  href={appointmentHref(visit)}
                >
                  Open visit
                </Link>
              </div>
            </li>
          ))}
          {visits.length === 0 && (
            <li className="tw:p-5 tw:text-xs tw:text-[#65716a]">No matching visits.</li>
          )}
        </ul>
      )}
    </details>
  );
});

const CalendarWorkspace = memo(function CalendarWorkspace({
  path,
  date,
  view,
  filters,
  search,
  slotMinutes,
  weekends,
  refreshSignal,
  onChooseDay,
}: Readonly<{
  path: string;
  date: string;
  view: PlanningView;
  filters: PlanningFilterValue;
  search: string;
  slotMinutes: 15 | 30 | 60;
  weekends: boolean;
  refreshSignal: number;
  onChooseDay: (date: string) => void;
}>) {
  const live = useRealtimeCoordinator();
  const resource = useOrderResource<CalendarResponse>(path, isCalendarResponse, {
    retainDataOnRefresh: true,
  });
  const { refresh } = resource;
  const previousRefresh = useRef(refreshSignal);
  useEffect(() => {
    if (previousRefresh.current !== refreshSignal) {
      previousRefresh.current = refreshSignal;
      void refresh();
    }
  }, [refreshSignal, refresh]);
  useEffect(() => {
    if (live) return;
    const handler = () => {
      void refresh();
    };
    window.addEventListener('fd:planning-changed', handler);
    return () => window.removeEventListener('fd:planning-changed', handler);
  }, [live, refresh]);
  const appointments = resource.data?.appointments ?? EMPTY_VISITS;
  const visible = useMemo(() => {
    const text = search.toLocaleLowerCase('en-GB');
    if (
      !text &&
      filters.confirmation === 'all' &&
      filters.attention === 'all' &&
      !filters.serviceType &&
      !filters.progress
    )
      return appointments;
    return appointments.filter(
      (visit) =>
        (filters.confirmation === 'all' || visit.confirmationStatus === filters.confirmation) &&
        (filters.attention === 'all' ||
          visit.needsAttention === (filters.attention === 'attention')) &&
        (!filters.serviceType || visit.serviceType === filters.serviceType) &&
        (!filters.progress || visit.execution.orderProgress === filters.progress) &&
        (!text ||
          [visit.orderNumber, visit.customerName, visit.city, teamNames(visit)]
            .join(' ')
            .toLocaleLowerCase('en-GB')
            .includes(text)),
    );
  }, [
    appointments,
    filters.confirmation,
    filters.attention,
    filters.serviceType,
    filters.progress,
    search,
  ]);
  const stats = useMemo(
    () => ({
      awaiting: appointments.filter((visit) => visit.confirmationStatus !== 'CONFIRMED').length,
      attention: appointments.filter((visit) => visit.needsAttention).length,
      teams: new Set(appointments.flatMap((visit) => activeTeams(visit).map((team) => team.crewId)))
        .size,
    }),
    [appointments],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const selectVisit = useCallback((id: string) => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedId(id);
  }, []);
  const closeVisit = useCallback(() => setSelectedId(null), []);
  useEffect(() => setSelectedId(null), [path]);
  const selected = appointments.find((visit) => visit.id === selectedId) ?? null;
  return (
    <>
      <div
        className="tw:grid tw:grid-cols-4 tw:gap-3 tw:max-[650px]:grid-cols-2"
        aria-label="Selected range summary"
      >
        {[
          [CalendarDays, 'Visits in range', appointments.length],
          [CheckCheck, 'Awaiting confirmation', stats.awaiting],
          [TriangleAlert, 'Need attention', stats.attention],
          [Users, 'Assigned teams', stats.teams],
        ].map(([Icon, label, value]) => {
          const MetricIcon = Icon as typeof CalendarDays;
          return (
            <div
              key={String(label)}
              className="tw:flex tw:min-w-0 tw:items-start tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#e0e6d9] tw:bg-[#fffefa] tw:p-4"
            >
              <MetricIcon
                aria-hidden="true"
                className="tw:mt-0.5 tw:size-4 tw:shrink-0 tw:text-[#69835e]"
              />
              <div className="tw:min-w-0">
                <span className="tw:block tw:text-[10px] tw:leading-relaxed tw:text-[#73816b]">
                  {String(label)}
                </span>
                <strong className="tw:mt-1 tw:block tw:text-xl tw:font-medium tw:tabular-nums">
                  {resource.data ? String(value) : '—'}
                </strong>
              </div>
            </div>
          );
        })}
      </div>
      <section
        className="tw:min-w-0 tw:overflow-hidden tw:rounded-2xl tw:border tw:border-solid tw:border-[#dde5d6] tw:bg-[#fffefa]"
        aria-label="Visit calendar workspace"
        aria-busy={resource.pending}
      >
        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-x-0 tw:border-t-0 tw:border-b tw:border-solid tw:border-[#e6ebdf] tw:px-5 tw:py-3">
          <span className="tw:text-[11px] tw:leading-relaxed tw:text-[#65716a]" role="status">
            {resource.data
              ? `Showing ${visible.length} of ${appointments.length} visits in the complete selected range`
              : resource.error
                ? 'Selected range unavailable'
                : 'Loading selected range…'}{' '}
            · Europe/Rome
          </span>
          <span className="tw:flex tw:items-center tw:gap-1.5 tw:text-[10px] tw:text-[#7b8872]">
            <span className="tw:size-1.5 tw:rounded-full tw:bg-[#7da56a]" />
            {resource.pending && resource.data ? 'Updating…' : 'Planned customer windows'}
          </span>
        </div>
        {((resource.pending && !resource.data) || resource.error) && (
          <div className="tw:px-5 tw:pt-3">
            <ResourceNotice
              pending={resource.pending && !resource.data}
              error={resource.error}
              retry={() => void refresh()}
            />
          </div>
        )}
        {resource.data && visible.length === 0 && (
          <div className="tw:px-5 tw:py-7">
            <h2 className="tw:mt-0 tw:mb-2 tw:text-base tw:font-semibold">
              {appointments.length === 0 ? 'No visits in this range' : 'No matching visits'}
            </h2>
            <p className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
              {appointments.length === 0
                ? 'Change the date or team filters, or create a visit from its order.'
                : 'Clear the search or adjust the filters for this range.'}
            </p>
          </div>
        )}
        <PlanningCalendar
          date={date}
          view={view}
          appointments={visible}
          onSelect={selectVisit}
          onDateSelect={onChooseDay}
          slotMinutes={slotMinutes}
          weekends={weekends}
        />
        <CompleteVisitList visits={visible} onSelect={selectVisit} />
      </section>
      <PlanningVisitPreview
        appointment={selected}
        onClose={closeVisit}
        returnFocus={returnFocus.current}
      />
    </>
  );
});

export function PlanningBoard() {
  const crews = useApiResource<CrewListResponse>('/crews', isCrewListResponse);
  const [date, setDate] = useState(businessToday);
  const [followToday, setFollowToday] = useState(true);
  const [view, setView] = useState<PlanningView>('week');
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState<PlanningFilterValue>(initialPlanningFilters);
  const [search, setSearch] = useState('');
  const [slotMinutes, setSlotMinutes] = useState<15 | 30 | 60>(30);
  const [weekends, setWeekends] = useState(true);
  const [reload, setReload] = useState(0);
  const changeDate = useCallback(
    (value: string) => {
      if (!isPlanningDate(value, view)) return;
      setFollowToday(false);
      setDate(value);
    },
    [view],
  );
  useEffect(() => {
    const syncDate = () => {
      if (followToday) setDate(businessToday());
    };
    window.addEventListener('fd:clock-sync', syncDate);
    return () => window.removeEventListener('fd:clock-sync', syncDate);
  }, [followToday]);
  useEffect(() => {
    setView(
      (
        typeof window.matchMedia === 'function'
          ? window.matchMedia('(max-width: 600px)').matches
          : window.innerWidth <= 600
      )
        ? 'list'
        : 'week',
    );
    setReady(true);
  }, []);
  const chooseDay = useCallback((value: string) => {
    if (!isPlanningDate(value, 'day')) return;
    setFollowToday(false);
    setDate(value);
    setView('day');
  }, []);
  const range = useMemo(() => planningRange(date, view), [date, view]);
  const crewKey = filters.allTeams ? '' : [...new Set(filters.crewIds)].sort().join(',');
  const sortedCrewIds = useMemo(() => (crewKey ? crewKey.split(',') : []), [crewKey]);
  const query = useMemo(
    () =>
      new URLSearchParams({
        from: range.from,
        to: range.to,
        allTeams: String(filters.allTeams),
        crewIds: filters.allTeams ? '' : sortedCrewIds.join(','),
        includeUnassigned: String(filters.includeUnassigned),
      }).toString(),
    [range.from, range.to, filters.allTeams, filters.includeUnassigned, sortedCrewIds],
  );
  const riskQuery = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      allTeams: filters.allTeams,
      crewIds: filters.allTeams ? [] : sortedCrewIds,
    }),
    [range.from, range.to, filters.allTeams, sortedCrewIds],
  );
  const refreshSchedule = useCallback(() => {
    setReload((value) => value + 1);
    void crews.refresh();
  }, [crews.refresh]);
  const goToday = useCallback(() => {
    setFollowToday(true);
    setDate(businessToday());
  }, []);
  const crewData = crews.data?.crews ?? EMPTY_CREWS;
  return (
    <div className="planning-shell orders-detail-theme tw:grid tw:min-w-0 tw:gap-6 tw:text-[#18372e]">
      <header className="tw:flex tw:flex-wrap tw:items-end tw:justify-between tw:gap-4">
        <div>
          <p className="tw:mt-0 tw:mb-3 tw:text-[10px] tw:font-bold tw:tracking-[1.8px] tw:text-[#226347] tw:uppercase">
            Delivery operations
          </p>
          <h1 className="tw:m-0 tw:text-[38px] tw:leading-tight tw:font-medium tw:tracking-[-1.2px] tw:max-[600px]:text-[32px]">
            Planning
          </h1>
          <p className="tw:mt-3 tw:mb-0 tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
            A clear view of every visit, team and next step.
          </p>
        </div>
        <div className="tw:flex tw:flex-wrap tw:gap-2">
          <Button variant="outline" onClick={refreshSchedule}>
            <RefreshCw aria-hidden="true" />
            Refresh schedule
          </Button>
          <Link className={buttonVariants()} href="/backoffice/orders">
            <Plus aria-hidden="true" />
            Create visit for an order
          </Link>
        </div>
      </header>
      <div className="planning-workspace-layout">
        <aside className="planning-sidebar">
          <PlanningMiniMonth date={date} onSelect={changeDate} />
          <div className="tw:my-5 tw:h-px tw:bg-[#e4eadc]" />
          <h2 className="tw:mt-0 tw:mb-3 tw:text-[10px] tw:font-bold tw:tracking-widest tw:text-[#7a8770] tw:uppercase">
            Team colours
          </h2>
          <ul className="tw:m-0 tw:grid tw:list-none tw:gap-3 tw:p-0">
            {crewData.map((crew) => (
              <li
                key={crew.id}
                className={cn(
                  'tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:text-[11px] tw:leading-relaxed',
                  !filters.allTeams && !filters.crewIds.includes(crew.id) && 'tw:opacity-40',
                )}
              >
                <span
                  aria-hidden="true"
                  className="tw:size-2.5 tw:shrink-0 tw:rounded-full"
                  style={{ backgroundColor: planningTeamColor(crew.id) }}
                />
                <span className="tw:min-w-0 tw:wrap-anywhere">
                  {crew.name}
                  {crew.active ? '' : ' (inactive)'}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/backoffice/crews"
            className="tw:mt-4 tw:block tw:text-[11px] tw:font-semibold tw:text-[#426b40] tw:underline-offset-4 tw:hover:underline"
          >
            Manage team availability →
          </Link>
          <div className="tw:mt-6 tw:rounded-xl tw:bg-[#edf3e6] tw:p-4">
            <p className="tw:m-0 tw:text-[11px] tw:leading-relaxed tw:text-[#65775d]">
              Times use <strong>Europe/Rome</strong>. Event colour identifies the first team;
              multi-team visits appear once. Open a visit for all teams and reserved buffers.
            </p>
          </div>
        </aside>
        <section
          className="tw:grid tw:min-w-0 tw:content-start tw:gap-4"
          aria-label="Planning workspace"
        >
          <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
            <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2">
              <Button variant="outline" size="sm" onClick={goToday}>
                Today
              </Button>
              <div className="tw:flex tw:gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Previous period"
                  onClick={() => changeDate(shiftPlanningDate(date, view, -1))}
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Next period"
                  onClick={() => changeDate(shiftPlanningDate(date, view, 1))}
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
              <h2 className="tw:m-0 tw:text-xl tw:font-medium tw:tracking-[-0.5px] tw:max-[600px]:text-lg">
                {planningRangeLabel(date, view)}
              </h2>
            </div>
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
              <div
                className="tw:flex tw:gap-0.5 tw:rounded-lg tw:border tw:border-solid tw:border-[#dce4d5] tw:bg-[#edf2e8] tw:p-1"
                role="group"
                aria-label="Planning view"
              >
                {views.map((item) => (
                  <Button
                    key={item.value}
                    variant="ghost"
                    size="sm"
                    aria-pressed={view === item.value}
                    disabled={!isPlanningDate(date, item.value)}
                    onClick={() => setView(item.value)}
                    className={cn(
                      'tw:min-h-9 tw:px-3',
                      view === item.value && 'tw:bg-white tw:text-[#21533b] tw:shadow-sm',
                    )}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Calendar display settings">
                    <Settings2 aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  aria-label="Calendar display settings"
                  className="tw:w-[min(300px,calc(100vw_-_32px))]"
                >
                  <h3 className="tw:mt-0 tw:mb-4 tw:text-sm">Calendar display</h3>
                  <label className="tw:mb-2 tw:block tw:text-xs" id="calendar-grid-label">
                    Time grid
                  </label>
                  <SelectField
                    label="Time grid interval"
                    value={String(slotMinutes)}
                    onValueChange={(value) => setSlotMinutes(Number(value) as 15 | 30 | 60)}
                    options={[
                      { value: '15', label: '15 minutes' },
                      { value: '30', label: '30 minutes' },
                      { value: '60', label: '60 minutes' },
                    ]}
                  />
                  <label className="tw:mt-4 tw:flex tw:min-h-11 tw:cursor-pointer tw:items-center tw:gap-3 tw:text-xs">
                    <input
                      type="checkbox"
                      checked={weekends}
                      onChange={(event) => setWeekends(event.target.checked)}
                      className="tw:size-4 tw:accent-[#28543b]"
                    />
                    Show weekends
                  </label>
                  <p className="tw:mb-0 tw:text-[11px] tw:leading-relaxed tw:text-[#73816b]">
                    Display only. Hidden weekend visits remain in the complete list and totals. The
                    full 24-hour day stays available.
                  </p>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <div className="tw:flex tw:flex-wrap tw:items-start tw:gap-2">
            <RangeSearch value={search} onApply={setSearch} />
            <label className="tw:flex tw:min-h-11 tw:items-center tw:gap-2 tw:rounded-lg tw:border tw:border-solid tw:border-[#d5dfd0] tw:bg-white tw:px-3">
              <CalendarDays aria-hidden="true" className="tw:size-4 tw:text-[#6d8065]" />
              <span className="tw:sr-only">Planning date</span>
              <input
                aria-label="Planning date"
                type="date"
                required
                min="1900-01-01"
                max="9999-12-31"
                value={date}
                onInput={(event) => changeDate(event.currentTarget.value)}
                onChange={(event) => changeDate(event.currentTarget.value)}
                className="planning-date-input tw:min-h-10 tw:border-0 tw:p-0 tw:text-[11px]"
              />
            </label>
          </div>
          <PlanningFilters
            value={filters}
            onApply={setFilters}
            crews={crewData}
            pending={crews.pending}
            error={crews.error}
            onRetry={crews.refresh}
          />
          {search && (
            <p className="tw:m-0 tw:text-[11px] tw:leading-relaxed tw:text-[#65716a]">
              Search “{search}” and status filters apply to this complete selected range. Team and
              unassigned filters are checked by the server.
            </p>
          )}
          {ready ? (
            <CalendarWorkspace
              path={`/planning/calendar?${query}`}
              date={date}
              view={view}
              filters={filters}
              search={search}
              slotMinutes={slotMinutes}
              weekends={weekends}
              refreshSignal={reload}
              onChooseDay={chooseDay}
            />
          ) : (
            <p role="status">Loading calendar…</p>
          )}
          {ready && (filters.allTeams || filters.crewIds.length > 0) && (
            <RiskPanel query={riskQuery} refreshSignal={reload} />
          )}
        </section>
      </div>
    </div>
  );
}
