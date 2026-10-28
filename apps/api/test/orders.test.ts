import { describe, expect, it } from 'vitest';
import { OrderDto } from '../src/orders/orders.dto';
import {
  derivePaymentState,
  MAX_CENTS,
  paymentFingerprint,
  safeSumCents,
} from '../src/orders/order-finance';

const input = () => ({
  customerName: ' Fictional Client ',
  phoneNumbers: ['+39 000'],
  address: 'Demo Street',
  city: 'Rome',
  country: 'Italy',
  serviceType: 'DELIVERY_ONLY',
  workDescription: 'Deliver chair',
  estimatedDurationMinutes: 30,
  orderTotalCents: 10000,
  items: [{ description: 'Chair', quantity: 1, requiresAssembly: false, sortOrder: 0 }],
});
describe('M3 order validation and money rules', () => {
  it('normalizes optional fields and preserves unknown access values', () => {
    const parsed = OrderDto.create(input());
    expect(parsed.customerName).toBe('Fictional Client');
    expect(parsed.contactName).toBeNull();
    expect(parsed.hasElevator).toBeNull();
    expect(parsed.easyAccess).toBeNull();
    expect(parsed.internalNotes).toBe('');
    expect(parsed.items[0]?.configuration).toBe('');
  });
  it.each([-1, 0.5, MAX_CENTS + 1, Number.NaN, Number.MAX_SAFE_INTEGER])(
    'rejects invalid cents %s',
    (value) => {
      expect(() => OrderDto.create({ ...input(), orderTotalCents: value })).toThrow();
      expect(() =>
        OrderDto.payment({
          amountCents: value,
          paidOn: '2026-10-25',
          method: 'CASH',
          idempotencyKey: 'unit-payment',
        }),
      ).toThrow();
    },
  );
  it('accepts free orders but never zero payments, rejects protected and future fields', () => {
    expect(OrderDto.create({ ...input(), orderTotalCents: 0 }).orderTotalCents).toBe(0);
    expect(() =>
      OrderDto.payment({
        amountCents: 0,
        paidOn: '2026-10-25',
        method: 'CASH',
        idempotencyKey: 'unit-payment',
      }),
    ).toThrow();
    for (const field of [
      'id',
      'createdBy',
      'createdAt',
      'version',
      'paidCents',
      'balanceCents',
      'paymentStatus',
      'progress',
      'scheduledStart',
      'crewId',
    ])
      expect(() => OrderDto.create({ ...input(), [field]: 'forged' })).toThrow();
    expect(() => OrderDto.update({ expectedVersion: 1 })).toThrow();
    expect(() => OrderDto.update({ expectedVersion: 0, customerName: 'Demo' })).toThrow();
    expect(() =>
      OrderDto.create({ ...input(), items: [{ ...input().items[0], id: '123' }] }),
    ).toThrow();
  });
  it('keeps assigned crews derived from visits instead of accepting ownership edits on an order', () => {
    const assignedCrews = [{ id: 'forged-crew', code: 'FORGED', name: 'Forged team' }];
    expect(() => OrderDto.create({ ...input(), assignedCrews })).toThrow();
    expect(() => OrderDto.update({ expectedVersion: 1, assignedCrews })).toThrow();
  });
  it('rejects invalid quantities, duplicate order, incomplete contacts and inconsistent assembly', () => {
    for (const quantity of [0, 1.1, 10001])
      expect(() =>
        OrderDto.create({ ...input(), items: [{ ...input().items[0], quantity }] }),
      ).toThrow();
    expect(() => OrderDto.create({ ...input(), phoneNumbers: [] })).toThrow();
    expect(() => OrderDto.create({ ...input(), email: 'broken' })).toThrow();
    expect(() => OrderDto.create({ ...input(), hasElevator: 'yes' })).toThrow();
    expect(() =>
      OrderDto.create({ ...input(), items: [{ ...input().items[0], requiresAssembly: true }] }),
    ).toThrow();
    expect(() =>
      OrderDto.create({ ...input(), items: [input().items[0], input().items[0]] }),
    ).toThrow();
  });
  it('checks actual calendar dates and normalizes the original request fingerprint', () => {
    const payment = {
      amountCents: 200,
      paidOn: '2024-02-29',
      method: 'CARD' as const,
      idempotencyKey: 'unit-payment',
      note: ' note ',
    };
    expect(OrderDto.payment(payment).note).toBe('note');
    expect(() => OrderDto.payment({ ...payment, paidOn: '2025-02-29' })).toThrow();
    expect(() => OrderDto.payment({ ...payment, paidOn: '2026-04-31' })).toThrow();
    expect(() => OrderDto.payment({ ...payment, paidOn: '2026-01-01T00:00:00Z' })).toThrow();
    expect(paymentFingerprint(payment)).toBe(paymentFingerprint({ ...payment, note: 'note' }));
    expect(paymentFingerprint({ ...payment, note: undefined })).toBe(
      paymentFingerprint({ ...payment, note: null }),
    );
    expect(() => OrderDto.void({ reason: ' ' })).toThrow();
  });
  it('derives four independent payment states and handles bigint SUM exactly', () => {
    expect(derivePaymentState(0, 0)).toBe('NOT_REQUIRED');
    expect(derivePaymentState(10, 0)).toBe('UNPAID');
    expect(derivePaymentState(10, 5)).toBe('PARTIALLY_PAID');
    expect(derivePaymentState(10, 10)).toBe('PAID');
    expect(() => derivePaymentState(10, 11)).toThrow();
    expect(safeSumCents('6000000000')).toBe(6000000000);
    expect(safeSumCents('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of ['9007199254740992', '-1', '1.5', null, undefined])
      expect(() => safeSumCents(value)).toThrow();
  });
  it('bounds and validates server-side search/filter/pagination', () => {
    expect(OrderDto.query({ page: '2', pageSize: '10' })).toMatchObject({ page: 2, pageSize: 10 });
    for (const value of [
      { page: '0' },
      { page: '1.5' },
      { pageSize: '101' },
      { paymentStatus: 'COMPLETED' },
      { serviceType: 'INSTALL' },
      { sort: 'total' },
      { page: ['1', '2'] },
    ])
      expect(() => OrderDto.query(value)).toThrow();
  });
});
