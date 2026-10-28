'use client';

import type {
  AppointmentResponse,
  CrewListResponse,
  TaskTemplateListResponse,
} from '@furniture-delivery/contracts';
import Link from 'next/link';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  CheckCheck,
  ClipboardCheck,
  Clock3,
  FilePenLine,
  FolderOpen,
  History,
  LayoutDashboard,
  MapPin,
  RefreshCw,
  Users,
} from 'lucide-react';
import { displayRome, utcToRomeLocalInput } from '../lib/business-time';
import { executionStatusLabel, formatWorkTime, orderProgressLabel } from '../lib/execution-labels';
import { serviceLabels } from '../lib/order-labels';
import { isCrewListResponse } from '../lib/contracts-guards';
import { isAppointmentResponse } from '../lib/order-guards';
import { isTaskTemplateListResponse } from '../lib/planning-guards';
import { useApiResource } from '../lib/use-api-resource';
import { AppointmentEditor } from './order-appointments';
import { ResourceNotice } from './form-parts';
import { BackofficeExecutionPanel } from './backoffice-execution-panel';
import { EvidencePanel } from './evidence-panel';
import { VisitAcceptancePanel } from './acceptance-panel';
import { useOrderResource } from '../lib/use-order-resource';
import { ReschedulePanel } from './reschedule-panel';
import { Badge } from './ui/badge';
import { Button, buttonVariants } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import './planning.css';
import './orders-detail.css';
import './planning-detail.css';

const card =
  'tw:min-w-0 tw:rounded-2xl tw:border tw:border-solid tw:border-[#dfe6d8] tw:bg-[#fffefa] tw:p-6 tw:max-[600px]:p-4';
