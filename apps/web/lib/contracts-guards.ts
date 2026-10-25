import type {
  AuthResponse,
  AuthUser,
  CrewDetail,
  CrewListResponse,
  CrewResponse,
  CrewSummary,
  MemberCandidatesResponse,
  PublicUser,
  UsersResponse,
} from '@furniture-delivery/contracts';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isPublicUser(value: unknown): value is PublicUser {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    typeof value.username === 'string' &&
    typeof value.displayName === 'string' &&
    ['ADMIN', 'DISPATCHER', 'CREW_MEMBER'].includes(String(value.role)) &&
    typeof value.active === 'boolean'
  );
}

export function isAuthUser(value: unknown): value is AuthUser {
  return (
    isPublicUser(value) &&
    'crewIds' in value &&
    Array.isArray(value.crewIds) &&
    value.crewIds.every((id: unknown) => typeof id === 'string')
  );
}

function isCrewSummary(value: unknown): value is CrewSummary {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    typeof value.code === 'string' &&
    typeof value.name === 'string' &&
    typeof value.active === 'boolean' &&
    ['INDOOR', 'OUTDOOR'].includes(String(value.workEnvironment)) &&
    typeof value.serviceArea === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function isCrewDetail(value: unknown): value is CrewDetail {
  if (!isCrewSummary(value) || !('members' in value) || !('contacts' in value)) return false;
  return (
    Array.isArray(value.members) &&
    value.members.every(
      (member: unknown) =>
        record(member) &&
        typeof member.id === 'string' &&
        typeof member.userId === 'string' &&
        typeof member.crewId === 'string' &&
        typeof member.active === 'boolean' &&
        isPublicUser(member.user),
    ) &&
    Array.isArray(value.contacts) &&
    value.contacts.every(
      (contact: unknown) =>
        record(contact) &&
        typeof contact.id === 'string' &&
        typeof contact.crewId === 'string' &&
        typeof contact.name === 'string' &&
        typeof contact.specialty === 'string' &&
        (contact.phone === null || typeof contact.phone === 'string') &&
        (contact.email === null || typeof contact.email === 'string') &&
        typeof contact.active === 'boolean',
    )
  );
}

export function isCrewListResponse(value: unknown): value is CrewListResponse {
  return record(value) && Array.isArray(value.crews) && value.crews.every(isCrewSummary);
}

export function isCrewResponse(value: unknown): value is CrewResponse {
  return record(value) && isCrewDetail(value.crew);
}

export function isUsersResponse(value: unknown): value is UsersResponse {
  return record(value) && Array.isArray(value.users) && value.users.every(isAuthUser);
}

export function isMemberCandidatesResponse(value: unknown): value is MemberCandidatesResponse {
  return record(value) && Array.isArray(value.users) && value.users.every(isPublicUser);
}

export function isAccountResponse(value: unknown): value is AuthResponse {
  return record(value) && isAuthUser(value.user);
}
