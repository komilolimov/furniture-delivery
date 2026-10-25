'use client';

import type { CrewListResponse, CrewResponse } from '@furniture-delivery/contracts';
import { isCrewListResponse, isCrewResponse } from '../lib/contracts-guards';
import { useApiResource } from '../lib/use-api-resource';
import { ResourceNotice } from './form-parts';

function StaffTeam({ crewId }: Readonly<{ crewId: string }>) {
  const resource = useApiResource<CrewResponse>(`/crews/${crewId}`, isCrewResponse);
  const crew = resource.data?.crew;
  return (
    <section className="content-card">
      <ResourceNotice
        pending={resource.pending}
        error={resource.error}
        retry={() => void resource.refresh()}
      />
      {!resource.pending && crew && (
        <>
          <p className="eyebrow">{crew.code}</p>
          <h2>{crew.name}</h2>
          <p className="section-copy">
            {crew.workEnvironment === 'INDOOR' ? 'Indoor' : 'Outdoor'} · {crew.serviceArea}
          </p>
          <h3>Team composition</h3>
          {crew.members.length === 0 ? (
            <p className="empty-copy">No team members to display.</p>
          ) : (
            <ul className="person-list">
              {crew.members.map((member) => (
                <li key={member.id}>
                  <div>
                    <strong>{member.user.displayName}</strong>
                    <small>
                      {member.active ? 'Active member' : 'Inactive member'}
                      {!member.user.active && ' · Account disabled'}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h3>External specialists</h3>
          {crew.contacts.length === 0 ? (
            <p className="empty-copy">No external contacts.</p>
          ) : (
            <ul className="person-list">
              {crew.contacts.map((contact) => (
                <li key={contact.id}>
                  <div>
                    <strong>{contact.name}</strong>
                    <small>
                      {contact.specialty}
                      {!contact.active && ' · Disabled'}
                    </small>
                    {contact.phone && <p>{contact.phone}</p>}
                    {contact.email && <p>{contact.email}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export function StaffTeams() {
  const resource = useApiResource<CrewListResponse>('/crews', isCrewListResponse);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1>My team</h1>
          <p>Your current team and the people you work with.</p>
        </div>
      </div>
      <ResourceNotice
        pending={resource.pending}
        error={resource.error}
        retry={() => void resource.refresh()}
      />
      {!resource.pending &&
        resource.data &&
        (resource.data.crews.length === 0 ? (
          <div className="empty-state">
            <h2>No team assignment</h2>
            <p>You do not currently have access to a team. Contact your dispatcher.</p>
          </div>
        ) : (
          resource.data.crews.map((crew) => <StaffTeam crewId={crew.id} key={crew.id} />)
        ))}
    </>
  );
}
