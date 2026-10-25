import { describe, expect, it } from 'vitest';
import { isAccountResponse } from './contracts-guards';
import { homeForRole, isAuthResponse } from './session';

const user = {
  id: 'user-1',
  username: 'worker',
  displayName: 'Worker',
  role: 'CREW_MEMBER',
  active: true,
  crewIds: ['crew-1'],
};

describe('session roles and runtime validation', () => {
  it('routes staff to the crew workspace and managers to backoffice', () => {
    expect(homeForRole('CREW_MEMBER')).toBe('/crew');
    expect(homeForRole('DISPATCHER')).toBe('/backoffice');
    expect(homeForRole('ADMIN')).toBe('/backoffice');
  });
  it('accepts only active, valid sessions', () => {
    expect(isAuthResponse({ user })).toBe(true);
    expect(isAuthResponse({ user: { ...user, active: false } })).toBe(false);
    expect(isAuthResponse({ user: { ...user, role: 'OWNER' } })).toBe(false);
    expect(isAuthResponse({ user: { ...user, crewIds: [1] } })).toBe(false);
  });
  it('allows an inactive user response from successful administrator mutations', () => {
    expect(isAccountResponse({ user: { ...user, active: false } })).toBe(true);
  });
});
