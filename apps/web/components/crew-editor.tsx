'use client';

import type {
  CrewDetail,
  CrewResponse,
  MemberCandidatesResponse,
} from '@furniture-delivery/contracts';
import Link from 'next/link';
import { memo, useCallback, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarClock,
  ContactRound,
  LayoutDashboard,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { apiRequest, describeError } from '../lib/api-client';
import { isCrewResponse, isMemberCandidatesResponse } from '../lib/contracts-guards';
import { useApiResource } from '../lib/use-api-resource';
import { ContactForm } from './contact-form';
import { crewFormValues, Feedback, ResourceNotice } from './form-parts';
import { CrewPlanningEditor } from './crew-planning-editor';
import { DraftChangeNotice } from './draft-change-notice';
import { TeamFields } from './team-fields';
import { Badge } from './ui/badge';
import { Button, buttonVariants } from './ui/button';
import { Input } from './ui/input';
import { NativeSelect } from './ui/native-select';
import { SelectField } from './ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import './teams.css';
import './teams-detail.css';

const card =
  'tw:min-w-0 tw:rounded-2xl tw:border tw:border-solid tw:border-[#e0e6d9] tw:bg-[#fffefa] tw:p-6 tw:max-[600px]:p-4';
const copy = 'tw:m-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]';
const heading = 'tw:m-0 tw:text-base tw:font-semibold tw:tracking-[-0.3px]';
const TeamAvailability = memo(CrewPlanningEditor);
const tabs = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'members', label: 'Members', icon: Users },
  { value: 'availability', label: 'Availability', icon: CalendarClock },
  { value: 'specialists', label: 'Specialists', icon: ContactRound },
] as const;
type TeamTab = (typeof tabs)[number]['value'];
type MembershipAction = (path: string, method: 'POST' | 'PATCH', body: unknown) => Promise<void>;
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeZone: 'Europe/Rome',
});
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

