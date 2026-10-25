'use client';

import type { CrewResponse, ExternalContact } from '@furniture-delivery/contracts';
import { useState, type FormEvent } from 'react';
import { apiRequest, describeError } from '../lib/api-client';
import { isCrewResponse } from '../lib/contracts-guards';
import { Feedback } from './form-parts';

export function ContactForm({
  crewId,
  contact,
  onSaved,
}: Readonly<{
  crewId: string;
  contact?: ExternalContact;
  onSaved: (response: CrewResponse) => void;
}>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiRequest<CrewResponse>(
        `/crews/${crewId}/contacts${contact ? `/${contact.id}` : ''}`,
        {
          method: contact ? 'PATCH' : 'POST',
          body: {
            name: String(data.get('name') ?? '').trim(),
            specialty: String(data.get('specialty') ?? '').trim(),
            phone: String(data.get('phone') ?? '').trim() || null,
            email: String(data.get('email') ?? '').trim() || null,
            active: data.get('active') === 'on',
          },
          validate: isCrewResponse,
        },
      );
      onSaved(response);
      if (!contact) form.reset();
      setSuccess(contact ? 'Contact updated.' : 'Contact added.');
    } catch (error) {
      setError(describeError(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={pending}>
        <label>
          Name
          <input name="name" required maxLength={120} defaultValue={contact?.name} />
        </label>
        <label>
          Specialty
          <input
            name="specialty"
            required
            maxLength={120}
            defaultValue={contact?.specialty}
            placeholder="Electrician, supplier…"
          />
        </label>
        <label>
          Phone
          <input name="phone" type="tel" maxLength={50} defaultValue={contact?.phone ?? ''} />
        </label>
        <label>
          Email
          <input name="email" type="email" maxLength={254} defaultValue={contact?.email ?? ''} />
        </label>
        <label className="checkbox-field">
          <input name="active" type="checkbox" defaultChecked={contact?.active ?? true} />
          Contact enabled
        </label>
      </fieldset>
      <Feedback error={error} success={success} />
      <button className="secondary-button" disabled={pending}>
        {pending ? 'Saving…' : contact ? 'Save contact' : 'Add contact'}
      </button>
    </form>
  );
}
