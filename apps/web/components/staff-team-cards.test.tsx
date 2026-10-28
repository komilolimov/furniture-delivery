import type { CrewMembership, ExternalContact } from '@furniture-delivery/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StaffContactCard, StaffMemberCard } from './staff-team-cards';

const instant = '2030-01-07T08:00:00.000Z';
const member: CrewMembership = {
  id: 'member-1',
  userId: 'staff-1',
  crewId: 'crew-1',
  active: true,
  createdAt: instant,
  updatedAt: instant,
  user: {
    id: 'staff-1',
    displayName: 'Fixture colleague',
    username: 'fixture.worker',
    role: 'CREW_MEMBER',
    active: true,
  },
};
const contact: ExternalContact = {
  id: 'contact-1',
  crewId: 'crew-1',
  name: 'Fixture specialist',
  specialty: 'Electrical installation',
  phone: '+39 000 123 456',
  email: 'specialist@example.test',
  active: true,
  createdAt: instant,
  updatedAt: instant,
};

describe('Read-only staff team cards', () => {
  it('identifies the signed-in member without inventing contact actions or online status', () => {
    render(<StaffMemberCard member={member} currentUserId={member.user.id} />);
    const card = screen.getByRole('article', { name: 'Team member Fixture colleague' });
    expect(
      within(card).getByRole('heading', { name: member.user.displayName }),
    ).toBeInTheDocument();
    expect(within(card).getByText('@fixture.worker')).toBeInTheDocument();
    expect(within(card).getByText('You')).toBeInTheDocument();
    expect(within(card).getByText('Active member')).toBeInTheDocument();
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(within(card).queryByText(/online|available now/i)).not.toBeInTheDocument();
  });

  it('keeps an inactive membership distinct from an enabled account', () => {
    render(<StaffMemberCard member={{ ...member, active: false }} currentUserId="other-staff" />);
    expect(screen.getByText('Inactive member')).toBeInTheDocument();
    expect(screen.queryByText('Account disabled')).not.toBeInTheDocument();
    expect(screen.queryByText('You')).not.toBeInTheDocument();
  });

  it('shows account disablement independently of active membership', () => {
    render(
      <StaffMemberCard
        member={{ ...member, user: { ...member.user, active: false } }}
        currentUserId="other-staff"
      />,
    );
    expect(screen.getByText('Active member')).toBeInTheDocument();
    expect(screen.getByText('Account disabled')).toBeInTheDocument();
    expect(screen.queryByText('Inactive member')).not.toBeInTheDocument();
  });

  it('provides exact phone and email destinations with descriptive accessible actions', () => {
    const { container } = render(<StaffContactCard contact={contact} />);
    const card = screen.getByRole('article', { name: 'External specialist Fixture specialist' });
    expect(within(card).getByText('Electrical installation')).toBeInTheDocument();
    expect(within(card).getByText('External contact')).toBeInTheDocument();
    expect(within(card).getByText('Enabled')).toBeInTheDocument();
    const call = within(card).getByRole('link', { name: 'Call Fixture specialist' });
    const email = within(card).getByRole('link', { name: 'Email Fixture specialist' });
    expect(call).toHaveAttribute('href', `tel:${contact.phone}`);
    expect(call).toHaveTextContent(contact.phone!);
    expect(email).toHaveAttribute('href', `mailto:${contact.email}`);
    expect(email).toHaveTextContent(contact.email!);
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelector('svg:not([aria-hidden="true"])')).toBeNull();
  });

  it('omits unavailable contact links instead of creating empty or guessed destinations', () => {
    render(<StaffContactCard contact={{ ...contact, phone: null, email: '' }} />);
    expect(screen.getByText('No contact details provided.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(contact.phone!)).not.toBeInTheDocument();
    expect(screen.queryByText(contact.email!)).not.toBeInTheDocument();
  });

  it('retains disabled contact details as read-only history and renders no extra private fields', () => {
    const record = {
      ...contact,
      active: false,
      internalNotes: 'Private fixture note',
      passwordHash: 'Private fixture hash',
      payments: [{ note: 'Private fixture payment' }],
    };
    render(<StaffContactCard contact={record} />);
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call Fixture specialist' })).toHaveAttribute(
      'href',
      `tel:${contact.phone}`,
    );
    expect(screen.getByRole('link', { name: 'Email Fixture specialist' })).toHaveAttribute(
      'href',
      `mailto:${contact.email}`,
    );
    expect(screen.queryByText(/Private fixture/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
});
