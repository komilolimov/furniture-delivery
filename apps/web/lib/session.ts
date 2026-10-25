import type { AuthResponse, AuthUser, UserRole } from '@furniture-delivery/contracts';

export function homeForRole(role: UserRole): '/crew' | '/backoffice' {
  return role === 'CREW_MEMBER' ? '/crew' : '/backoffice';
}

export function isAuthResponse(value: unknown): value is AuthResponse {
  if (typeof value !== 'object' || value === null || !('user' in value)) return false;
  const user: unknown = value.user;
  if (typeof user !== 'object' || user === null) return false;
  const record = user as Record<keyof AuthUser, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.username === 'string' &&
    typeof record.displayName === 'string' &&
    ['ADMIN', 'DISPATCHER', 'CREW_MEMBER'].includes(String(record.role)) &&
    record.active === true &&
    Array.isArray(record.crewIds) &&
    record.crewIds.every((id: unknown) => typeof id === 'string')
  );
}
