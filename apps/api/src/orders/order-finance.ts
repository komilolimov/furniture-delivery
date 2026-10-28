import { createHash } from 'node:crypto';
import type { CreatePaymentRequest, PaymentStatus } from '@furniture-delivery/contracts';

export const MAX_CENTS = 2_000_000_000;
/** PostgreSQL SUM(integer) returns bigint as a decimal string. Reject imprecise conversion. */
export function safeSumCents(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint')
    throw new Error('Invalid monetary aggregate.');
  const raw = String(value);
  if (!/^\d+$/.test(raw)) throw new Error('Invalid monetary aggregate.');
  const exact = BigInt(raw);
  if (exact > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Monetary aggregate exceeds safe integer range.');
  return Number(exact);
}
export function derivePaymentState(total: number, paid: number): PaymentStatus {
  if (
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(paid) ||
    total < 0 ||
    paid < 0 ||
    paid > total
  )
    throw new Error('Invalid payment totals.');
  if (total === 0) return 'NOT_REQUIRED';
  if (paid === 0) return 'UNPAID';
  return paid === total ? 'PAID' : 'PARTIALLY_PAID';
}
export function paymentFingerprint(
  input: Pick<CreatePaymentRequest, 'amountCents' | 'paidOn' | 'method' | 'note'>,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([input.amountCents, input.paidOn, input.method, input.note?.trim() || null]),
    )
    .digest('hex');
}
