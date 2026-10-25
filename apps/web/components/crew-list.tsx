'use client';

import type { CrewListResponse, CrewResponse } from '@furniture-delivery/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { apiRequest, describeError } from '../lib/api-client';
import { isCrewListResponse, isCrewResponse } from '../lib/contracts-guards';
import { useApiResource } from '../lib/use-api-resource';
import { CrewFields, crewFormValues, Feedback, ResourceNotice } from './form-parts';

export function CrewList() {
  const resource = useApiResource<CrewListResponse>('/crews', isCrewListResponse);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      await resource.refresh();
    } catch (error) {
      setError(describeError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Backoffice</p>
          <h1>Teams</h1>
          <p>Manage team details, members and external specialists.</p>
        </div>
      </div>
      <details className="content-card create-panel">
        <summary>Add a team</summary>
        <form className="form-grid" onSubmit={(event) => void createTeam(event)}>
          <fieldset disabled={saving}>
            <CrewFields create />
          </fieldset>
          <Feedback error={error} success={success} />
          <button className="primary-button" disabled={saving}>
            {saving ? 'Creating…' : 'Create team'}
          </button>
        </form>
      </details>
      <ResourceNotice
        pending={resource.pending}
        error={resource.error}
        retry={() => void resource.refresh()}
      />
      {!resource.pending &&
        resource.data &&
        (resource.data.crews.length === 0 ? (
          <div className="empty-state">
            <h2>No teams yet</h2>
            <p>Add a team to start building its composition.</p>
          </div>
        ) : (
          <div className="team-grid">
            {resource.data.crews.map((crew) => (
              <Link className="team-card" key={crew.id} href={`/backoffice/crews/${crew.id}`}>
                <div className="card-line">
                  <span className="eyebrow">{crew.code}</span>
                  <span className={`service-badge ${crew.active ? 'up' : 'unknown'}`}>
                    {crew.active ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <h2>{crew.name}</h2>
                <p>{crew.serviceArea}</p>
                <div className="team-card-footer">
                  <span>{crew.workEnvironment === 'INDOOR' ? 'Indoor' : 'Outdoor'}</span>
                  <span>Manage team →</span>
                </div>
              </Link>
            ))}
          </div>
        ))}
    </>
  );
}
