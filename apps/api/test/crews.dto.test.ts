import { describe, expect, it } from 'vitest';
import { CrewDto } from '../src/crews/crews.dto';

const validCrew = {
  code: 'NEW-01',
  name: 'New crew',
  workEnvironment: 'INDOOR',
  serviceArea: 'Demo area',
};

describe('crew request validation', () => {
  it('accepts a valid creation and explicit false, with trimmed public text', () => {
    expect(CrewDto.create({ ...validCrew, name: ' New crew ', active: false })).toEqual({
      ...validCrew,
      active: false,
    });
    expect(CrewDto.update({ active: false })).toEqual({ active: false });
  });

  it.each([
    null,
    [],
    'crew',
    {},
    { ...validCrew, name: '' },
    { ...validCrew, workEnvironment: 'OTHER' },
    { ...validCrew, active: 'true' },
    { ...validCrew, serviceArea: 'x'.repeat(2001) },
    { ...validCrew, code: 'lowercase' },
    { ...validCrew, passwordHash: 'hidden' },
  ])('rejects malformed or overprivileged creation: %j', (body) => {
    expect(() => CrewDto.create(body)).toThrow();
  });

  it.each([{}, { code: 'CHANGED' }, { active: 1 }, { name: ' ' }, { workEnvironment: null }])(
    'rejects empty, immutable or malformed updates: %j',
    (body) => {
      expect(() => CrewDto.update(body)).toThrow();
    },
  );

  it('requires a UUID and rejects membership mass assignment', () => {
    expect(CrewDto.addMember({ userId: '621abb53-a6c7-464e-8763-d7080ae08847' }).userId).toBe(
      '621abb53-a6c7-464e-8763-d7080ae08847',
    );
    expect(() => CrewDto.addMember({ userId: 'invalid' })).toThrow();
    expect(() =>
      CrewDto.addMember({ userId: '621abb53-a6c7-464e-8763-d7080ae08847', role: 'ADMIN' }),
    ).toThrow();
    expect(() => CrewDto.membership({})).toThrow();
    expect(CrewDto.membership({ active: false })).toEqual({ active: false });
  });

  it('keeps contacts separate from accounts and validates optional contact fields', () => {
    expect(
      CrewDto.createContact({
        name: 'Demo Electrician',
        specialty: 'Electrical',
        phone: '+39 000 000000',
        email: null,
      }),
    ).toEqual({
      name: 'Demo Electrician',
      specialty: 'Electrical',
      phone: '+39 000 000000',
      email: null,
    });
    expect(CrewDto.updateContact({ phone: '', email: '' })).toEqual({ phone: null, email: null });
    expect(() =>
      CrewDto.createContact({ name: 'Demo', specialty: ' ', password: 'unexpected' }),
    ).toThrow();
    expect(() =>
      CrewDto.createContact({ name: 'Demo', specialty: 'Assembly', email: 'invalid' }),
    ).toThrow();
    expect(() => CrewDto.updateContact({})).toThrow();
  });
});
