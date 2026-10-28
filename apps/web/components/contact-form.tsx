'use client';

import type { CrewResponse, ExternalContact } from '@furniture-delivery/contracts';
import { useState, type FormEvent } from 'react';
import { apiRequest, describeError } from '../lib/api-client';
import { isCrewResponse } from '../lib/contracts-guards';
import { Feedback } from './form-parts';
import { DraftChangeNotice } from './draft-change-notice';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Plus, Save } from 'lucide-react';
import './team-availability.css';

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
    <form
      className="team-contact-form"
      aria-label={contact ? `Edit contact ${contact.name}` : 'Add external contact'}
      onSubmit={(event) => void submit(event)}
    >
      <DraftChangeNotice paths={[`/crews/${crewId}`]} />
      <fieldset
        disabled={pending}
        className="tw:m-0 tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-4 tw:border-0 tw:p-0 tw:max-[600px]:grid-cols-1"
      >
        <label className="team-availability-field">
          Name
          <Input name="name" required maxLength={120} defaultValue={contact?.name} />
        </label>
        <label className="team-availability-field">
          Specialty
          <Input
            name="specialty"
            required
            maxLength={120}
            defaultValue={contact?.specialty}
            placeholder="Electrician, supplier…"
          />
        </label>
        <label className="team-availability-field">
          Phone
          <Input name="phone" type="tel" maxLength={50} defaultValue={contact?.phone ?? ''} />
        </label>
        <label className="team-availability-field">
          Email
          <Input name="email" type="email" maxLength={254} defaultValue={contact?.email ?? ''} />
        </label>
        <label className="checkbox-field tw:col-span-full">
          <input name="active" type="checkbox" defaultChecked={contact?.active ?? true} />
          Contact enabled
        </label>
      </fieldset>
      <Feedback error={error} success={success} />
      <Button type="submit" variant="outline" className="tw:w-fit" disabled={pending}>
        {contact ? <Save aria-hidden="true" /> : <Plus aria-hidden="true" />}
        {pending ? 'Saving…' : contact ? 'Save contact' : 'Add contact'}
      </Button>
    </form>
  );
}
