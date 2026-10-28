import { fireEvent, render, screen, within } from '@testing-library/react';
import type { OrderDetail } from '@furniture-delivery/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { orderFixture } from '../test/order-fixture';
import { OrderDetailScreen } from './order-detail';
import OrderDetailPage from '../app/backoffice/orders/[id]/page';

vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
vi.mock('./order-appointments', () => ({
  OrderAppointments: () => (
    <label>
      Visit note
      <input defaultValue="" name="fixture-visit-note" />
    </label>
  ),
}));
vi.mock('./backoffice-execution-panel', () => ({
  BackofficeExecutionPanel: () => (
    <label>
      Execution note
      <input defaultValue="" />
    </label>
  ),
}));
vi.mock('./completion-panel', () => ({
  CompletionPanel: () => <p>Fixture completion controls</p>,
}));
vi.mock('./evidence-panel', () => ({
  EvidencePanel: () => (
    <div>
      <label>
        Evidence note
        <input defaultValue="" />
      </label>
      <canvas aria-label="Fixture signature canvas" />
    </div>
  ),
}));
vi.mock('./payment-journal', () => ({
  PaymentJournal: () => (
    <label>
      Payment reference
      <input defaultValue="" />
    </label>
  ),
}));
vi.mock('./order-form', () => ({
  OrderForm: ({ order }: { order: OrderDetail }) => (
    <form aria-label="Fixture order editor">
      <label>
        Customer draft
        <input defaultValue={order.customerName} />
      </label>
      <span>Editing revision {order.version}</span>
    </form>
  ),
}));
const apiMock = vi.mocked(apiRequest);
beforeEach(() => apiMock.mockReset());

