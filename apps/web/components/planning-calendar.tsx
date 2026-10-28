'use client';

import type { AppointmentDetail } from '@furniture-delivery/contracts';
import FullCalendar from '@fullcalendar/react';
import type {
  CalendarRef,
  DayHeaderInfo,
  EventClickInfo,
  EventDisplayInfo,
  MountInfo,
  DayCellInfo,
  SlotLaneInfo,
} from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import listPlugin from '@fullcalendar/react/list';
import themePlugin from '@fullcalendar/react/themes/monarch';
import { Check, CircleAlert } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { BUSINESS_ZONE, utcToRomeLocalInput } from '../lib/business-time';
import { orderProgressLabel } from '../lib/execution-labels';
import {
  activeTeams,
  planningEvents,
  planningRange,
  rangeTime,
  teamNames,
  type PlanningView,
} from '../lib/planning-calendar-model';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/monarch/theme.css';
import '@fullcalendar/react/themes/monarch/palettes/green.css';
import './calendar.css';

export type { PlanningView } from '../lib/planning-calendar-model';
const CalendarFrame = memo(FullCalendar);
const plugins = [themePlugin, timeGridPlugin, dayGridPlugin, listPlugin];
const views = {
  day: 'timeGridDay',
  week: 'timeGridWeek',
  month: 'dayGridMonth',
  list: 'listWeek',
} as const;
const eventTimeFormat = { hour: '2-digit', minute: '2-digit', hour12: false } as const;
const slotHeaderFormat = { hour: '2-digit', minute: '2-digit', hour12: false } as const;
const dayHeaderFormat = { weekday: 'short' } as const;
const slotDurations = { 15: '00:15:00', 30: '00:30:00', 60: '01:00:00' } as const;
const eventClass = (info: EventDisplayInfo) =>
  `planning-calendar-event${info.isShort ? ' is-short' : ''}`;
const dayCellClass = (info: DayCellInfo) =>
  `planning-calendar-day-cell${info.isToday ? ' is-today' : ''}${info.isOther ? ' is-other' : ''}`;
const slotLaneClass = (info: SlotLaneInfo) =>
  `planning-calendar-slot${info.isMinor ? ' is-minor' : ''}`;
const eventDidMount = ({ el, event }: MountInfo<EventDisplayInfo>) => {
  el.setAttribute('title', event.title);
  el.setAttribute('aria-label', event.title);
};
function dayHeaderContent(info: DayHeaderInfo) {
  return (
    <span className={`planning-calendar-day-label${info.isToday ? ' is-today' : ''}`}>
      <span>{info.weekdayText || info.text}</span>
      {info.view.type !== 'dayGridMonth' && <strong>{info.dayNumberText}</strong>}
    </span>
  );
}

