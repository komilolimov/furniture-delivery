'use client';

import type { CrewListResponse, CrewResponse, CrewSummary } from '@furniture-delivery/contracts';
import Link from 'next/link';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  Building2,
  CheckCheck,
  CirclePause,
  Plus,
  RefreshCw,
  TreePine,
  Users,
} from 'lucide-react';
import { apiRequest, describeError } from '../lib/api-client';
import { isCrewListResponse, isCrewResponse } from '../lib/contracts-guards';
import { useApiResource } from '../lib/use-api-resource';
import { crewFormValues, Feedback, ResourceNotice } from './form-parts';
import { TeamFields } from './team-fields';
import {
  initialTeamDirectoryFilters,
  TeamDirectoryFilters,
  type TeamDirectoryFilterValue,
} from './team-directory-filters';
import { Badge } from './ui/badge';
import { Button, buttonVariants } from './ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import './teams.css';

const EMPTY_TEAMS: CrewSummary[] = [];
const mobileLabel =
  'tw:mb-1.5 tw:hidden tw:text-[10px] tw:font-semibold tw:tracking-wide tw:text-[#7a8871] tw:uppercase tw:max-[900px]:block';
export function CrewList() {
  const resource = useApiResource<CrewListResponse>('/crews', isCrewListResponse, {
    retainDataOnRefresh: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const [filters, setFilters] = useState<TeamDirectoryFilterValue>(initialTeamDirectoryFilters);
  const crews = resource.data?.crews ?? EMPTY_TEAMS;
  const filtered = useMemo(() => {
    const term = filters.search.toLocaleLowerCase('en-GB');
    return crews.filter(
      (crew) =>
        (filters.status === 'all' || crew.active === (filters.status === 'enabled')) &&
        (filters.environment === 'all' || crew.workEnvironment === filters.environment) &&
        (!term ||
          [crew.name, crew.code, crew.serviceArea]
            .join(' ')
            .toLocaleLowerCase('en-GB')
            .includes(term)),
    );
  }, [crews, filters]);
  const enabled = useMemo(() => crews.filter((crew) => crew.active).length, [crews]);
  const outdoor = useMemo(
    () => crews.filter((crew) => crew.workEnvironment === 'OUTDOOR').length,
    [crews],
  );

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await apiRequest<CrewResponse>('/crews', {
        method: 'POST',
        body: { ...crewFormValues(form), code: String(data.get('code') ?? '').trim() },
        validate: isCrewResponse,
      });
      form.reset();
      setSuccess('Team created.');
      setCreating(false);
      await resource.refresh();
    } catch (error) {
      setError(describeError(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="teams-theme tw:grid tw:min-w-0 tw:gap-6">
      <header className="tw:flex tw:flex-wrap tw:items-end tw:justify-between tw:gap-4">
        <div>
          <p className="tw:mt-0 tw:mb-3 tw:text-[10px] tw:font-bold tw:tracking-[1.8px] tw:text-[#226347] tw:uppercase">
            Delivery operations
          </p>
          <h1 className="tw:m-0 tw:text-[38px] tw:leading-tight tw:font-medium tw:tracking-[-1.2px] tw:max-[600px]:text-[32px]">
            Teams
          </h1>
          <p className="tw:mt-3 tw:mb-0 tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
            The people, coverage and working hours behind every visit.
          </p>
        </div>
        <div className="tw:flex tw:flex-wrap tw:gap-2">
          <Button
            variant="outline"
            disabled={resource.pending}
            onClick={() => void resource.refresh()}
          >
            <RefreshCw aria-hidden="true" />
            Refresh teams
          </Button>
          <Button
            ref={addTrigger}
            onClick={() => {
              setError(null);
              setCreating(true);
            }}
          >
            <Plus aria-hidden="true" />
            Add a team
          </Button>
        </div>
      </header>
      <div
        className="tw:grid tw:grid-cols-4 tw:gap-3 tw:max-[650px]:grid-cols-2"
        aria-label="Team directory summary"
      >
        {[
          [Users, 'Total teams', crews.length],
          [CheckCheck, 'Enabled teams', enabled],
          [CirclePause, 'Disabled teams', crews.length - enabled],
          [TreePine, 'Outdoor teams', outdoor],
        ].map(([Icon, label, count]) => {
          const MetricIcon = Icon as typeof Users;
          return (
            <div
              key={String(label)}
              className="tw:flex tw:min-w-0 tw:items-start tw:gap-3 tw:rounded-xl tw:border tw:border-solid tw:border-[#e0e6d9] tw:bg-[#fffefa] tw:p-4"
            >
              <MetricIcon
                aria-hidden="true"
                className="tw:mt-0.5 tw:size-4 tw:shrink-0 tw:text-[#69835e]"
              />
              <div>
                <span className="tw:block tw:text-[10px] tw:leading-relaxed tw:text-[#73816b]">
                  {String(label)}
                </span>
                <strong className="tw:mt-1 tw:block tw:text-xl tw:font-medium tw:tabular-nums">
                  {resource.data ? String(count) : '—'}
                </strong>
              </div>
            </div>
          );
        })}
      </div>
      <TeamDirectoryFilters value={filters} onApply={setFilters} />
      {!creating && <Feedback error={error} success={success} />}
      <ResourceNotice
        pending={resource.pending && !resource.data}
        error={resource.error}
        retry={() => void resource.refresh()}
      />
      {resource.data && (
        <section
          className="tw:min-w-0 tw:overflow-hidden tw:rounded-2xl tw:border tw:border-solid tw:border-[#e0e5da] tw:bg-[#fffefa]"
          aria-label="Team directory"
          aria-busy={resource.pending}
        >
          <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:px-5 tw:py-5">
            <div>
              <h2 className="tw:m-0 tw:text-lg tw:font-medium tw:tracking-[-0.4px]">
                Team directory
              </h2>
              <p className="tw:mt-1.5 tw:mb-0 tw:text-xs tw:text-[#65716a]">
                Showing {filtered.length} of {crews.length} teams · Open a team to manage its
                members and availability.
              </p>
            </div>
            {resource.pending && (
              <span role="status" className="tw:text-xs tw:text-[#73816b]">
                Updating teams…
              </span>
            )}
          </div>
          {filtered.length === 0 ? (
            <div className="tw:grid tw:justify-items-center tw:gap-3 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#edf0e8] tw:px-5 tw:py-14 tw:text-center">
              <span className="tw:grid tw:size-12 tw:place-items-center tw:rounded-xl tw:bg-[#edf3e7] tw:text-[#54764e]">
                <Users size={22} aria-hidden="true" />
              </span>
              <h2 className="tw:m-0 tw:text-xl tw:font-medium">
                {crews.length ? 'No matching teams' : 'No teams yet'}
              </h2>
              <p className="tw:m-0 tw:max-w-[360px] tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
                {crews.length
                  ? 'Try another search or clear the team filters.'
                  : 'Add a team to start building its composition.'}
              </p>
              {crews.length > 0 && (
                <Button variant="outline" onClick={() => setFilters(initialTeamDirectoryFilters)}>
                  Show all teams
                </Button>
              )}
            </div>
          ) : (
            <Table aria-label="Teams" role="table" className="team-directory-table">
              <TableHeader role="rowgroup">
                <TableRow className="tw:bg-[#f5f7f0]">
                  <TableHead>Team</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Service area</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="tw:sr-only">Open team</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody role="rowgroup">
                {filtered.map((crew) => (
                  <TableRow
                    key={crew.id}
                    role="row"
                    className="tw:hover:bg-[#f8faf4] tw:max-[900px]:border tw:max-[900px]:border-solid tw:max-[900px]:border-[#e1e7da]"
                  >
                    <TableCell className="tw:py-5 tw:align-top tw:max-[900px]:p-0">
                      <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-3">
                        <span className="tw:grid tw:size-10 tw:shrink-0 tw:place-items-center tw:rounded-xl tw:bg-[#edf3e7] tw:text-[#5e7b55]">
                          <Users size={18} aria-hidden="true" />
                        </span>
                        <div className="tw:min-w-0">
                          <p className="tw:mt-0 tw:mb-1 tw:text-[10px] tw:font-semibold tw:tracking-wide tw:text-[#7a8871]">
                            {crew.code}
                          </p>
                          <Link
                            href={`/backoffice/crews/${crew.id}`}
                            className="tw:text-sm tw:leading-relaxed tw:font-semibold tw:text-[#21533b] tw:no-underline tw:underline-offset-4 tw:wrap-anywhere tw:hover:underline"
                          >
                            {crew.name}
                          </Link>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="tw:py-5 tw:align-top tw:max-[900px]:p-0">
                      <span className={mobileLabel}>Environment</span>
                      <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-[#65716a]">
                        {crew.workEnvironment === 'INDOOR' ? (
                          <Building2 size={15} aria-hidden="true" />
                        ) : (
                          <TreePine size={15} aria-hidden="true" />
                        )}
                        {crew.workEnvironment === 'INDOOR' ? 'Indoor' : 'Outdoor'}
                      </span>
                    </TableCell>
                    <TableCell className="tw:py-5 tw:align-top tw:max-[900px]:p-0">
                      <span className={mobileLabel}>Service area</span>
                      <p
                        title={crew.serviceArea}
                        className="tw:m-0 tw:line-clamp-3 tw:text-xs tw:leading-relaxed tw:text-[#65716a] tw:wrap-anywhere"
                      >
                        {crew.serviceArea}
                      </p>
                    </TableCell>
                    <TableCell className="tw:py-5 tw:align-top tw:max-[900px]:p-0">
                      <span className={mobileLabel}>Status</span>
                      <Badge variant={crew.active ? 'success' : 'outline'}>
                        {crew.active ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell className="tw:py-5 tw:align-top tw:max-[900px]:p-0">
                      <Link
                        href={`/backoffice/crews/${crew.id}`}
                        className={buttonVariants({
                          variant: 'ghost',
                          size: 'sm',
                          className: 'tw:-mt-2 tw:gap-1',
                        })}
                        aria-label={`Manage team ${crew.name}`}
                      >
                        Open
                        <ArrowUpRight aria-hidden="true" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}
      <Sheet
        open={creating}
        onOpenChange={(open) => {
          if (!saving) setCreating(open);
        }}
      >
        <SheetContent
          className="teams-theme tw:max-w-[620px]"
          closeLabel="Close add team"
          closeDisabled={saving}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            addTrigger.current?.focus();
          }}
          onInteractOutside={(event) => {
            if (saving) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (saving) event.preventDefault();
          }}
        >
          <SheetHeader>
            <p className="tw:m-0 tw:text-[10px] tw:font-bold tw:tracking-widest tw:text-[#226347] tw:uppercase">
              Build your team
            </p>
            <SheetTitle>Add a team</SheetTitle>
            <SheetDescription>
              Set its coverage and environment, then add people and working hours.
            </SheetDescription>
          </SheetHeader>
          <form
            aria-label="Create team"
            className="tw:grid tw:min-w-0 tw:gap-5"
            onSubmit={(event) => void createTeam(event)}
          >
            <fieldset disabled={saving} className="tw:m-0 tw:min-w-0 tw:border-0 tw:p-0">
              <TeamFields create />
            </fieldset>
            <Feedback error={error} success={null} />
            <div className="tw:flex tw:flex-wrap tw:justify-end tw:gap-2 tw:border-x-0 tw:border-t tw:border-b-0 tw:border-solid tw:border-[#e1e7da] tw:pt-4">
              <Button variant="outline" disabled={saving} onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Creating…' : 'Create team'}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
