import { chooseSelectOption } from '../test/select-option';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { orderFixture, paymentFixture } from '../test/order-fixture';
import { OrderDashboard } from './order-dashboard';
import { OrderList } from './order-list';
import { OrderForm } from './order-form';
import { PaymentJournal } from './payment-journal';
import { OrderDetailScreen } from './order-detail';
// These draft/payment cases isolate child modules covered by their dedicated planning/execution/evidence tests.
vi.mock('./order-appointments', () => ({ OrderAppointments: () => null }));
vi.mock('./backoffice-execution-panel', () => ({ BackofficeExecutionPanel: () => null }));
vi.mock('./evidence-panel', () => ({ EvidencePanel: () => null }));
vi.mock('./completion-panel', () => ({ CompletionPanel: () => null }));

vi.mock('../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const apiMock = vi.mocked(apiRequest);
beforeEach(() => {
  apiMock.mockReset();
});

describe('M3 order resources', () => {
  it('keeps planned and assigned orders out of the empty dashboard state', async () => {
    apiMock.mockResolvedValue({
      inboxCount: 0,
      plannedCount: 1,
      assignedCount: 2,
      inProgressCount: 0,
      partiallyCompletedCount: 0,
      requiresAttentionCount: 0,
      awaitingReviewCount: 0,
      completedCount: 0,
      openIssueCount: 0,
      returnVisitRequiredCount: 0,
      orderTotalCents: 100,
      paidCents: 0,
      balanceCents: 100,
      currency: 'EUR',
    });
    render(<OrderDashboard />);
    expect(await screen.findByRole('link', { name: 'Assigned 2' })).toHaveAttribute(
      'href',
      '/backoffice/orders?progress=ASSIGNED',
    );
    expect(screen.queryByText('No orders yet')).not.toBeInTheDocument();
  });
  it('uses the dashboard planning filter on its initial server request', async () => {
    apiMock.mockResolvedValue({ orders: [], total: 0, page: 1, pageSize: 10 });
    render(<OrderList initialProgress="ASSIGNED" />);
    await screen.findByText('No matching orders');
    expect(apiMock).toHaveBeenCalledWith(
      '/orders?page=1&pageSize=10&progress=ASSIGNED',
      expect.anything(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(await screen.findByRole('combobox', { name: 'Work progress' })).toHaveTextContent(
      'Assigned',
    );
  });
  it('shows loading, an API error, retry and a real empty state', async () => {
    apiMock
      .mockRejectedValueOnce(new ApiError(503, 'Temporarily unavailable.'))
      .mockResolvedValueOnce({ orders: [], total: 0, page: 1, pageSize: 10 });
    render(<OrderList />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(await screen.findByRole('alert')).toHaveTextContent('Temporarily unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No matching orders')).toBeInTheDocument();
  });
  it('requests server filters and the next page instead of slicing local rows', async () => {
    apiMock.mockResolvedValue({ orders: [orderFixture], total: 26, page: 1, pageSize: 10 });
    render(<OrderList />);
    await screen.findByText(orderFixture.customerName);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Rome & chair' } });
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await chooseSelectOption('Service', 'Delivery only');
    await chooseSelectOption('Payment status', 'Unpaid');
    fireEvent.submit(screen.getByRole('button', { name: 'Apply filters' }).closest('form')!);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        '/orders?page=1&pageSize=10&search=Rome+%26+chair&serviceType=DELIVERY_ONLY&paymentStatus=UNPAID',
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Order filters' })).not.toBeInTheDocument(),
    );
    await screen.findByText(orderFixture.customerName);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        '/orders?page=2&pageSize=10&search=Rome+%26+chair&serviceType=DELIVERY_ONLY&paymentStatus=UNPAID',
        expect.anything(),
      ),
    );
  });
  it('labels server dashboard aggregates as all orders and manual payments', async () => {
    apiMock.mockResolvedValue({
      inboxCount: 24,
      plannedCount: 0,
      assignedCount: 0,
      inProgressCount: 0,
      partiallyCompletedCount: 0,
      requiresAttentionCount: 0,
      awaitingReviewCount: 0,
      completedCount: 0,
      openIssueCount: 0,
      returnVisitRequiredCount: 0,
      orderTotalCents: 100000,
      paidCents: 65050,
      balanceCents: 34950,
      currency: 'EUR',
    });
    render(<OrderDashboard />);
    expect(await screen.findByRole('link', { name: 'Inbox 24' })).toBeInTheDocument();
    expect(screen.getByText(/All orders · EUR/)).toHaveTextContent('not accounting revenue');
    expect(screen.getByText('€650.50')).toBeInTheDocument();
  });
  it('rereads dashboard totals after an order mutation and returning to the tab', async () => {
    apiMock.mockResolvedValue({
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
      paidCents: 0,
      balanceCents: 100,
      currency: 'EUR',
    });
    render(<OrderDashboard />);
    await screen.findByRole('link', { name: 'Inbox 1' });
    apiMock.mockResolvedValue({
      inboxCount: 2,
      plannedCount: 0,
      assignedCount: 0,
      inProgressCount: 0,
      partiallyCompletedCount: 0,
      requiresAttentionCount: 0,
      awaitingReviewCount: 0,
      completedCount: 0,
      openIssueCount: 0,
      returnVisitRequiredCount: 0,
      orderTotalCents: 200,
      paidCents: 0,
      balanceCents: 200,
      currency: 'EUR',
    });
    fireEvent(window, new Event('fd:orders-changed'));
    await screen.findByRole('link', { name: 'Inbox 2' });
    fireEvent.focus(window);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));
  });
});

