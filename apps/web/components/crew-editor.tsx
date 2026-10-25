'use client';

import type { CrewResponse, MemberCandidatesResponse } from '@furniture-delivery/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { apiRequest, describeError } from '../lib/api-client';
import { isCrewResponse, isMemberCandidatesResponse } from '../lib/contracts-guards';
import { useApiResource } from '../lib/use-api-resource';
import { ContactForm } from './contact-form';
import { CrewFields, crewFormValues, Feedback, ResourceNotice } from './form-parts';

export function CrewEditor({ crewId }: Readonly<{ crewId: string }>) {
  const resource = useApiResource<CrewResponse>(`/crews/${crewId}`, isCrewResponse);
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

  async function saveCrew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = crewFormValues(event.currentTarget);
    setSaving(true);
    setEditError(null);
    setEditSuccess(null);
    try {
      resource.setData(
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

  async function membershipAction(path: string, method: 'POST' | 'PATCH', body: unknown) {
    setMemberPending(true);
    setMemberError(null);
    setMemberSuccess(null);
    try {
      resource.setData(
        await apiRequest<CrewResponse>(path, { method, body, validate: isCrewResponse }),
      );
      setMemberSuccess('Team membership updated.');
      await candidates.refresh();
    } catch (error) {
      setMemberError(describeError(error));
    } finally {
      setMemberPending(false);
    }
  }

  function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void membershipAction(`/crews/${crewId}/members`, 'POST', {
      userId: String(data.get('userId') ?? ''),
    });
  }

  const crew = resource.data?.crew;
  return (
    <>
      <Link className="muted-link" href="/backoffice">
        ← All teams
      </Link>
      <ResourceNotice
        pending={resource.pending}
        error={resource.error}
        retry={() => void resource.refresh()}
      />
      {!resource.pending && crew && (
        <>
          <div className="page-heading">
            <div>
              <p className="eyebrow">{crew.code}</p>
              <h1>{crew.name}</h1>
              <p>Team details and composition</p>
            </div>
            <span className={`service-badge ${crew.active ? 'up' : 'unknown'}`}>
              {crew.active ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <section className="content-card">
            <h2>Team details</h2>
            <p className="section-copy">The stable team code stays with its history.</p>
            <form
              className="form-grid"
              onSubmit={(event) => void saveCrew(event)}
              key={crew.updatedAt}
            >
              <fieldset disabled={saving}>
                <CrewFields crew={crew} />
              </fieldset>
              <Feedback error={editError} success={editSuccess} />
              <button className="primary-button" disabled={saving}>
                {saving ? 'Saving…' : 'Save team'}
              </button>
            </form>
          </section>
          <section className="content-card">
            <h2>Team members</h2>
            <p className="section-copy">Each employee can have one active team membership.</p>
            {crew.members.length === 0 ? (
              <p className="empty-copy">No team members yet.</p>
            ) : (
              <ul className="person-list">
                {crew.members.map((member) => (
                  <li key={member.id}>
                    <div>
                      <strong>{member.user.displayName}</strong>
                      <small>
                        {member.user.username} ·{' '}
                        {member.active ? 'Active membership' : 'Inactive membership'}
                        {!member.user.active && ' · Account disabled'}
                      </small>
                    </div>
                    <button
                      className="secondary-button"
                      disabled={memberPending}
                      onClick={() =>
                        void membershipAction(`/crews/${crewId}/members/${member.id}`, 'PATCH', {
                          active: !member.active,
                        })
                      }
                    >
                      {member.active ? 'Deactivate membership' : 'Reactivate membership'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Feedback error={memberError} success={memberSuccess} />
            <ResourceNotice
              pending={candidates.pending}
              error={candidates.error}
              retry={() => void candidates.refresh()}
            />
            {!candidates.pending &&
              candidates.data &&
              (candidates.data.users.length === 0 ? (
                <p className="empty-copy">
                  No employee accounts available. An administrator can create employee accounts.
                </p>
              ) : (
                <form className="inline-form" onSubmit={addMember}>
                  <label>
                    Add employee
                    <select name="userId" required disabled={memberPending} defaultValue="">
                      <option value="" disabled>
                        Select an employee
                      </option>
                      {candidates.data.users.map((user) => (
                        <option key={user.id} value={user.id} disabled={!user.active}>
                          {user.displayName} ({user.username})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="primary-button" disabled={memberPending}>
                    {memberPending ? 'Updating…' : 'Add member'}
                  </button>
                </form>
              ))}
          </section>
          <section className="content-card">
            <h2>External specialists</h2>
            <p className="section-copy">
              Contacts for this team. These contacts do not have an application account.
            </p>
            {crew.contacts.length === 0 && <p className="empty-copy">No external contacts yet.</p>}
            {crew.contacts.map((contact) => (
              <details className="contact-editor" key={contact.id}>
                <summary>
                  {contact.name} · {contact.specialty}
                  {!contact.active && ' · Disabled'}
                </summary>
                <ContactForm crewId={crew.id} contact={contact} onSaved={resource.setData} />
              </details>
            ))}
            <details className="contact-editor">
              <summary>Add an external contact</summary>
              <ContactForm crewId={crew.id} onSaved={resource.setData} />
            </details>
          </section>
        </>
      )}
    </>
  );
}
