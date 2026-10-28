import type { CrewMembership, ExternalContact } from '@furniture-delivery/contracts';
import { Mail, Phone, ShieldAlert, UserCheck, UserMinus, UserRound, Wrench } from 'lucide-react';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { buttonVariants } from './ui/button';

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toLocaleUpperCase('en-GB');
}

export function StaffMemberCard({
  member,
  currentUserId,
}: Readonly<{ member: CrewMembership; currentUserId: string }>) {
  const own = member.user.id === currentUserId;
  const name = initials(member.user.displayName);
  const MembershipIcon = member.active ? UserCheck : UserMinus;
  return (
    <article
      aria-label={`Team member ${member.user.displayName}`}
      className={cn(
        'tw:flex tw:min-w-0 tw:flex-col tw:gap-4 tw:rounded-2xl tw:border tw:border-solid tw:p-4',
        own ? 'tw:border-[#cbdcc0] tw:bg-[#f5f9ef]' : 'tw:border-[#e0e7d9] tw:bg-white',
      )}
    >
      <div className="tw:flex tw:min-w-0 tw:items-start tw:gap-3">
        <span
          aria-hidden="true"
          className="tw:flex tw:size-11 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-xl tw:border tw:border-solid tw:border-[#dce5d1] tw:bg-[#edf3e5] tw:text-sm tw:font-semibold tw:text-[#60804d]"
        >
          {name || <UserRound size={19} strokeWidth={1.75} aria-hidden="true" />}
        </span>
        <div className="tw:min-w-0 tw:flex-1">
          <div className="tw:flex tw:flex-wrap tw:items-start tw:gap-2">
            <h4 className="tw:m-0 tw:min-w-0 tw:text-sm tw:leading-relaxed tw:font-semibold tw:text-[#18372e] tw:wrap-anywhere">
              {member.user.displayName}
            </h4>
            {own && <Badge variant="default">You</Badge>}
          </div>
          <p className="tw:mt-1.5 tw:mb-0 tw:text-[11px] tw:leading-relaxed tw:text-[#7a8871] tw:wrap-anywhere">
            @{member.user.username}
          </p>
        </div>
      </div>
      <div className="tw:flex tw:flex-wrap tw:gap-2">
        <Badge variant={member.active ? 'success' : 'outline'}>
          <MembershipIcon aria-hidden="true" size={13} className="tw:size-[13px]" />
          {member.active ? 'Active member' : 'Inactive member'}
        </Badge>
        {!member.user.active && (
          <Badge variant="warning">
            <ShieldAlert aria-hidden="true" size={13} className="tw:size-[13px]" />
            Account disabled
          </Badge>
        )}
      </div>
    </article>
  );
}

export function StaffContactCard({ contact }: Readonly<{ contact: ExternalContact }>) {
  const hasDetails = Boolean(contact.phone || contact.email);
  return (
    <article
      aria-label={`External specialist ${contact.name}`}
      className="tw:flex tw:min-w-0 tw:flex-col tw:gap-4 tw:rounded-2xl tw:border tw:border-solid tw:border-[#e0e7d9] tw:bg-white tw:p-4"
    >
      <div className="tw:flex tw:min-w-0 tw:items-start tw:gap-3">
        <span className="tw:flex tw:size-11 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-xl tw:border tw:border-solid tw:border-[#e8dfca] tw:bg-[#fbf4e6] tw:text-[#a18048]">
          <Wrench size={20} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="tw:min-w-0 tw:flex-1">
          <h4 className="tw:m-0 tw:text-sm tw:leading-relaxed tw:font-semibold tw:text-[#18372e] tw:wrap-anywhere">
            {contact.name}
          </h4>
          <p className="tw:mt-1.5 tw:mb-0 tw:text-xs tw:leading-relaxed tw:text-[#71806a] tw:wrap-anywhere">
            {contact.specialty || 'Specialty not specified'}
          </p>
        </div>
      </div>
      <div className="tw:flex tw:flex-wrap tw:gap-2">
        <Badge variant="secondary">External contact</Badge>
        <Badge variant={contact.active ? 'success' : 'outline'}>
          {contact.active ? 'Enabled' : 'Disabled'}
        </Badge>
      </div>
      {hasDetails ? (
        <div className="tw:mt-auto tw:grid tw:min-w-0 tw:gap-2">
          {contact.phone && (
            <a
              aria-label={`Call ${contact.name}`}
              href={`tel:${contact.phone}`}
              className={buttonVariants({
                variant: 'outline',
                className:
                  'tw:min-h-12 tw:w-full tw:justify-start tw:px-3 tw:py-3 tw:max-[600px]:text-sm',
              })}
            >
              <Phone aria-hidden="true" />
              <span className="tw:min-w-0 tw:whitespace-normal tw:wrap-anywhere">
                {contact.phone}
              </span>
            </a>
          )}
          {contact.email && (
            <a
              aria-label={`Email ${contact.name}`}
              href={`mailto:${contact.email}`}
              className={buttonVariants({
                variant: 'outline',
                className:
                  'tw:min-h-12 tw:w-full tw:justify-start tw:px-3 tw:py-3 tw:max-[600px]:text-sm',
              })}
            >
              <Mail aria-hidden="true" />
              <span className="tw:min-w-0 tw:whitespace-normal tw:wrap-anywhere">
                {contact.email}
              </span>
            </a>
          )}
        </div>
      ) : (
        <p className="tw:mt-auto tw:mb-0 tw:rounded-xl tw:bg-[#f5f7f0] tw:px-3 tw:py-3 tw:text-[11px] tw:leading-relaxed tw:text-[#819072]">
          No contact details provided.
        </p>
      )}
    </article>
  );
}
