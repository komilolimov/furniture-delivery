import { describe, expect, it } from 'vitest';
import {
  failedReturnAttemptFixture,
  plannedReturnDetailFixture,
  returnDetailFixture,
} from '../test/return-fixture';
import {
  isReturnAttemptScope,
  isReturnQueueResponse,
  isReturnRequestResponse,
} from './return-visit-guards';

describe('Return API response validation', () => {
  it('accepts actual OPEN/PLANNED shapes and rejects malformed versions or quantities', () => {
    expect(isReturnRequestResponse({ request: returnDetailFixture })).toBe(true);
    expect(isReturnRequestResponse({ request: plannedReturnDetailFixture })).toBe(true);
    expect(
      isReturnRequestResponse({
        request: {
          ...returnDetailFixture,
          request: { ...returnDetailFixture.request, version: 0 },
        },
      }),
    ).toBe(false);
    expect(
      isReturnAttemptScope({
        tasks: [],
        itemTargets: [{ itemId: 'item', deliveredQuantity: 1, assembledQuantity: 2 }],
      }),
    ).toBe(false);
    expect(isReturnAttemptScope(failedReturnAttemptFixture.scope)).toBe(true);
  });
  it('requires a paginated queue with explicit open-need state', () => {
    const entry = {
      request: plannedReturnDetailFixture.request,
      orderNumber: 'FD-fixture',
      customerName: 'Fixture customer',
      currentAppointmentId: plannedReturnDetailFixture.currentAppointment!.id,
      readyToResolve: false,
    };
    expect(isReturnQueueResponse({ requests: [entry], total: 1, page: 1, pageSize: 20 })).toBe(
      true,
    );
    expect(
      isReturnQueueResponse({
        requests: [{ ...entry, readyToResolve: 'false' }],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    ).toBe(false);
    expect(isReturnQueueResponse({ requests: [entry], total: 1, page: 0, pageSize: 20 })).toBe(
      false,
    );
  });
});