const muted = 'tw:m-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]';
const sectionHeading = 'tw:m-0 tw:text-base tw:font-semibold tw:tracking-[-0.3px]';
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'full',
  timeZone: 'Europe/Rome',
});
const tabDefinitions = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'execution', label: 'Execution', icon: ClipboardCheck },
  { value: 'acknowledgements', label: 'Acknowledgements', icon: FilePenLine },
  { value: 'reschedule', label: 'Reschedule', icon: CalendarClock },
  { value: 'files', label: 'Files', icon: FolderOpen },
  { value: 'history', label: 'History', icon: History },
] as const;
type VisitTab = (typeof tabDefinitions)[number]['value'];
// Keep unrelated workspace navigation out of mounted editors and signature controls.
const VisitEditor = memo(AppointmentEditor);
const ExecutionSection = memo(BackofficeExecutionPanel);
const AcknowledgementsSection = memo(VisitAcceptancePanel);
const RescheduleSection = memo(ReschedulePanel);
const FilesSection = memo(EvidencePanel);
const readableKey = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
function changeValue(value: unknown): string {
  if (value === null) return 'Not specified';
  if (typeof value === 'string') return value || 'Empty';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

export function AppointmentDetailScreen({
  orderId,
  appointmentId,
}: Readonly<{ orderId: string; appointmentId: string }>) {
  const detail = useOrderResource<AppointmentResponse>(
    `/orders/${orderId}/appointments/${appointmentId}`,
    isAppointmentResponse,
    { retainDataOnRefresh: true },
  );
  const crews = useApiResource<CrewListResponse>('/crews', isCrewListResponse);
  const templates = useApiResource<TaskTemplateListResponse>(
    '/task-templates',
    isTaskTemplateListResponse,
  );
  const [editing, setEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<VisitTab>('overview');
  const { refresh, setData } = detail;
  const saved = useCallback((response: AppointmentResponse) => setData(response), [setData]);
  const changed = useCallback(() => void refresh(), [refresh]);
  const visitScope = useMemo(() => ({ orderId, appointmentId }), [orderId, appointmentId]);
  const orderScope = useMemo(() => ({ orderId }), [orderId]);
  const body = detail.data;
  const appointment = body?.appointment;
  const assignedTeams = useMemo(
    () => appointment?.assignments.filter((team) => team.status === 'ASSIGNED') ?? [],
    [appointment],
  );
  const started = appointment?.assignments.some((team) => team.execution.departedAt !== null);
  const history = useMemo(
    () => body?.order.activity.filter((entry) => entry.targetId === appointmentId) ?? [],
    [body?.order.activity, appointmentId],
  );
  return (
    <div className="planning-visit-theme orders-detail-theme tw:grid tw:min-w-0 tw:gap-6 tw:text-[#18372e]">
      <nav
        aria-label="Visit breadcrumb"
        className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3"
      >
        <Link
          className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'tw:-ml-3' })}
          href="/backoffice/planning"
        >
          <ArrowLeft aria-hidden="true" /> Planning calendar
        </Link>
        <Link
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          href={`/backoffice/orders/${orderId}`}
        >
          Open order <ArrowUpRight aria-hidden="true" />
        </Link>
      </nav>
      <ResourceNotice
        pending={detail.pending || crews.pending || templates.pending}
        error={detail.error ?? crews.error ?? templates.error}
        retry={() => {
          void refresh();
          void crews.refresh();
          void templates.refresh();
        }}
      />
      {body && appointment && crews.data && templates.data && (
        <>
          <header className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-5">
            <div className="tw:min-w-0 tw:flex-1">
              <p className="tw:mt-0 tw:mb-3 tw:text-[10px] tw:font-bold tw:tracking-[1.7px] tw:text-[#226347] tw:uppercase">
                {body.order.number} · Visit workspace
              </p>
              <h1 className="tw:m-0 tw:text-[36px] tw:leading-tight tw:font-medium tw:tracking-[-1.2px] tw:wrap-anywhere tw:max-[600px]:text-[29px]">
                {body.order.customerName}
              </h1>
              <p className="tw:mt-3 tw:mb-0 tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
                <MapPin className="tw:size-3.5 tw:shrink-0" aria-hidden="true" />
                {body.order.city} · {serviceLabels[body.order.serviceType]}
              </p>
              <div className="tw:mt-4 tw:flex tw:flex-wrap tw:gap-2">
                <Badge variant={appointment.status === 'CANCELLED' ? 'destructive' : 'secondary'}>
                  {appointment.status === 'CANCELLED' ? 'Cancelled visit' : 'Scheduled visit'}
                </Badge>
                <Badge
                  variant={appointment.confirmationStatus === 'CONFIRMED' ? 'success' : 'warning'}
                >
                  {appointment.confirmationStatus === 'CONFIRMED'
                    ? 'Client confirmed'
                    : 'Needs confirmation'}
                </Badge>
                <Badge variant="outline">
                  {orderProgressLabel(appointment.execution.orderProgress)}
                </Badge>
                {appointment.needsAttention && <Badge variant="destructive">Needs attention</Badge>}
                {appointment.execution.maybeDelayed && (
                  <Badge variant="warning">Possibly delayed</Badge>
                )}
                {appointment.returnRequestId && <Badge variant="outline">Follow-up visit</Badge>}
              </div>
            </div>
            <Button variant="outline" disabled={editing || detail.pending} onClick={changed}>
              <RefreshCw aria-hidden="true" /> Refresh visit
            </Button>
          </header>

          <section className="planning-visit-summary" aria-label="Visit summary">
            <div className="planning-visit-summary-date">
              <span className="planning-visit-summary-icon">
                <CalendarDays aria-hidden="true" size={21} />
              </span>
              <div className="tw:min-w-0">
                <span className={muted}>Planned customer window · Europe/Rome</span>
                <h2 className="tw:mt-2 tw:mb-1 tw:text-lg tw:leading-snug tw:font-medium tw:tracking-[-0.4px]">
                  {dateFormatter.format(new Date(appointment.plannedStartAt))}
                </h2>
                <p className="tw:m-0 tw:text-[26px] tw:leading-snug tw:font-medium tw:tracking-[-0.6px] tw:tabular-nums">
                  {utcToRomeLocalInput(appointment.plannedStartAt).slice(11)}
                  <span className="tw:px-2 tw:text-[#a1ad97]">–</span>
                  {utcToRomeLocalInput(appointment.plannedEndAt).slice(11)}
                </p>
              </div>
            </div>
            <div className="planning-visit-summary-fact">
              <Clock3 aria-hidden="true" size={17} />
              <span className={muted}>At the customer</span>
              <strong>{appointment.durationMinutes} min</strong>
              <span className={muted}>Travel buffers are separate</span>
            </div>
            <div className="planning-visit-summary-fact">
              <Users aria-hidden="true" size={17} />
              <span className={muted}>Assigned teams</span>
              <strong>{assignedTeams.length}</strong>
              <span className="tw:text-xs tw:leading-relaxed tw:text-[#65716a] tw:wrap-anywhere">
                {assignedTeams.map((team) => team.crewName).join(' · ') || 'Not assigned'}
              </span>
            </div>
            <div className="planning-visit-summary-fact">
              <CheckCheck aria-hidden="true" size={17} />
              <span className={muted}>Required tasks done</span>
              <strong>
                {appointment.execution.requiredDoneCount} / {appointment.execution.requiredCount}
              </strong>
              <span className={muted}>
                {appointment.execution.completedCount} teams completed ·{' '}
                {appointment.execution.activeCount} active
              </span>
            </div>
          </section>

          {started && (
            <p className="planning-visit-notice" role="note">
              A team has departed. The original plan and actual work remain separate. Time, assigned
              teams and task definitions are protected; ordinary rescheduling and cancellation are
              locked. Internal visit notes can still be edited.
            </p>
          )}
          {editing && (
            <p className="planning-visit-notice" role="note">
              Your visit editor remains open with its original revision. Switching sections keeps
              the draft. Save or close it in Overview when you are ready.
            </p>
          )}

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as VisitTab)}
            className="tw:min-w-0"
          >
            <TabsList
              aria-label="Visit sections"
              className="tw:mb-6 tw:h-auto tw:w-full tw:justify-start"
            >
              {tabDefinitions.map(({ value, label, icon: Icon }) => (
                <TabsTrigger key={value} value={value} className="tw:min-h-11 tw:gap-2">
                  <Icon aria-hidden="true" className="tw:size-4 tw:shrink-0" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="overview" forceMount hidden={activeTab !== 'overview'}>
              <div className="tw:grid tw:min-w-0 tw:gap-5">
                <section className={card} aria-labelledby="visit-location-title">
                  <h2 id="visit-location-title" className={sectionHeading}>
                    Customer and location
                  </h2>
                  <dl className="planning-visit-facts">
                    <div>
                      <dt>Contact</dt>
                      <dd>
                        {body.order.contactName || body.order.customerName}
                        <br />
                        {body.order.phoneNumbers.join(' · ') || 'No phone number'}
                      </dd>
                    </div>
                    <div>
                      <dt>Address</dt>
                      <dd>
                        {body.order.address}
                        <br />
                        {[body.order.postalCode, body.order.city].filter(Boolean).join(' ')} ·{' '}
                        {body.order.country}
                      </dd>
                    </div>
                    <div>
                      <dt>Work</dt>
                      <dd>{body.order.workDescription || 'Not specified'}</dd>
                    </div>
                    <div>
                      <dt>Access notes</dt>
                      <dd>{body.order.accessNotes || 'Not specified'}</dd>
                    </div>
                  </dl>
                </section>
                <section className={card} aria-labelledby="visit-plan-title">
                  <div className="tw:mb-5">
                    <h2 id="visit-plan-title" className={sectionHeading}>
                      Schedule, teams and tasks
                    </h2>
                    <p className={`${muted} tw:mt-2`}>
                      Keep the agreed customer window, team reservations and task snapshots
                      together. Changing time requires client confirmation again.
                    </p>
                  </div>
                  <VisitEditor
                    order={body.order}
                    appointment={appointment}
                    crews={crews.data.crews}
                    templates={templates.data.templates}
                    onSaved={saved}
                    onEditingChange={setEditing}
                  />
                </section>
              </div>
            </TabsContent>

            <TabsContent value="execution" forceMount hidden={activeTab !== 'execution'}>
              <section className={`${card} tw:mb-5`} aria-labelledby="visit-times-title">
                <h2 id="visit-times-title" className={sectionHeading}>
                  Team forecasts and actual times
                </h2>
                <p className={`${muted} tw:mt-2 tw:mb-5`}>
                  An estimated finish is a forecast. Recorded start and end times describe what
                  happened and never replace the planned customer window.
                </p>
                {assignedTeams.length === 0 ? (
                  <p className={muted}>No teams assigned to this visit.</p>
                ) : (
                  <div className="planning-visit-times">
                    {assignedTeams.map((team) => (
                      <article key={team.id} className="planning-visit-team-time">
                        <div className="tw:mb-4 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
                          <h3 className="tw:m-0 tw:text-sm tw:font-semibold">
                            {team.crewName}
                            {!team.crewActive ? ' (inactive)' : ''}
                          </h3>
                          <Badge variant="outline">
                            {executionStatusLabel(team.execution.status)}
                          </Badge>
                        </div>
                        <dl className="planning-visit-facts tw:mt-0">
                          <div>
                            <dt>Estimated finish</dt>
                            <dd>{formatWorkTime(team.execution.estimatedFinishAt)}</dd>
                          </div>
                          <div>
                            <dt>Actual start</dt>
                            <dd>{formatWorkTime(team.execution.actualStartAt)}</dd>
                          </div>
                          <div>
                            <dt>Actual end</dt>
                            <dd>{formatWorkTime(team.execution.actualEndAt)}</dd>
                          </div>
                          <div>
                            <dt>Reserved travel buffer</dt>
                            <dd>{team.travelBufferMinutes} min after customer window</dd>
                          </div>
                        </dl>
                      </article>
                    ))}
                  </div>
                )}
              </section>
              <ExecutionSection
                order={body.order}
                appointmentId={appointmentId}
                onRefresh={refresh}
              />
            </TabsContent>

            <TabsContent
              value="acknowledgements"
              forceMount
              hidden={activeTab !== 'acknowledgements'}
            >
              <AcknowledgementsSection scope={visitScope} onChanged={changed} />
            </TabsContent>

            <TabsContent value="reschedule" forceMount hidden={activeTab !== 'reschedule'}>
              <RescheduleSection
                appointment={appointment}
                crews={crews.data.crews}
                onSaved={saved}
                onReload={changed}
              />
            </TabsContent>

            <TabsContent value="files" forceMount hidden={activeTab !== 'files'}>
              <FilesSection scope={orderScope} items={body.order.items} onChanged={changed} />
            </TabsContent>

            <TabsContent value="history" forceMount hidden={activeTab !== 'history'}>
              <section className={card} aria-labelledby="visit-history-title">
                <h2 id="visit-history-title" className={sectionHeading}>
                  Visit history
                </h2>
                <p className={`${muted} tw:mt-2 tw:mb-5`}>
                  Schedule and execution changes for this visit, kept with their original reason and
                  author. All times are Europe/Rome.
                </p>
                {history.length === 0 ? (
                  <p className={muted}>No visit-specific changes recorded yet.</p>
                ) : (
                  <ol className="planning-visit-history">
                    {history.map((entry) => (
                      <li key={entry.id}>
                        <span className="planning-visit-history-dot" aria-hidden="true" />
                        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
                          <strong>{readableKey(entry.action.toLowerCase())}</strong>
                          <time dateTime={entry.createdAt}>{displayRome(entry.createdAt)}</time>
                        </div>
                        {entry.reason && (
                          <p className="tw:mt-2 tw:mb-0 tw:text-sm">{entry.reason}</p>
                        )}
                        <p className="tw:mt-2 tw:mb-0 tw:text-[10px] tw:text-[#7a8672] tw:wrap-anywhere">
                          Recorded by {entry.actorId}
                        </p>
                        {Object.keys(entry.changes).length > 0 && (
                          <details className="tw:mt-3">
                            <summary>View recorded changes</summary>
                            <dl className="planning-visit-history-changes">
                              {Object.entries(entry.changes).map(([key, value]) => (
                                <div key={key}>
                                  <dt>{readableKey(key)}</dt>
                                  <dd>{changeValue(value)}</dd>
                                </div>
                              ))}
                            </dl>
                          </details>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
