'use client';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { NativeSelect } from './ui/native-select';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  Table,
  TableCaption,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from './ui/table';
import { DraftChangeNotice } from './draft-change-notice';

import type {
  CreatePaymentRequest,
  OrderDetail,
  OrderResponse,
  PaymentMethod,
  PaymentResponse,
} from '@furniture-delivery/contracts';
import { useRef, useState, type FormEvent } from 'react';
import { apiRequest, ApiError, describeError } from '../lib/api-client';
import { parseEuroCents, formatCents } from '../lib/money';
import { isOrderResponse, isPaymentResponse } from '../lib/order-guards';
import { ordersChanged } from '../lib/use-order-resource';
import { Feedback } from './form-parts';

export function PaymentJournal({
  order,
  onSaved,
}: Readonly<{ order: OrderDetail; onSaved: (order: OrderDetail) => void }>) {
  const [attempt, setAttempt] = useState<CreatePaymentRequest | null>(null);
  const attemptRef = useRef<CreatePaymentRequest | null>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [formRevision, setFormRevision] = useState(0);
  function clearAttempt() {
    attemptRef.current = null;
    setAttempt(null);
  }
  async function submitPayment(body: CreatePaymentRequest) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiRequest<PaymentResponse>(`/orders/${order.id}/payments`, {
        method: 'POST',
        body,
        validate: isPaymentResponse,
      });
      ordersChanged();
      onSaved(response.order);
      clearAttempt();
      setFormRevision((value) => value + 1);
      setSuccess(
        response.payment.status === 'VOIDED'
          ? 'This payment was already voided. Its current record is shown.'
          : 'Payment recorded. The journal and balance are current.',
      );
    } catch (error) {
      setError(describeError(error));
      // A lost response has an unknown result. Keep the exact payload and key for Retry.
      if (error instanceof ApiError && error.status !== 0 && error.status < 500) clearAttempt();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  function createPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    setAmountError(null);
    setError(null);
    if (attemptRef.current) {
      void submitPayment(attemptRef.current);
      return;
    }
    const data = new FormData(event.currentTarget);
    let amountCents: number;
    try {
      amountCents = parseEuroCents(String(data.get('amount') ?? ''));
      if (amountCents <= 0) throw new Error('Enter a payment greater than zero.');
    } catch (error) {
      setAmountError(error instanceof Error ? error.message : 'Invalid amount.');
      return;
    }
    const body: CreatePaymentRequest = Object.freeze({
      amountCents,
      paidOn: String(data.get('paidOn') ?? ''),
      method: String(data.get('method') ?? 'CASH') as PaymentMethod,
      note: String(data.get('note') ?? '').trim() || null,
      idempotencyKey: crypto.randomUUID(),
    });
    attemptRef.current = body;
    setAttempt(body);
    void submitPayment(body);
  }
  async function startNew() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await apiRequest<OrderResponse>(`/orders/${order.id}`, {
        validate: isOrderResponse,
      });
      onSaved(response.order);
      clearAttempt();
      setFormRevision((value) => value + 1);
      setSuccess('Journal refreshed. Review it before entering an intentionally new payment.');
    } catch (error) {
      setError(describeError(error));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function voidPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!voidId || busy.current) return;
    const data = new FormData(event.currentTarget);
    if (data.get('confirm') !== 'on') {
      setError('Confirm that you want to void this journal entry.');
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiRequest<PaymentResponse>(
        `/orders/${order.id}/payments/${voidId}/void`,
        {
          method: 'POST',
          body: { reason: String(data.get('reason') ?? '').trim() },
          validate: isPaymentResponse,
        },
      );
      ordersChanged();
      onSaved(response.order);
      setVoidId(null);
      setSuccess('Payment entry voided. No money has been refunded.');
    } catch (error) {
      setError(describeError(error));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section className="content-card tw:min-w-0 tw:rounded-2xl tw:border tw:border-solid tw:border-[#dfe6d8] tw:bg-[#fffefa] tw:p-6 tw:max-[600px]:p-4">
      <h2 className="tw:m-0 tw:text-xl tw:font-medium tw:tracking-[-0.4px]">Payment journal</h2>
      <p className="section-copy">
        Manual records of payments already received. Card means a manual record; never enter card or
        bank credentials. Voiding corrects this journal and does not refund money.
      </p>
      {order.payments.length === 0 ? (
        <p className="empty-copy">No payments recorded.</p>
      ) : (
        <Table className="payment-table tw:my-5 tw:table-fixed">
          <TableCaption className="visually-hidden">Payments for {order.number}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Date / method</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status / note</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.payments.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell data-label="Date / method">
                  <strong>{payment.paidOn}</strong>
                  <small>{payment.method.replaceAll('_', ' ')}</small>
                </TableCell>
                <TableCell data-label="Amount">{formatCents(payment.amountCents)}</TableCell>
                <TableCell data-label="Status / note">
                  <Badge variant={payment.status === 'RECORDED' ? 'success' : 'secondary'}>
                    {payment.status === 'RECORDED' ? 'Recorded' : 'Voided'}
                  </Badge>
                  {payment.note && <p>{payment.note}</p>}
                  {payment.voidReason && <p>Reason: {payment.voidReason}</p>}
                  {payment.voidedAt && (
                    <small>
                      Voided{' '}
                      {new Date(payment.voidedAt).toLocaleString('en-GB', {
                        timeZone: 'Europe/Rome',
                      })}
                    </small>
                  )}
                </TableCell>
                <TableCell data-label="Action">
                  {payment.status === 'RECORDED' && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        setVoidId(payment.id);
                        setError(null);
                        setSuccess(null);
                      }}
                    >
                      Void entry
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {voidId && (
        <form
          className="void-form tw:my-5 tw:grid tw:gap-4 tw:rounded-xl tw:border tw:border-solid tw:border-[#e8dab9] tw:bg-[#fcf7e9] tw:p-5"
          onSubmit={(event) => void voidPayment(event)}
        >
          <DraftChangeNotice paths={[`/orders/${order.id}`]} />
          <h3>Void payment entry</h3>
          <p className="section-copy">
            This removes the entry from the paid total. It does not send a refund.
          </p>
          <label>
            Reason for void
            <Textarea
              name="reason"
              required
              minLength={1}
              maxLength={1000}
              rows={2}
              disabled={pending}
            />
          </label>
          <label className="checkbox-field tw:flex tw:min-h-11 tw:items-center tw:gap-2.5 tw:font-medium">
            <input
              className="tw:size-4 tw:min-h-4 tw:shrink-0 tw:accent-[#28543b]"
              type="checkbox"
              name="confirm"
              required
              disabled={pending}
            />
            I confirm this entry was recorded in error.
          </label>
          <div className="button-row tw:flex tw:flex-wrap tw:gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Confirm void'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setVoidId(null)}
            >
              Cancel void
            </Button>
          </div>
        </form>
      )}
      <Feedback error={error} success={success} />
      <h3 className="tw:mt-8 tw:mb-4 tw:text-base tw:font-semibold">Record a payment</h3>
      {attempt && !pending && (
        <p className="form-error" role="status">
          The result may be unknown. Retry sends the same amount, date, method and operation key.
          Check the journal before starting another payment.
        </p>
      )}
      <form className="tw:grid tw:min-w-0 tw:gap-4" key={formRevision} onSubmit={createPayment}>
        <DraftChangeNotice paths={[`/orders/${order.id}`]} />
        <fieldset
          className="tw:m-0 tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-4 tw:border-0 tw:p-0 tw:max-[600px]:grid-cols-1"
          disabled={pending || Boolean(attempt)}
        >
          <label>
            Payment amount (EUR)
            <Input
              name="amount"
              inputMode="decimal"
              required
              maxLength={12}
              aria-invalid={Boolean(amountError)}
              aria-describedby={amountError ? 'payment-amount-error' : undefined}
            />
            {amountError && (
              <span id="payment-amount-error" className="field-error" role="alert">
                {amountError}
              </span>
            )}
          </label>
          <label>
            Payment date
            <Input
              name="paidOn"
              type="date"
              required
              defaultValue={new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(
                new Date(),
              )}
            />
          </label>
          <label>
            Payment method
            <NativeSelect name="method" defaultValue="CASH">
              <option value="CASH">Cash</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="CARD">Card (manual record)</option>
              <option value="OTHER">Other</option>
            </NativeSelect>
          </label>
          <label>
            Payment note
            <Textarea name="note" rows={2} maxLength={2000} />
          </label>
        </fieldset>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : attempt ? 'Retry same payment' : 'Record payment'}
        </Button>
        {attempt && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void startNew()}
          >
            Check journal and start a new payment
          </Button>
        )}
      </form>
    </section>
  );
}