describe('M3 atomic order form', () => {
  it('rejects fractional cents beside the field before contacting the server', () => {
    render(<OrderForm order={orderFixture} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Total (EUR)'), { target: { value: '1.005' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save order' }).closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('at most two decimal places');
    expect(apiMock).not.toHaveBeenCalled();
  });
  it('sends integer cents, expectedVersion, IDs and unknown access values in one update', async () => {
    const saved = vi.fn();
    apiMock.mockResolvedValue({ order: { ...orderFixture, version: 2 } });
    render(<OrderForm order={orderFixture} onSaved={saved} />);
    expect(screen.getByLabelText('Access restrictions')).toHaveAttribute('maxlength', '4000');
    expect(screen.getByLabelText('Access notes')).toHaveAttribute('maxlength', '4000');
    fireEvent.change(screen.getByLabelText('Total (EUR)'), { target: { value: '650,50' } });
    fireEvent.change(screen.getByLabelText('Customer name'), {
      target: { value: 'Updated fixture' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Save order' }).closest('form')!);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/orders/${orderFixture.id}`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.objectContaining({
            expectedVersion: 1,
            customerName: 'Updated fixture',
            orderTotalCents: 65050,
            hasElevator: null,
            easyAccess: null,
            parkingAvailable: null,
            items: [expect.objectContaining({ id: orderFixture.items[0]?.id, quantity: 1 })],
          }),
        }),
      ),
    );
    expect(saved).toHaveBeenCalled();
  });
  it('preserves an edit draft and its original revision when an earlier payment finishes', async () => {
    let finishPayment: (value: unknown) => void = () => undefined;
    apiMock
      .mockResolvedValueOnce({ order: orderFixture })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishPayment = resolve;
          }),
      )
      // The payment event also refetches the retained order details.
      .mockResolvedValueOnce({
        order: {
          ...orderFixture,
          version: 2,
          paidCents: 65050,
          balanceCents: 34950,
          payments: [paymentFixture],
        },
      })
      .mockRejectedValueOnce(new ApiError(409, 'Order has changed.'));
    render(<OrderDetailScreen orderId={orderFixture.id} />);
    await screen.findByRole('button', { name: 'Edit order' });
    const paymentsTab = screen.getByRole('tab', { name: 'Payments' });
    fireEvent.mouseDown(paymentsTab, { button: 0, ctrlKey: false });
    fireEvent.click(paymentsTab);
    fireEvent.change(screen.getByLabelText('Payment amount (EUR)'), {
      target: { value: '650.50' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Record payment' }).closest('form')!);
    fireEvent.click(screen.getByRole('button', { name: 'Edit order' }));
    fireEvent.change(screen.getByLabelText('Customer name'), {
      target: { value: 'Unsaved draft' },
    });
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Save or cancel order edits before recording or voiding payments.'),
    ).toBeInTheDocument();
    finishPayment({
      payment: paymentFixture,
      order: {
        ...orderFixture,
        version: 2,
        paidCents: 65050,
        balanceCents: 34950,
        payments: [paymentFixture],
      },
    });
    await screen.findByText('Payment recorded. The journal and balance are current.');
    expect(screen.getByLabelText('Customer name')).toHaveValue('Unsaved draft');
    fireEvent.submit(screen.getByRole('button', { name: 'Save order' }).closest('form')!);
    await waitFor(() =>
      expect(apiMock).toHaveBeenLastCalledWith(
        `/orders/${orderFixture.id}`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.objectContaining({ customerName: 'Unsaved draft', expectedVersion: 1 }),
        }),
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Order has changed.');
  });
  it('preserves an outdated form and offers an explicit reload after 409', async () => {
    const reload = vi.fn();
    apiMock.mockRejectedValue(new ApiError(409, 'Order has changed.'));
    render(<OrderForm order={orderFixture} onSaved={vi.fn()} onReload={reload} />);
    fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'Unsaved edit' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save order' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Order has changed');
    expect(screen.getByLabelText('Customer name')).toHaveValue('Unsaved edit');
    fireEvent.click(screen.getByRole('button', { name: 'Discard this form and reload order' }));
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('M3 manual payment attempts', () => {
  function fillPayment() {
    fireEvent.change(screen.getByLabelText('Payment amount (EUR)'), {
      target: { value: '650,50' },
    });
    fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2026-10-25' } });
  }
  it('does not create another operation for a repeated submit while the first is pending', async () => {
    let finish: (value: unknown) => void = () => undefined;
    apiMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const saved = vi.fn();
    render(<PaymentJournal order={orderFixture} onSaved={saved} />);
    expect(screen.getByLabelText('Payment note')).toHaveAttribute('maxlength', '2000');
    fillPayment();
    const form = screen.getByRole('button', { name: 'Record payment' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(apiMock).toHaveBeenCalledTimes(1);
    finish({ payment: paymentFixture, order: orderFixture });
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  });
  it('retains the exact payload and idempotency key across a lost response retry', async () => {
    const saved = vi.fn();
    apiMock.mockRejectedValueOnce(new ApiError(0, 'Network response lost.')).mockResolvedValueOnce({
      payment: paymentFixture,
      order: {
        ...orderFixture,
        paidCents: 65050,
        balanceCents: 34950,
        payments: [paymentFixture],
      },
    });
    render(<PaymentJournal order={orderFixture} onSaved={saved} />);
    fillPayment();
    fireEvent.submit(screen.getByRole('button', { name: 'Record payment' }).closest('form')!);
    await screen.findByText('Network response lost.');
    expect(screen.getByLabelText('Payment amount (EUR)')).toBeDisabled();
    const first = apiMock.mock.calls[0]?.[1]?.body;
    fireEvent.submit(screen.getByRole('button', { name: 'Retry same payment' }).closest('form')!);
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(apiMock.mock.calls[1]?.[1]?.body).toEqual(first);
    expect(first).toMatchObject({
      amountCents: 65050,
      paidOn: '2026-10-25',
      idempotencyKey: expect.any(String),
    });
  });
  it('keeps the uncertain attempt if refreshing the journal also fails', async () => {
    apiMock.mockRejectedValue(new ApiError(0, 'Offline.'));
    render(<PaymentJournal order={orderFixture} onSaved={vi.fn()} />);
    fillPayment();
    fireEvent.submit(screen.getByRole('button', { name: 'Record payment' }).closest('form')!);
    await screen.findByText('Offline.');
    fireEvent.click(screen.getByRole('button', { name: 'Check journal and start a new payment' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Retry same payment' })).toBeInTheDocument();
    expect(screen.getByLabelText('Payment amount (EUR)')).toBeDisabled();
  });
  it('shows the current VOIDED record when retrying a payment after it was voided', async () => {
    const saved = vi.fn();
    const voided = {
      ...paymentFixture,
      status: 'VOIDED' as const,
      voidReason: 'Wrong amount',
      voidedBy: 'fixture-actor',
      voidedAt: '2026-10-25T13:00:00.000Z',
    };
    apiMock
      .mockRejectedValueOnce(new ApiError(0, 'Response lost.'))
      .mockResolvedValueOnce({ payment: voided, order: { ...orderFixture, payments: [voided] } });
    render(<PaymentJournal order={orderFixture} onSaved={saved} />);
    fillPayment();
    fireEvent.submit(screen.getByRole('button', { name: 'Record payment' }).closest('form')!);
    await screen.findByText('Response lost.');
    fireEvent.submit(screen.getByRole('button', { name: 'Retry same payment' }).closest('form')!);
    expect(
      await screen.findByText('This payment was already voided. Its current record is shown.'),
    ).toBeInTheDocument();
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ payments: [voided], paidCents: 0 }),
    );
  });
  it('sends an explicit VOID reason and explains that no refund is sent', async () => {
    const saved = vi.fn();
    const voided = {
      ...paymentFixture,
      status: 'VOIDED' as const,
      voidReason: 'Wrong amount',
      voidedBy: 'fixture-actor',
      voidedAt: '2026-10-25T13:00:00.000Z',
    };
    apiMock.mockResolvedValue({ payment: voided, order: { ...orderFixture, payments: [voided] } });
    render(
      <PaymentJournal order={{ ...orderFixture, payments: [paymentFixture] }} onSaved={saved} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Void entry' }));
    expect(
      screen.getByText('This removes the entry from the paid total. It does not send a refund.'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason for void'), {
      target: { value: 'Wrong amount' },
    });
    fireEvent.click(screen.getByLabelText('I confirm this entry was recorded in error.'));
    fireEvent.submit(screen.getByRole('button', { name: 'Confirm void' }).closest('form')!);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/orders/${orderFixture.id}/payments/${paymentFixture.id}/void`,
        expect.objectContaining({ method: 'POST', body: { reason: 'Wrong amount' } }),
      ),
    );
    expect(
      await screen.findByText('Payment entry voided. No money has been refunded.'),
    ).toBeInTheDocument();
  });
});

describe('M5 independent work and issue dimensions', () => {
  it('keeps the expanded progress and Issues filters independent from payment state', async () => {
    apiMock.mockResolvedValue({ orders: [], total: 0, page: 1, pageSize: 10 });
    render(<OrderList initialProgress="IN_PROGRESS" initialIssues="true" />);
    await screen.findByText('No matching orders');
    expect(apiMock).toHaveBeenCalledWith(
      '/orders?page=1&pageSize=10&progress=IN_PROGRESS&hasOpenIssues=true',
      expect.anything(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await screen.findByRole('dialog', { name: 'Order filters' });
    await chooseSelectOption('Work progress', 'Awaiting review');
    await chooseSelectOption('Issues', 'No open issues');
    await chooseSelectOption('Payment status', 'Unpaid');
    fireEvent.submit(screen.getByRole('button', { name: 'Apply filters' }).closest('form')!);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        '/orders?page=1&pageSize=10&paymentStatus=UNPAID&progress=AWAITING_REVIEW&hasOpenIssues=false',
        expect.anything(),
      ),
    );
  });
  it('does not call an execution-only dashboard empty or multiply its financial totals', async () => {
    apiMock.mockResolvedValue({
      inboxCount: 0,
      plannedCount: 0,
      assignedCount: 0,
      inProgressCount: 2,
      partiallyCompletedCount: 1,
      requiresAttentionCount: 3,
      awaitingReviewCount: 4,
      completedCount: 0,
      openIssueCount: 7,
      returnVisitRequiredCount: 2,
      orderTotalCents: 100000,
      paidCents: 65050,
      balanceCents: 34950,
      currency: 'EUR',
    });
    render(<OrderDashboard />);
    expect(await screen.findByRole('link', { name: 'Awaiting review 4' })).toHaveAttribute(
      'href',
      '/backoffice/orders?progress=AWAITING_REVIEW',
    );
    expect(screen.getByRole('link', { name: /Open issues 7/ })).toHaveAttribute(
      'href',
      '/backoffice/issues?status=OPEN',
    );
    expect(screen.queryByText('No orders yet')).not.toBeInTheDocument();
    expect(screen.getAllByText('€650.50')).toHaveLength(1);
  });
});
