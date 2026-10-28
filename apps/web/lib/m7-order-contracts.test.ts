import { describe, expect, it } from 'vitest';
import { isOrderDetail, isOrderSummary } from './order-guards';
import { isCrewAssignmentSummary } from './execution-guards';
import { orderFixture } from '../test/order-fixture';
import { crewAssignmentFixture } from '../test/execution-fixture';
describe('M7 operational closure is separate from payment and public work access', () => {
  it('accepts completed unpaid orders and all supported M6/M7 audit actions without accepting an arbitrary status', () => {
    const closed = {
      ...orderFixture,
      progress: 'COMPLETED',
      paymentStatus: 'UNPAID',
      currentCompletionId: 'completion-fixture',
    };
    expect(isOrderSummary(closed)).toBe(true);
    for (const action of [
      'ESTIMATE_SET',
      'APPOINTMENT_RESCHEDULED',
      'RETURN_VISIT_PLANNED',
      'RETURN_VISIT_RESOLVED',
      'RETURN_VISIT_REOPENED',
      'ACCEPTANCE_PREPARED',
      'ACCEPTANCE_SIGNED',
      'ACCEPTANCE_ABSENT',
      'EXCEPTION_REVIEWED',
      'ACCEPTANCE_INVALIDATED',
      'ORDER_COMPLETED',
      'ORDER_REOPENED',
    ]) {
      expect(
        isOrderDetail({
          ...closed,
          activity: [
            {
              id: 'event',
              orderId: closed.id,
              actorId: 'actor',
              targetId: 'target',
              createdAt: '2030-01-07T10:00:00.000Z',
              action,
              reason: null,
              changes: {},
            },
          ],
        }),
      ).toBe(true);
    }
    expect(isOrderSummary({ ...closed, progress: 'ARCHIVED' })).toBe(false);
    expect(isOrderSummary({ ...closed, currentCompletionId: { hidden: 'value' } })).toBe(false);
  });
  it('allows a safe crew order-progress badge while still rejecting nested finance', () => {
    const work = { ...crewAssignmentFixture, orderProgress: 'COMPLETED' };
    expect(isCrewAssignmentSummary(work)).toBe(true);
    expect(isCrewAssignmentSummary({ ...work, orderProgress: 'ARCHIVED' })).toBe(false);
    expect(isCrewAssignmentSummary({ ...work, payments: [] })).toBe(false);
  });
});
