import { describe, expect, it } from 'vitest';
import { orderFixture, paymentFixture } from '../test/order-fixture';
import {
  isDashboardResponse,
  isOrderResponse,
  isPaymentResponse,
  isOrderListResponse,
} from './order-guards';

describe('M3 runtime response contracts', () => {
  it('requires complete assigned-crew projections on list and detail responses', () => {
    const crew = { id: 'crew-id', code: 'TEAM-01', name: 'Assigned team' };
    expect(isOrderResponse({ order: { ...orderFixture, assignedCrews: [crew] } })).toBe(true);
    for (const assignedCrews of [
      undefined,
      null,
      {},
      [null],
      [{ id: crew.id }],
      [{ ...crew, name: 42 }],
    ]) {
      const order = { ...orderFixture, assignedCrews };
      expect(isOrderResponse({ order })).toBe(false);
      expect(isOrderListResponse({ orders: [order], total: 1, page: 1, pageSize: 10 })).toBe(false);
    }
  });
  it('checks nested payments/items/history and rejects broken responses', () => {
    expect(isOrderResponse({ order: orderFixture })).toBe(true);
    expect(isPaymentResponse({ order: orderFixture, payment: paymentFixture })).toBe(true);
    expect(isOrderResponse({ order: { ...orderFixture, items: [{ id: 'incomplete' }] } })).toBe(
      false,
    );
    expect(
      isOrderResponse({
        order: { ...orderFixture, payments: [{ ...paymentFixture, amountCents: 1.2 }] },
      }),
    ).toBe(false);
    expect(isOrderResponse({ order: { ...orderFixture, activity: [{ action: 'MADE_UP' }] } })).toBe(
      false,
    );
    expect(isOrderResponse({ order: { ...orderFixture, hasElevator: 'unknown' } })).toBe(false);
    expect(isOrderListResponse({ orders: [orderFixture], total: 1, page: 1, pageSize: 10 })).toBe(
      true,
    );
    expect(
      isDashboardResponse({
        inboxCount: 1,
        plannedCount: 0,
        assignedCount: 0,
        inProgressCount: 0,
        partiallyCompletedCount: 0,
        requiresAttentionCount: 0,
        awaitingReviewCount: 0,
        completedCount: 0,
        openIssueCount: 0,
        returnVisitRequiredCount: 0,
        orderTotalCents: 100,
        paidCents: 50,
        balanceCents: 50,
        currency: 'EUR',
      }),
    ).toBe(true);
    expect(
      isDashboardResponse({
        inboxCount: 1,
        plannedCount: 0,
        assignedCount: 0,
        inProgressCount: 0,
        partiallyCompletedCount: 0,
        requiresAttentionCount: 0,
        awaitingReviewCount: 0,
        completedCount: 0,
        openIssueCount: 0,
        returnVisitRequiredCount: 0,
        orderTotalCents: 100,
        paidCents: 50,
        balanceCents: 50,
        currency: 'USD',
      }),
    ).toBe(false);
  });
});