/** The roster's local search does not rerender the working-hours or details drafts. */
const MemberRoster = memo(function MemberRoster({
  crew,
  pending,
  onAction,
}: Readonly<{ crew: CrewDetail; pending: boolean; onAction: MembershipAction }>) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const filtered = useMemo(() => {
    const text = search.trim().toLocaleLowerCase('en-GB');
    return crew.members.filter(
      (member) =>
        (status === 'all' || member.active === (status === 'active')) &&
        (!text ||
          `${member.user.displayName} ${member.user.username}`
            .toLocaleLowerCase('en-GB')
            .includes(text)),
    );
  }, [crew.members, search, status]);
  return (
    <>
      {crew.members.length > 0 && (
        <div className="tw:my-5 tw:flex tw:flex-wrap tw:items-center tw:gap-3">
          <div className="tw:relative tw:min-w-[min(100%,220px)] tw:flex-1">
            <Search
              aria-hidden="true"
              className="tw:pointer-events-none tw:absolute tw:top-3.5 tw:left-3 tw:size-4 tw:text-[#75856b]"
            />
            <Input
              aria-label="Search team members"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a name or username…"
              maxLength={200}
              className="tw:pl-9"
            />
          </div>
          <div className="tw:w-[190px] tw:max-w-full">
            <SelectField
              label="Membership filter"
              value={status}
              onValueChange={setStatus}
              options={[
                { value: 'all', label: 'All memberships' },
                { value: 'active', label: 'Active memberships' },
                { value: 'inactive', label: 'Inactive memberships' },
              ]}
            />
          </div>
        </div>
      )}
      {crew.members.length === 0 ? (
        <div className="teams-detail-empty">
          <Users aria-hidden="true" />
          <h3>No team members yet.</h3>
          <p>Add an employee account below to build this team.</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className={`${copy} tw:py-6`}>No members match this search.</p>
      ) : (
        <ul className="teams-member-roster" aria-label="Team composition">
          {filtered.map((member) => (
            <li key={member.id}>
              <span className="teams-member-avatar" aria-hidden="true">
                {initials(member.user.displayName)}
              </span>
              <div className="tw:min-w-0 tw:flex-1">
                <strong className="tw:block tw:text-sm tw:font-semibold tw:wrap-anywhere">
                  {member.user.displayName}
                </strong>
                <span className="tw:mt-1 tw:block tw:text-[11px] tw:text-[#73816b] tw:wrap-anywhere">
                  {member.user.username}
                </span>
                <div className="tw:mt-2 tw:flex tw:flex-wrap tw:gap-1.5">
                  <Badge variant={member.active ? 'success' : 'secondary'}>
                    {member.active ? 'Active membership' : 'Inactive membership'}
                  </Badge>
                  {!member.user.active && <Badge variant="warning">Account disabled</Badge>}
                </div>
              </div>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void onAction(`/crews/${crew.id}/members/${member.id}`, 'PATCH', {
                    active: !member.active,
                  })
                }
              >
                {member.active ? <UserMinus aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
                {member.active ? 'Deactivate membership' : 'Reactivate membership'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
});

export function CrewEditor({ crewId }: Readonly<{ crewId: string }>) {
  const resource = useApiResource<CrewResponse>(`/crews/${crewId}`, isCrewResponse, {
    retainDataOnRefresh: true,
  });
  const candidates = useApiResource<MemberCandidatesResponse>(
    '/crews/member-candidates',
    isMemberCandidatesResponse,
  );
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);
  const [memberPending, setMemberPending] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberSuccess, setMemberSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TeamTab>('overview');
  const { setData } = resource;
  const refreshCandidates = candidates.refresh;
  const teamPaths = useMemo(() => [`/crews/${crewId}`], [crewId]);

  async function saveCrew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = crewFormValues(event.currentTarget);
    setSaving(true);
    setEditError(null);
    setEditSuccess(null);
    try {
      setData(
        await apiRequest<CrewResponse>(`/crews/${crewId}`, {
          method: 'PATCH',
          body,
          validate: isCrewResponse,
        }),
      );
      setEditSuccess('Team details saved.');
    } catch (error) {
      setEditError(describeError(error));
    } finally {
      setSaving(false);
    }
  }
  const membershipAction = useCallback(
    async (path: string, method: 'POST' | 'PATCH', body: unknown) => {
      setMemberPending(true);
      setMemberError(null);
      setMemberSuccess(null);
      try {
        setData(await apiRequest<CrewResponse>(path, { method, body, validate: isCrewResponse }));
        setMemberSuccess('Team membership updated.');
        await refreshCandidates();
      } catch (error) {
        setMemberError(describeError(error));
      } finally {
        setMemberPending(false);
      }
    },
    [setData, refreshCandidates],
  );
  function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void membershipAction(`/crews/${crewId}/members`, 'POST', {
      userId: String(data.get('userId') ?? ''),
    });
  }
  const crew = resource.data?.crew;
  const counts = useMemo(
    () => ({
      active: crew?.members.filter((member) => member.active).length ?? 0,
      total: crew?.members.length ?? 0,
      specialists: crew?.contacts.filter((contact) => contact.active).length ?? 0,
    }),
    [crew],
  );
  return (
    <div className="teams-theme teams-detail-theme tw:grid tw:min-w-0 tw:gap-6 tw:text-[#18372e]">
      <nav
        aria-label="Team breadcrumb"
        className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2"
      >
        <Link
          href="/backoffice/crews"
          className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'tw:-ml-3' })}
        >
          <ArrowLeft aria-hidden="true" />
          All teams
        </Link>
        <Link
          href="/backoffice/planning"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Open planning <ArrowUpRight aria-hidden="true" />
        </Link>
      </nav>
      <ResourceNotice
        pending={resource.pending}
        error={resource.error}
        retry={() => void resource.refresh()}
      />
      {crew && (
        <>
          <header className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-5">
            <div className="tw:min-w-0 tw:flex-1">
              <p className="tw:mt-0 tw:mb-3 tw:text-[10px] tw:font-bold tw:tracking-[1.7px] tw:text-[#226347] tw:uppercase">
                Team · {crew.code}
              </p>
              <h1 className="tw:m-0 tw:text-[36px] tw:leading-tight tw:font-medium tw:tracking-[-1.2px] tw:wrap-anywhere tw:max-[600px]:text-[29px]">
                {crew.name}
              </h1>
              <p className="tw:mt-3 tw:mb-0 tw:flex tw:items-start tw:gap-2 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
                <MapPin className="tw:mt-0.5 tw:size-3.5 tw:shrink-0" aria-hidden="true" />
                <span className="tw:wrap-anywhere">
                  {crew.serviceArea || 'Service area not specified'}
                </span>
              </p>
              <div className="tw:mt-4 tw:flex tw:flex-wrap tw:gap-2">
                <Badge variant={crew.active ? 'success' : 'secondary'}>
                  {crew.active ? 'Enabled' : 'Disabled'}
                </Badge>
                <Badge variant="outline">
                  {crew.workEnvironment === 'INDOOR' ? 'Indoor' : 'Outdoor'}
                </Badge>
              </div>
            </div>
            <Button
              variant="outline"
              disabled={resource.pending || saving || memberPending}
              onClick={() => void resource.refresh()}
            >
              <RefreshCw aria-hidden="true" />
              Refresh team
            </Button>
          </header>
          {!crew.active && (
            <p className="teams-detail-notice">
              This team is disabled. Its membership, contacts and visit history are retained; new
              assignments are checked by the server.
            </p>
          )}
          <section className="teams-detail-summary" aria-label="Team summary">
            <div>
              <Users aria-hidden="true" />
              <span>Active memberships</span>
              <strong>{counts.active}</strong>
              <small>of {counts.total} recorded memberships</small>
            </div>
            <div>
              <BriefcaseBusiness aria-hidden="true" />
              <span>Enabled specialists</span>
              <strong>{counts.specialists}</strong>
              <small>of {crew.contacts.length} external contacts</small>
            </div>
            <div>
              <ShieldCheck aria-hidden="true" />
              <span>Team identity</span>
              <strong className="teams-summary-code">{crew.code}</strong>
              <small>Stable code retained with history</small>
            </div>
          </section>
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as TeamTab)}
            className="tw:min-w-0"
          >
            <TabsList aria-label="Team sections" className="tw:mb-6 tw:w-full tw:justify-start">
              {tabs.map(({ value, label, icon: Icon }) => (
                <TabsTrigger key={value} value={value}>
                  <Icon aria-hidden="true" />
                  {label}
                  {(value === 'members' || value === 'specialists') && (
                    <Badge
                      variant="outline"
                      aria-hidden="true"
                      className="tw:ml-1 tw:min-w-5 tw:justify-center tw:px-1.5 tw:py-0.5"
                    >
                      {value === 'members' ? crew.members.length : crew.contacts.length}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="overview" forceMount hidden={activeTab !== 'overview'}>
              <div className="teams-detail-overview">
                <section className={card} aria-labelledby="team-details-title">
                  <h2 id="team-details-title" className={heading}>
                    Team details
                  </h2>
                  <p className={`${copy} tw:mt-2`}>
                    Update the team profile. Its stable code stays with its history.
                  </p>
                  <form
                    className="form-grid tw:mt-5"
                    aria-label="Team details"
                    onSubmit={(event) => void saveCrew(event)}
                    key={crew.id}
                  >
                    <DraftChangeNotice paths={teamPaths} />
                    <fieldset disabled={saving}>
                      <TeamFields crew={crew} />
                    </fieldset>
                    <Feedback error={editError} success={editSuccess} />
                    <div className="tw:col-span-full">
                      <Button type="submit" disabled={saving}>
                        {saving ? 'Saving…' : 'Save team'}
                      </Button>
                    </div>
                  </form>
                </section>
                <aside className={card} aria-label="Team record">
                  <h2 className={heading}>Team record</h2>
                  <dl className="teams-detail-record">
                    <div>
                      <dt>Code</dt>
                      <dd>{crew.code}</dd>
                    </div>
                    <div>
                      <dt>Work environment</dt>
                      <dd>{crew.workEnvironment === 'INDOOR' ? 'Indoor' : 'Outdoor'}</dd>
                    </div>
                    <div>
                      <dt>Created</dt>
                      <dd>{dateFormatter.format(new Date(crew.createdAt))}</dd>
                    </div>
                    <div>
                      <dt>Last saved</dt>
                      <dd>{dateFormatter.format(new Date(crew.updatedAt))}</dd>
                    </div>
                  </dl>
                  <p className={`${copy} tw:mt-5`}>
                    Manage the roster in Members. Working windows, travel buffer and exceptions are
                    in Availability.
                  </p>
                </aside>
              </div>
            </TabsContent>
            <TabsContent value="members" forceMount hidden={activeTab !== 'members'}>
              <section className={card} aria-labelledby="team-members-title">
                <h2 id="team-members-title" className={heading}>
                  Team members
                </h2>
                <p className={`${copy} tw:mt-2`}>
                  Employees with application accounts belong here. Each employee can have one active
                  team membership. Account status is shown separately.
                </p>
                {crew.members.length === 0 && crew.contacts.length > 0 && (
                  <div className="tw:mt-4 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#dce6d3] tw:bg-[#f2f7ec] tw:p-4">
                    <p className={`${copy} tw:min-w-0 tw:flex-1`}>
                      {crew.contacts.length} external specialist{' '}
                      {crew.contacts.length === 1 ? 'contact is' : 'contacts are'} saved under
                      Specialists. These contacts are separate from employee memberships.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => setActiveTab('specialists')}>
                      View specialists
                    </Button>
                  </div>
                )}
                <MemberRoster crew={crew} pending={memberPending} onAction={membershipAction} />
                <Feedback error={memberError} success={memberSuccess} />
                <div className="tw:mt-6 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e0e6d9] tw:pt-5">
                  <h3 className="tw:mt-0 tw:mb-3 tw:text-sm tw:font-semibold">Add an employee</h3>
                  <ResourceNotice
                    pending={candidates.pending}
                    error={candidates.error}
                    retry={() => void candidates.refresh()}
                  />
                  {candidates.data &&
                    (candidates.data.users.length === 0 ? (
                      <p className={copy}>
                        No employee accounts are available to add. An administrator can create an
                        employee account, or an existing employee can be released from their current
                        team before being added here.
                      </p>
                    ) : (
                      <form
                        className="teams-add-member"
                        aria-label="Add team member"
                        onSubmit={addMember}
                      >
                        <label className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-2 tw:text-xs tw:font-semibold tw:text-[#52654f]">
                          Add employee
                          <NativeSelect
                            name="userId"
                            required
                            disabled={memberPending}
                            defaultValue=""
                          >
                            <option value="" disabled>
                              Select an employee
                            </option>
                            {candidates.data.users.map((user) => (
                              <option key={user.id} value={user.id} disabled={!user.active}>
                                {user.displayName} ({user.username})
                                {user.active ? '' : ' · Account disabled'}
                              </option>
                            ))}
                          </NativeSelect>
                        </label>
                        <Button type="submit" disabled={memberPending}>
                          <UserPlus aria-hidden="true" />
                          {memberPending ? 'Updating…' : 'Add member'}
                        </Button>
                      </form>
                    ))}
                </div>
              </section>
            </TabsContent>
            <TabsContent value="availability" forceMount hidden={activeTab !== 'availability'}>
              <TeamAvailability crewId={crew.id} active={crew.active} />
            </TabsContent>
            <TabsContent value="specialists" forceMount hidden={activeTab !== 'specialists'}>
              <section className={card} aria-labelledby="team-specialists-title">
                <h2 id="team-specialists-title" className={heading}>
                  External specialists
                </h2>
                <p className={`${copy} tw:mt-2 tw:mb-5`}>
                  External contact records for this team. Adding a contact does not create an
                  employee account or a team membership. Employees who need application access are
                  added under Members.
                </p>
                {crew.contacts.length === 0 && <p className={copy}>No external contacts yet.</p>}
                {crew.contacts.map((contact) => (
                  <details className="contact-editor" key={contact.id}>
                    <summary>
                      {contact.name} · {contact.specialty}
                      {!contact.active && ' · Disabled'}
                    </summary>
                    <ContactForm crewId={crew.id} contact={contact} onSaved={setData} />
                  </details>
                ))}
                <details className="contact-editor">
                  <summary>Add an external contact</summary>
                  <ContactForm crewId={crew.id} onSaved={setData} />
                </details>
              </section>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
