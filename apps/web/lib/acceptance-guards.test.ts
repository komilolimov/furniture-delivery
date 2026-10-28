import { describe, expect, it } from 'vitest';
import {
  backofficeAcceptanceFixture,
  crewAcceptanceFixture,
  absenceConfirmationFixture,
} from '../test/acceptance-fixture';
import { isBackofficeAcceptanceResponse, isCrewAcceptanceResponse } from './acceptance-guards';
describe('Separate visit acknowledgement response validation', () => {
  it('accepts safe server snapshots and keeps staff/backoffice shapes separate', () => {
    expect(isBackofficeAcceptanceResponse(backofficeAcceptanceFixture)).toBe(true);
    expect(isCrewAcceptanceResponse(crewAcceptanceFixture)).toBe(true);
    expect(isCrewAcceptanceResponse(backofficeAcceptanceFixture)).toBe(false);
    expect(isBackofficeAcceptanceResponse(crewAcceptanceFixture)).toBe(false);
  });
  it('rejects private data, inline PNG bytes and other teams confirmation metadata', () => {
    const privatePayload = structuredClone(crewAcceptanceFixture);
    Object.assign(privatePayload.acceptance.current!.snapshot.payload.order, {
      orderTotalCents: 100,
    });
    expect(isCrewAcceptanceResponse(privatePayload)).toBe(false);
    const inline = structuredClone(backofficeAcceptanceFixture);
    Object.assign(inline.acceptance.current!.snapshot, { png: 'not-a-public-field' });
    expect(isBackofficeAcceptanceResponse(inline)).toBe(false);
    const anotherTeam = structuredClone(crewAcceptanceFixture);
    anotherTeam.acceptance.current!.slots[2]!.confirmation = absenceConfirmationFixture;
    expect(isCrewAcceptanceResponse(anotherTeam)).toBe(false);
  });
  it('rejects invalid snapshot hashes and malformed accumulated quantities', () => {
    const invalid = structuredClone(backofficeAcceptanceFixture);
    invalid.acceptance.current!.snapshot.hash = 'bad';
    expect(isBackofficeAcceptanceResponse(invalid)).toBe(false);
    invalid.acceptance.current!.snapshot.hash = 'a'.repeat(64);
    invalid.acceptance.current!.snapshot.payload.teams[0]!.quantities[0]!.assembledQuantity = 9;
    expect(isBackofficeAcceptanceResponse(invalid)).toBe(false);
  });
});
