'use client';

import type { CrewListResponse, CrewResponse } from '@furniture-delivery/contracts';
import Link from 'next/link';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CircleHelp,
  ContactRound,
  Leaf,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react';
import { isCrewListResponse, isCrewResponse } from '../lib/contracts-guards';
import { useApiResource } from '../lib/use-api-resource';
import { useRealtimeCoordinator } from '../lib/realtime-context';
import { useCurrentUser } from './session-provider';
import { StaffContactCard, StaffMemberCard } from './staff-team-cards';
import { Badge } from './ui/badge';
import { Button, buttonVariants } from './ui/button';
import { Input } from './ui/input';
import './staff-teams.css';

const MemberCard = memo(StaffMemberCard);
const ContactCard = memo(StaffContactCard);
function ReadNotice({
  pending,
  error,
  retry,
  retained = false,
}: Readonly<{ pending: boolean; error: string | null; retry: () => void; retained?: boolean }>) {
  if (pending)
    return (
      <p role="status" className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-[#65716a]">
        {retained ? 'Refreshing team information…' : 'Loading team information…'}
      </p>
    );
  if (!error) return null;
  return (
    <div className="tw:grid tw:justify-items-start tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#ead7cf] tw:bg-[#fcf3ee] tw:p-4">
      <p role="alert" className="tw:m-0 tw:text-sm tw:leading-relaxed tw:text-[#97372a]">
        {error}
      </p>
      <Button variant="outline" onClick={retry}>
        Retry
      </Button>
    </div>
  );
}
function StaffTeam({
  crewId,
  currentUserId,
  refreshId,
}: Readonly<{ crewId: string; currentUserId: string; refreshId: number }>) {
  const resource = useApiResource<CrewResponse>(`/crews/${crewId}`, isCrewResponse, {
    retainDataOnRefresh: true,
  });
  const observedRefresh = useRef(refreshId);
  useEffect(() => {
    if (observedRefresh.current === refreshId) return;
    observedRefresh.current = refreshId;
    void resource.refresh();
  }, [refreshId, resource.refresh]);
  const [search, setSearch] = useState('');
  const crew = resource.data?.crew;
  const term = search.trim().toLocaleLowerCase('en-GB');
  const members = useMemo(
    () =>
      crew?.members.filter(
        (member) =>
          !term ||
          `${member.user.displayName} ${member.user.username}`
            .toLocaleLowerCase('en-GB')
            .includes(term),
      ) ?? [],
    [crew, term],
  );
  const contacts = useMemo(
    () =>
      crew?.contacts.filter(
        (contact) =>
          !term ||
          `${contact.name} ${contact.specialty} ${contact.phone ?? ''} ${contact.email ?? ''}`
            .toLocaleLowerCase('en-GB')
            .includes(term),
      ) ?? [],
    [crew, term],
  );
  const titleId = `staff-team-${crewId}-title`;
  return (
    <section className="tw:grid tw:min-w-0 tw:gap-5" aria-label="Team information">
      <ReadNotice
        pending={resource.pending}
        error={resource.error}
        retained={!!crew}
        retry={() => void resource.refresh()}
      />
      {crew && (
        <>
          <header className="tw:grid tw:min-w-0 tw:gap-5 tw:rounded-2xl tw:border tw:border-solid tw:border-[#dce5d1] tw:bg-[#f0f5e8] tw:p-6 tw:max-[600px]:p-5">
            <div className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-3">
              <div className="tw:flex tw:min-w-0 tw:flex-1 tw:items-start tw:gap-3">
                <span className="tw:flex tw:size-12 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-2xl tw:border tw:border-solid tw:border-[#d6e3c9] tw:bg-[#fcfef8] tw:text-[#65834e]">
                  <UsersRound size={24} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <div className="tw:min-w-0">
                  <p className="tw:mt-0 tw:mb-2 tw:text-[10px] tw:font-bold tw:tracking-[1.5px] tw:text-[#7a8b6c] tw:uppercase tw:wrap-anywhere">
                    {crew.code}
                  </p>
                  <h2
                    id={titleId}
                    className="tw:m-0 tw:text-[24px] tw:leading-snug tw:font-medium tw:tracking-[-0.6px] tw:wrap-anywhere"
                  >
                    {crew.name}
                  </h2>
                </div>
              </div>
              <Badge variant={crew.active ? 'success' : 'outline'} className="tw:px-3 tw:py-1.5">
                <BadgeCheck size={13} className="tw:size-[13px]" aria-hidden="true" />
                {crew.active ? 'Team enabled' : 'Team disabled'}
              </Badge>
            </div>
            <div className="tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-4 tw:max-[500px]:grid-cols-1">
              <p className="tw:m-0 tw:flex tw:items-start tw:gap-2 tw:text-xs tw:leading-relaxed tw:text-[#65765c]">
                {crew.workEnvironment === 'INDOOR' ? (
                  <Building2 size={16} className="tw:mt-0.5 tw:shrink-0" aria-hidden="true" />
                ) : (
                  <Leaf size={16} className="tw:mt-0.5 tw:shrink-0" aria-hidden="true" />
                )}
                {crew.workEnvironment === 'INDOOR' ? 'Indoor' : 'Outdoor'}
              </p>
              <p className="tw:m-0 tw:flex tw:items-start tw:gap-2 tw:text-xs tw:leading-relaxed tw:text-[#65765c]">
                <MapPin size={16} className="tw:mt-0.5 tw:shrink-0" aria-hidden="true" />
                <span className="tw:whitespace-pre-wrap tw:wrap-anywhere">
                  {crew.serviceArea || 'Service area not provided'}
                </span>
              </p>
            </div>
            <dl className="tw:m-0 tw:grid tw:grid-cols-2 tw:gap-3 tw:border-x-0 tw:border-b-0 tw:border-t tw:border-solid tw:border-[#dce5d2] tw:pt-4">
              <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-3">
                <UsersRound
                  size={18}
                  className="tw:shrink-0 tw:text-[#829970]"
                  aria-hidden="true"
                />
                <div>
                  <dt className="tw:text-[11px] tw:text-[#748468]">Team members</dt>
                  <dd className="tw:m-0 tw:text-[23px] tw:leading-relaxed tw:font-medium tw:tabular-nums">
                    {crew.members.length}
                  </dd>
                </div>
              </div>
              <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-3">
                <ContactRound
                  size={18}
                  className="tw:shrink-0 tw:text-[#829970]"
                  aria-hidden="true"
                />
                <div>
                  <dt className="tw:text-[11px] tw:text-[#748468]">External contacts</dt>
                  <dd className="tw:m-0 tw:text-[23px] tw:leading-relaxed tw:font-medium tw:tabular-nums">
                    {crew.contacts.length}
                  </dd>
                </div>
              </div>
            </dl>
          </header>
          <div
            role="search"
            aria-label={`Search people in ${crew.name}`}
            className="tw:relative tw:min-w-0"
          >
            <label htmlFor={`staff-search-${crewId}`} className="tw:sr-only">
              Search team people
            </label>
            <Search
              size={17}
              className="tw:pointer-events-none tw:absolute tw:top-3.5 tw:left-3 tw:text-[#7a8d6b]"
              aria-hidden="true"
            />
            <Input
              id={`staff-search-${crewId}`}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a name, specialty or contact…"
              maxLength={200}
              className="tw:min-h-12 tw:pr-12 tw:pl-10 tw:max-[600px]:text-base"
            />
            {search && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Clear team search"
                className="tw:absolute tw:top-0.5 tw:right-1"
                onClick={() => setSearch('')}
              >
                <X aria-hidden="true" />
              </Button>
            )}
          </div>
          <section aria-label="Team composition" className="tw:grid tw:min-w-0 tw:gap-4">
            <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
              <h3 className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-base tw:font-semibold">
                <UsersRound size={19} className="tw:text-[#7b9568]" aria-hidden="true" />
                Team composition
              </h3>
              <Badge variant="outline">
                {members.length} of {crew.members.length}
              </Badge>
            </div>
            <p className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-[#73816b]">
              The people linked to your team. Membership and account access are shown separately.
            </p>
            {members.length ? (
              <div className="tw:grid tw:min-w-0 tw:gap-3 tw:md:grid-cols-2">
                {members.map((member) => (
                  <MemberCard key={member.id} member={member} currentUserId={currentUserId} />
                ))}
              </div>
            ) : (
              <div className="staff-team-empty">
                <UsersRound size={26} aria-hidden="true" />
                <p>
                  {crew.members.length
                    ? 'No matching team members.'
                    : 'No team members to display.'}
                </p>
              </div>
            )}
          </section>
          <section aria-label="External specialists" className="tw:grid tw:min-w-0 tw:gap-4">
            <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
              <h3 className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-base tw:font-semibold">
                <ContactRound size={19} className="tw:text-[#7b9568]" aria-hidden="true" />
                External specialists
              </h3>
              <Badge variant="outline">
                {contacts.length} of {crew.contacts.length}
              </Badge>
            </div>
            <p className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-[#73816b]">
              Specialists are external contacts, separate from employee accounts. Call or email
              using the shared details below.
            </p>
            {contacts.length ? (
              <div className="tw:grid tw:min-w-0 tw:gap-3 tw:md:grid-cols-2">
                {contacts.map((contact) => (
                  <ContactCard key={contact.id} contact={contact} />
                ))}
              </div>
            ) : (
              <div className="staff-team-empty">
                <ContactRound size={26} aria-hidden="true" />
                <p>
                  {crew.contacts.length
                    ? 'No matching external contacts.'
                    : 'No external contacts.'}
                </p>
              </div>
            )}
          </section>
          {term && members.length === 0 && contacts.length === 0 && (
            <Button
              variant="outline"
              className="tw:justify-self-start"
              onClick={() => setSearch('')}
            >
              Show everyone
            </Button>
          )}
          <p className="tw:m-0 tw:flex tw:items-start tw:gap-2 tw:text-[11px] tw:leading-relaxed tw:text-[#7a886e]">
            <ShieldCheck size={15} className="tw:mt-0.5 tw:shrink-0" aria-hidden="true" />
            Team details are read-only here. Contact your dispatcher to update membership or
            specialist information.
          </p>
        </>
      )}
    </section>
  );
}
function StaffTeamDirectory({ currentUserId }: Readonly<{ currentUserId: string }>) {
  const resource = useApiResource<CrewListResponse>('/crews', isCrewListResponse, {
    retainDataOnRefresh: true,
  });
  const live = useRealtimeCoordinator();
  const [refreshId, setRefreshId] = useState(0);
  const refresh = useCallback(() => {
    setRefreshId((value) => value + 1);
    void resource.refresh();
  }, [resource.refresh]);
  useEffect(() => {
    if (live) return;
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [live, refresh]);
  return (
    <div className="staff-teams-theme tw:grid tw:min-w-0 tw:gap-6 tw:text-[#18372e]">
      <header className="tw:flex tw:flex-wrap tw:items-end tw:justify-between tw:gap-4">
        <div className="tw:min-w-0">
          <p className="tw:mt-0 tw:mb-2.5 tw:flex tw:items-center tw:gap-2 tw:text-[10px] tw:font-bold tw:tracking-[1.6px] tw:text-[#60804f] tw:uppercase">
            <UsersRound size={14} aria-hidden="true" />
            Your workspace
          </p>
          <h1 className="tw:m-0 tw:text-[36px] tw:leading-[1.15] tw:font-medium tw:tracking-[-1.2px] tw:max-[600px]:text-[30px]">
            My team
          </h1>
          <p className="tw:mt-3 tw:mb-0 tw:max-w-[560px] tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
            Your current team and the people you work with.
          </p>
        </div>
        <Button variant="outline" disabled={resource.pending} onClick={refresh}>
          <RefreshCw aria-hidden="true" />
          Refresh my team
        </Button>
      </header>
      <ReadNotice
        pending={resource.pending}
        error={resource.error}
        retained={!!resource.data}
        retry={refresh}
      />
      {resource.data &&
        (resource.data.crews.length ? (
          resource.data.crews.map((crew) => (
            <StaffTeam
              key={crew.id}
              crewId={crew.id}
              currentUserId={currentUserId}
              refreshId={refreshId}
            />
          ))
        ) : (
          <section className="staff-team-empty tw:bg-white tw:px-6 tw:py-12">
            <CircleHelp size={32} aria-hidden="true" />
            <h2 className="tw:m-0 tw:text-lg tw:font-medium">No team assignment</h2>
            <p>You do not currently have access to a team. Contact your dispatcher.</p>
          </section>
        ))}
      <Link
        href="/crew"
        className={buttonVariants({ variant: 'ghost', className: 'tw:justify-self-start' })}
      >
        <ArrowLeft aria-hidden="true" />
        Back to my work
      </Link>
    </div>
  );
}
export function StaffTeams() {
  const user = useCurrentUser();
  if (user.role !== 'CREW_MEMBER')
    return <p role="alert">Access denied. My team is available to team members.</p>;
  return <StaffTeamDirectory currentUserId={user.id} />;
}