/** Parent controls the selected period. Calendar instance and scroll survive filters/refetch. */
export const PlanningCalendar = memo(function PlanningCalendar({
  date,
  view,
  appointments,
  onSelect,
  onDateSelect,
  slotMinutes = 30,
  weekends = true,
}: Readonly<{
  date: string;
  view: PlanningView;
  appointments: readonly AppointmentDetail[];
  onSelect: (id: string) => void;
  onDateSelect?: (date: string) => void;
  slotMinutes?: 15 | 30 | 60;
  weekends?: boolean;
}>) {
  const calendarRef = useRef<CalendarRef>(null);
  const initial = useRef({ date, view });
  const navigation = useRef({ date, view });
  useEffect(() => {
    const previous = navigation.current;
    if (previous.date === date && previous.view === view) return;
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (previous.view !== view) {
      api.changeView(views[view], date);
    } else {
      const oldRange = planningRange(previous.date, previous.view);
      const newRange = planningRange(date, view);
      if (oldRange.from !== newRange.from || oldRange.to !== newRange.to) api.gotoDate(date);
    }
    navigation.current = { date, view };
  }, [date, view]);
  const byId = useMemo(
    () => new Map(appointments.map((appointment) => [appointment.id, appointment])),
    [appointments],
  );
  const events = useMemo(() => planningEvents(appointments), [appointments]);
  const eventClick = useCallback(
    (info: EventClickInfo) => {
      // Let normal modifiers keep the standard link/new-tab behaviour.
      if (
        info.jsEvent.metaKey ||
        info.jsEvent.ctrlKey ||
        info.jsEvent.shiftKey ||
        info.jsEvent.altKey
      )
        return;
      info.jsEvent.preventDefault();
      onSelect(info.event.id);
    },
    [onSelect],
  );
  const selectDay = useCallback(
    (selected: Date, event: UIEvent) => {
      event.preventDefault();
      onDateSelect?.(utcToRomeLocalInput(selected.toISOString()).slice(0, 10));
    },
    [onDateSelect],
  );
  const eventContent = useCallback(
    (info: EventDisplayInfo) => {
      const appointment = byId.get(info.event.id);
      if (!appointment) return <span>{info.event.title}</span>;
      const execution = appointment.execution;
      return (
        <div className="planning-event">
          <div className="planning-event__heading">
            <strong>{appointment.orderNumber}</strong>
            {appointment.confirmationStatus === 'CONFIRMED' ? (
              <Check aria-hidden="true" size={12} />
            ) : null}
            {appointment.needsAttention || execution.openIssueCount || execution.maybeDelayed ? (
              <CircleAlert aria-hidden="true" size={12} />
            ) : null}
          </div>
          <span className="planning-event__customer">{appointment.customerName}</span>
          <span className="planning-event__window">
            {rangeTime(appointment)} · {appointment.city}
          </span>
          <span className="planning-event__teams planning-event__secondary">
            {teamNames(appointment)}
          </span>
          <span className="planning-event__status planning-event__secondary">
            {orderProgressLabel(execution.orderProgress)} · {execution.completedCount} completed /{' '}
            {activeTeams(appointment).length} teams
            {execution.activeCount ? ` · ${execution.activeCount} active` : ''}
          </span>
          <span className="planning-event__status planning-event__secondary">
            {execution.openIssueCount} issues
            {execution.returnVisitRequired ? ' · Return required' : ''}
            {execution.maybeDelayed ? ' · Possibly delayed' : ''}
          </span>
          <span className="planning-event__status planning-event__secondary">
            {appointment.confirmationStatus === 'CONFIRMED' ? 'Confirmed' : 'Needs confirmation'}
            {appointment.needsAttention ? ' · Needs attention' : ''}
          </span>
        </div>
      );
    },
    [byId],
  );
  return (
    <div className="planning-calendar" data-view={view} aria-label="Planning calendar">
      <CalendarFrame
        ref={calendarRef}
        plugins={plugins}
        initialView={views[initial.current.view]}
        initialDate={initial.current.date}
        timeZone={BUSINESS_ZONE}
        locale="en-GB"
        firstDay={1}
        headerToolbar={false}
        events={events}
        eventContent={eventContent}
        eventClick={eventClick}
        eventClass={eventClass}
        eventInnerClass="planning-calendar-event-inner"
        dayHeaderClass="planning-calendar-day-head"
        dayCellClass={dayCellClass}
        dayCellTopClass="planning-calendar-cell-top"
        slotLaneClass={slotLaneClass}
        moreLinkClass="planning-calendar-more"
        navLinkClass="planning-calendar-nav"
        eventDidMount={eventDidMount}
        editable={false}
        eventStartEditable={false}
        eventDurationEditable={false}
        selectable={false}
        allDaySlot={false}
        slotMinTime="00:00:00"
        slotMaxTime="24:00:00"
        scrollTime="07:00:00"
        scrollTimeReset={false}
        slotDuration={slotDurations[slotMinutes]}
        slotHeaderInterval="01:00:00"
        slotHeaderFormat={slotHeaderFormat}
        slotMinHeight={slotMinutes === 15 ? 22 : slotMinutes === 60 ? 68 : 34}
        slotEventOverlap={false}
        eventOrder="start,id"
        eventMinHeight={26}
        nowIndicator
        height={view === 'list' ? 'auto' : 780}
        eventTimeFormat={eventTimeFormat}
        displayEventTime={false}
        weekends={weekends}
        fixedWeekCount
        dayMaxEvents={3}
        moreLinkClick="popover"
        navLinks={Boolean(onDateSelect)}
        navLinkDayClick={selectDay}
        dayHeaderFormat={dayHeaderFormat}
        dayHeaderContent={dayHeaderContent}
      />
    </div>
  );
});
