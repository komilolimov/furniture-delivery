import { chooseSelectOption } from '../test/select-option';
import type { OrderDetail, OrderListResponse, OrderResponse } from '@furniture-delivery/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { orderFixture } from '../test/order-fixture';
import { OrderList } from './order-list';
import { OrderQuickView } from './order-quick-view';

vi.mock('../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const apiMock = vi.mocked(apiRequest);
const detailPath = `/orders/${orderFixture.id}`;
const list = (
  orders: OrderDetail[] = [orderFixture],
  total = orders.length,
  page = 1,
  pageSize = 10,
): OrderListResponse => ({ orders, total, page, pageSize });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const currentListQuery = () => {
  const path = apiMock.mock.calls.filter(([value]) => value.startsWith('/orders?')).at(-1)?.[0];
  expect(path).toBeDefined();
  return new URL(path!, 'http://fixture.test').searchParams;
};
beforeEach(() => apiMock.mockReset());

describe('Orders table and read-only quick view', () => {
  it('keeps work, payment and attention separate in one semantic row with a direct order link', async () => {
    apiMock.mockResolvedValue(
      list([
        {
          ...orderFixture,
          progress: 'IN_PROGRESS',
          paymentStatus: 'PAID',
          paidCents: 100000,
          balanceCents: 0,
          openIssueCount: 2,
          returnVisitRequired: true,
        },
      ]),
    );
    render(<OrderList />);

    const table = await screen.findByRole('table', { name: 'Orders' });
    const customer = within(table).getByText(orderFixture.customerName);
    const row = customer.closest('tr')!;
    expect(within(row).getByText('In progress')).toBeInTheDocument();
    expect(within(row).getByText('Paid')).toBeInTheDocument();
    expect(within(row).getByText(/2 open issues/)).toBeInTheDocument();
    expect(within(row).getByText(/Return visit required/)).toBeInTheDocument();
    expect(within(row).getByText('€1,000.00')).toBeInTheDocument();
    expect(within(row).getByText(/€0.00/)).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: `Preview order ${orderFixture.number}` }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole('link', { name: `Open order ${orderFixture.number}` }),
    ).toHaveAttribute('href', `/backoffice/orders/${orderFixture.id}`);
    expect(screen.getAllByText(orderFixture.customerName)).toHaveLength(1);
  });

  it('applies filter drafts on confirmation, resets pagination, and clears criteria while preserving page size', async () => {
    apiMock.mockImplementation(async (path) => {
      const query = new URL(path, 'http://fixture.test').searchParams;
      return list([orderFixture], 26, Number(query.get('page')), Number(query.get('pageSize')));
    });
    render(<OrderList initialProgress="ASSIGNED" initialIssues="true" />);
    await screen.findByRole('table', { name: 'Orders' });
    expect(currentListQuery().get('progress')).toBe('ASSIGNED');
    expect(currentListQuery().get('hasOpenIssues')).toBe('true');
    const beforeDraft = apiMock.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '  Rome & chair  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await chooseSelectOption('Payment status', 'Unpaid');
    expect(apiMock).toHaveBeenCalledTimes(beforeDraft);
    fireEvent.submit(screen.getByRole('form', { name: 'Advanced order filters' }));
    await waitFor(() => expect(currentListQuery().get('search')).toBe('Rome & chair'));
    expect(currentListQuery().get('paymentStatus')).toBe('UNPAID');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Order filters' })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(currentListQuery().get('page')).toBe('2'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled());
    await chooseSelectOption('Per page', '25');
    await waitFor(() => expect(currentListQuery().get('pageSize')).toBe('25'));
    expect(currentListQuery().get('page')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(currentListQuery().toString()).toBe('page=1&pageSize=25'));
    expect(screen.getByLabelText('Search')).toHaveValue('');
    expect(await screen.findByRole('combobox', { name: 'Per page' })).toHaveTextContent('25');
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(await screen.findByRole('combobox', { name: 'Work progress' })).toHaveTextContent(
      'All work states',
    );
    expect(screen.getByRole('combobox', { name: 'Payment status' })).toHaveTextContent(
      'All payment states',
    );
    expect(screen.getByRole('combobox', { name: 'Issues' })).toHaveTextContent('All issue states');
  });

  it('loads the actual order in a modal preview, keeps viewing read-only, and restores keyboard focus on Escape', async () => {
    const detail = deferred<OrderResponse>();
    apiMock.mockImplementation(async (path) => (path === detailPath ? detail.promise : list()));
    render(<OrderList />);
    const trigger = await screen.findByRole('button', {
      name: `Preview order ${orderFixture.number}`,
    });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Order preview' });
    expect(within(dialog).getByRole('status')).toHaveTextContent('Loading order');
    expect(within(dialog).queryByText(orderFixture.address)).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(detailPath, expect.anything());
    await act(async () => detail.resolve({ order: orderFixture }));
    expect(
      await within(dialog).findByText(orderFixture.address, { exact: false }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(orderFixture.phoneNumbers[0]!)).toBeInTheDocument();
    expect(within(dialog).getByText(orderFixture.items[0]!.description)).toBeInTheDocument();
    expect(within(dialog).queryByText(orderFixture.internalNotes)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open full order' })).toHaveAttribute(
      'href',
      `/backoffice/orders/${orderFixture.id}`,
    );
    expect(
      apiMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
    ).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByRole('table', { name: 'Orders' })).toBeInTheDocument();
  });

  it('lets the user retry a real detail failure without presenting a list summary as loaded detail', async () => {
    let attempts = 0;
    apiMock.mockImplementation(async (path) => {
      if (path !== detailPath) return list();
      if (++attempts === 1) throw new ApiError(503, 'Preview temporarily unavailable.');
      return { order: orderFixture };
    });
    render(<OrderList />);
    fireEvent.click(
      await screen.findByRole('button', { name: `Preview order ${orderFixture.number}` }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Order preview' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Preview temporarily unavailable',
    );
    expect(within(dialog).queryByRole('link', { name: 'Open full order' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(
      await within(dialog).findByRole('link', { name: 'Open full order' }),
    ).toBeInTheDocument();
    expect(attempts).toBe(2);
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close preview' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('discards a late response for a previous order instead of replacing the next preview', async () => {
    const first = deferred<OrderResponse>();
    const second: OrderDetail = {
      ...orderFixture,
      id: '43c010f3-29f8-4c43-86fb-130cd484d508',
      number: 'FD-000002',
      customerName: 'Second fixture customer',
      address: 'Second fictional address',
    };
    apiMock.mockImplementation(async (path) =>
      path === detailPath ? first.promise : { order: second },
    );
    const closed = vi.fn();
    const { rerender } = render(
      <OrderQuickView
        key={orderFixture.id}
        orderId={orderFixture.id}
        onClosed={closed}
        returnFocus={null}
      />,
    );
    await screen.findByRole('dialog', { name: 'Order preview' });
    rerender(
      <OrderQuickView key={second.id} orderId={second.id} onClosed={closed} returnFocus={null} />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Order preview' });
    expect(await within(dialog).findByText(second.customerName)).toBeInTheDocument();
    await act(async () => first.resolve({ order: orderFixture }));
    expect(within(dialog).getByText(second.customerName)).toBeInTheDocument();
    expect(within(dialog).queryByText(orderFixture.customerName)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open full order' })).toHaveAttribute(
      'href',
      `/backoffice/orders/${second.id}`,
    );
  });

  it('removes retained preview financial and customer data when current permissions are lost', async () => {
    apiMock
      .mockResolvedValueOnce({ order: orderFixture })
      .mockRejectedValueOnce(new ApiError(403, 'Access revoked.'));
    render(<OrderQuickView orderId={orderFixture.id} onClosed={vi.fn()} returnFocus={null} />);
    const dialog = await screen.findByRole('dialog', { name: 'Order preview' });
    await within(dialog).findByRole('region', { name: 'Payment overview' });
    fireEvent(window, new Event('fd:orders-changed'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Access denied');
    expect(
      within(dialog).queryByRole('region', { name: 'Payment overview' }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText(orderFixture.customerName)).not.toBeInTheDocument();
    expect(within(dialog).queryByText('€1,000.00')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: 'Open full order' })).not.toBeInTheDocument();
  });

  it('clears retained table rows on access loss without reporting an empty successful result', async () => {
    apiMock
      .mockResolvedValueOnce(list())
      .mockRejectedValueOnce(new ApiError(403, 'Access revoked.'));
    render(<OrderList />);
    await screen.findByRole('table', { name: 'Orders' });
    fireEvent(window, new Event('fd:orders-changed'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.queryByText(orderFixture.customerName)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: `Open order ${orderFixture.number}` }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('No matching orders')).not.toBeInTheDocument();
  });

  it('opens the same quick view from a pointer click on row content without navigating away', async () => {
    apiMock.mockImplementation(async (path) =>
      path === detailPath ? { order: orderFixture } : list(),
    );
    render(<OrderList />);
    const table = await screen.findByRole('table', { name: 'Orders' });
    fireEvent.click(within(table).getByText(orderFixture.customerName));
    const dialog = await screen.findByRole('dialog', { name: 'Order preview' });
    expect(await within(dialog).findByText(orderFixture.customerName)).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(detailPath, expect.anything());
  });
});