const detail: OrderDetail = {
  ...orderFixture,
  assignedCrews: [
    { id: 'aa906dbf-b71e-499c-8ce4-451c75ab97dc', code: 'ALPINE', name: 'Alpine fixture team' },
    { id: '02aa3e90-90ac-4677-a450-1fbf319fd772', code: 'COAST', name: 'Coast fixture team' },
  ],
  serviceType: 'DELIVERY_AND_ASSEMBLY',
  items: [
    {
      ...orderFixture.items[0]!,
      quantity: 2,
      deliveredQuantity: 1,
      assembledQuantity: 0,
      requiresAssembly: true,
    },
  ],
};
function tab(name: string) {
  return screen.getByRole('tab', { name });
}
function activateTab(name: string) {
  const trigger = tab(name);
  fireEvent.mouseDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

describe('Order detail workspace navigation', () => {
  it('shows the real assigned teams and separates ordered, delivered and assembled quantities', async () => {
    apiMock.mockResolvedValue({ order: detail });
    render(<OrderDetailScreen orderId={detail.id} />);

    expect(
      await screen.findByRole('heading', { level: 1, name: detail.customerName }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Order sections' })).toBeInTheDocument();
    for (const name of ['Overview', 'Visits', 'Execution', 'Files', 'Payments', 'History'])
      expect(tab(name)).toBeInTheDocument();
    const teams = screen.getByRole('region', { name: 'Assigned teams' });
    expect(within(teams).getByText('Alpine fixture team')).toBeInTheDocument();
    expect(within(teams).getByText('Coast fixture team')).toBeInTheDocument();
    const items = screen.getByRole('table', { name: 'Order items' });
    const row = within(items).getByText(detail.items[0]!.description).closest('tr')!;
    expect(within(row).getByText('2')).toBeInTheDocument();
    expect(within(row).getByText('1 / 2')).toBeInTheDocument();
    expect(within(row).getByText('0 / 2')).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(`/orders/${detail.id}`, expect.anything());
  });

  it('keeps payment and evidence controls mounted with their input values when changing tabs', async () => {
    apiMock.mockResolvedValue({ order: detail });
    render(<OrderDetailScreen orderId={detail.id} />);
    await screen.findByRole('heading', { level: 1, name: detail.customerName });

    activateTab('Payments');
    const payment = screen.getByLabelText('Payment reference');
    fireEvent.change(payment, { target: { value: 'Unsent payment reference' } });
    activateTab('Files');
    expect(payment).toBeInTheDocument();
    expect(payment).not.toBeVisible();
    const note = screen.getByLabelText('Evidence note');
    const drawing = screen.getByLabelText('Fixture signature canvas');
    fireEvent.change(note, { target: { value: 'Unsent evidence note' } });
    activateTab('Overview');
    expect(note).toBeInTheDocument();
    expect(drawing).toBeInTheDocument();
    expect(drawing).not.toBeVisible();
    activateTab('Payments');
    expect(screen.getByLabelText('Payment reference')).toBe(payment);
    expect(payment).toHaveValue('Unsent payment reference');
    activateTab('Files');
    expect(screen.getByLabelText('Evidence note')).toBe(note);
    expect(note).toHaveValue('Unsent evidence note');
    expect(screen.getByLabelText('Fixture signature canvas')).toBe(drawing);
  });

  it('keeps an edit bound to its original revision during refetch and navigation', async () => {
    apiMock.mockResolvedValueOnce({ order: detail }).mockResolvedValueOnce({
      order: { ...detail, version: 2, customerName: 'Server revision two' },
    });
    render(<OrderDetailScreen orderId={detail.id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit order' }));
    const draft = screen.getByLabelText('Customer draft');
    fireEvent.change(draft, { target: { value: 'Unsent customer draft' } });
    expect(tab('Payments')).toBeDisabled();
    expect(tab('Visits')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh order' }));
    await screen.findByRole('heading', { level: 1, name: 'Server revision two' });
    expect(screen.getByLabelText('Customer draft')).toBe(draft);
    expect(draft).toHaveValue('Unsent customer draft');
    expect(screen.getByText('Editing revision 1')).toBeInTheDocument();
    activateTab('Files');
    activateTab('Overview');
    expect(screen.getByLabelText('Customer draft')).toBe(draft);
    expect(draft).toHaveValue('Unsent customer draft');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }));
    expect(tab('Payments')).toBeEnabled();
    expect(tab('Visits')).toBeEnabled();
    expect(screen.queryByRole('form', { name: 'Fixture order editor' })).not.toBeInTheDocument();
  });

  it('clears the order, financial values and workflow panels when access is lost', async () => {
    apiMock
      .mockResolvedValueOnce({ order: detail })
      .mockRejectedValueOnce(new ApiError(403, 'Access revoked.'));
    render(<OrderDetailScreen orderId={detail.id} />);
    await screen.findByRole('heading', { level: 1, name: detail.customerName });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh order' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
    expect(
      screen.queryByRole('heading', { level: 1, name: detail.customerName }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByText('Alpine fixture team')).not.toBeInTheDocument();
    expect(screen.queryByText('€1,000.00')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Payment reference')).not.toBeInTheDocument();
  });

  it('starts a different order with its own overview and no previous edit draft', async () => {
    const secondId = 'bd335246-ffed-4792-9104-8c431365bfe4';
    const second: OrderDetail = {
      ...detail,
      id: secondId,
      number: 'FD-000002',
      customerName: 'Other order customer',
      assignedCrews: [],
      items: detail.items.map((item) => ({ ...item, orderId: secondId })),
    };
    apiMock.mockImplementation(async (path) => ({
      order: path === `/orders/${secondId}` ? second : detail,
    }));
    const { rerender } = render(
      await OrderDetailPage({ params: Promise.resolve({ id: detail.id }) }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Edit order' }));
    const firstDraft = screen.getByLabelText('Customer draft');
    fireEvent.change(firstDraft, { target: { value: 'Unsent first order' } });
    activateTab('Files');

    rerender(await OrderDetailPage({ params: Promise.resolve({ id: secondId }) }));
    await screen.findByRole('heading', { level: 1, name: second.customerName });
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('form', { name: 'Fixture order editor' })).not.toBeInTheDocument();
    expect(firstDraft).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Unsent first order')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit order' }));
    expect(screen.getByLabelText('Customer draft')).toHaveValue(second.customerName);
    expect(apiMock).toHaveBeenCalledWith(`/orders/${secondId}`, expect.anything());
  });

  it('keeps history readable and opens structured changes without losing the original reason', async () => {
    apiMock.mockResolvedValue({
      order: {
        ...detail,
        activity: [
          {
            id: '33203230-5f99-4384-917a-d856b7db6d76',
            orderId: detail.id,
            actorId: 'fixture-dispatcher',
            action: 'ORDER_UPDATED',
            targetId: detail.id,
            reason: 'Fictional customer correction',
            changes: { customerName: { from: 'Old fixture', to: 'New fixture' } },
            createdAt: detail.updatedAt,
          },
        ],
      },
    });
    render(<OrderDetailScreen orderId={detail.id} />);
    await screen.findByRole('heading', { level: 1, name: detail.customerName });
    activateTab('History');
    const history = screen.getByRole('region', { name: 'History' });
    expect(within(history).getByText('Order updated')).toBeInTheDocument();
    expect(within(history).getByText('Reason: Fictional customer correction')).toBeInTheDocument();
    expect(within(history).getByText('fixture-dispatcher')).toBeInTheDocument();
    const changes = within(history).getByText('View changes');
    fireEvent.click(changes);
    expect(changes.closest('details')).toHaveAttribute('open');
    expect(within(history).getByText('Customer Name')).toBeInTheDocument();
    expect(within(history).getByText(/Old fixture/)).toHaveTextContent('New fixture');
  });
});
