'use client';
import { useState } from 'react';
import type {
  SlotCandidate,
  SlotSearchQuery,
  SlotSearchResponse,
} from '@furniture-delivery/contracts';
import { businessToday, displayRome, shiftBusinessDate } from '../lib/business-time';
import { isSlotSearchResponse } from '../lib/rescheduling-guards';
import { useOrderResource } from '../lib/use-order-resource';
import { ResourceNotice } from './form-parts';
import './rescheduling.css';

function searchPath(query: SlotSearchQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined)
      params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  return `/planning/available-windows?${params}`;
}
function SlotResults({
  path,
  disabled,
  onSelect,
}: {
  path: string;
  disabled: boolean;
  onSelect: (candidate: SlotCandidate) => void;
}) {
  const resource = useOrderResource<SlotSearchResponse>(path, isSlotSearchResponse);
  return (
    <div aria-label="Available time results">
      <ResourceNotice
        pending={resource.pending}
        error={resource.error}
        retry={() => void resource.refresh()}
      />
      {resource.data && (
        <>
          <p className="section-copy">
            Calculated {displayRome(resource.data.dataAsOf)} · {resource.data.from} to{' '}
            {resource.data.to} (end exclusive), Europe/Rome. Search does not reserve a slot.
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={resource.pending || disabled}
            onClick={() => void resource.refresh()}
          >
            Refresh available windows
          </button>
          {resource.data.message && <p role="status">{resource.data.message}</p>}
          {resource.data.blockedCrews.length > 0 && (
            <ul>
              {resource.data.blockedCrews.map((crew) => (
                <li key={crew.crewId}>
                  <strong>{crew.crewName}:</strong> {crew.message}
                </li>
              ))}
            </ul>
          )}
          {!resource.data.candidates.length && (
            <p className="empty-copy">No available windows in this range.</p>
          )}
          <ol className="slot-results">
            {resource.data.candidates.map((candidate) => (
              <li key={`${candidate.plannedStartAt}:${candidate.crewIds.join(',')}`}>
                <strong>
                  {displayRome(candidate.plannedStartAt)} – {displayRome(candidate.plannedEndAt)}
                </strong>
                <p>
                  {candidate.crews
                    .map(
                      (crew) =>
                        `${crew.name} · ${crew.workEnvironment.toLowerCase()} · ${crew.serviceArea} · buffer ${crew.travelBufferMinutes} min`,
                    )
                    .join('; ')}
                </p>
                <p>
                  Basis: {candidate.basis.toLowerCase()}. {candidate.notes.join(' ')}
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled || resource.pending}
                  onClick={() => onSelect(candidate)}
                >
                  Preview this window
                </button>
              </li>
            ))}
          </ol>
          {resource.data.limited && (
            <p role="status">
              Showing the first 20 windows. This is a limited list, not every possible option.
            </p>
          )}
        </>
      )}
    </div>
  );
}
/** Selection only previews a window. The parent owns its explicit, versioned mutation. */
export function SlotFinder({
  query,
  onSelect,
  disabled = false,
}: Readonly<{
  query: SlotSearchQuery;
  onSelect: (candidate: SlotCandidate) => void;
  disabled?: boolean;
}>) {
  const [earliest, setEarliest] = useState(query.earliestLocal),
    [from, setFrom] = useState(query.from ?? query.earliestLocal.slice(0, 10)),
    [to, setTo] = useState(query.to ?? shiftBusinessDate(query.earliestLocal.slice(0, 10), 14));
  const [alternatives, setAlternatives] = useState(query.alternativeCrews),
    [requested, setRequested] = useState<string | null>(null);
  const current = searchPath({
    ...query,
    earliestLocal: earliest,
    from,
    to,
    alternativeCrews: query.crewIds.length === 1 && alternatives,
  });
  const stale = requested !== null && requested !== current;
  const chooseDate = (date: string) => {
    setEarliest(`${date}T09:00`);
    setFrom(date);
    setTo(shiftBusinessDate(date, 14));
  };
  return (
    <section className="slot-finder" aria-label="Find available time">
      <h3>Find available time</h3>
      <p className="section-copy">
        {query.durationMinutes} minutes · {query.crewIds.length} selected teams. Each complete visit
        and travel buffer must fit one working window. Estimates are forecasts, not guarantees.
      </p>
      <fieldset disabled={disabled} className="slot-controls">
        <legend>Search range · Europe/Rome</legend>
        <div className="button-row">
          <button
            type="button"
            className="secondary-button"
            onClick={() => chooseDate(businessToday())}
          >
            Search today
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => chooseDate(shiftBusinessDate(businessToday(), 1))}
          >
            Search tomorrow
          </button>
        </div>
        <label>
          Earliest local start
          <input
            type="datetime-local"
            value={earliest}
            onChange={(e) => setEarliest(e.target.value)}
          />
        </label>
        <label>
          Search from
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Search until (exclusive)
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={query.crewIds.length === 1 && alternatives}
            disabled={query.crewIds.length !== 1}
            onChange={(e) => setAlternatives(e.target.checked)}
          />
          Include alternative active teams (one selected team only)
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={!query.crewIds.length || !earliest || !from || !to}
          onClick={() => setRequested(current)}
        >
          Find windows
        </button>
      </fieldset>
      {stale && (
        <p className="conflict-notice" role="status">
          Search settings changed. Run Find windows again before selecting an option.
        </p>
      )}
      {requested && (
        <SlotResults
          key={requested}
          path={requested}
          disabled={disabled || stale}
          onSelect={onSelect}
        />
      )}
    </section>
  );
}
