import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../lib/api-client';
import { orderFixture } from '../test/order-fixture';
import { OrderList } from './order-list';
vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const mock = vi.mocked(apiRequest);
beforeEach(() => {
  mock.mockReset();
});
it('shows assigned teams from the list response and all teams from protected detail preview', async () => {
  const crews = [
    { id: 'a', code: 'A', name: 'Alpine test crew' },
    { id: 'b', code: 'B', name: 'Coast test crew' },
    { id: 'c', code: 'C', name: 'Garden test crew' },
  ];
  const order = { ...orderFixture, assignedCrews: crews };
  mock.mockImplementation(async (path) =>
    path.startsWith('/orders?') ? { orders: [order], total: 1, page: 1, pageSize: 10 } : { order },
  );
  render(<OrderList />);
  const table = await screen.findByRole('table', { name: 'Orders' });
  expect(within(table).getByRole('columnheader', { name: 'Teams' })).toBeInTheDocument();
  expect(within(table).getByText('Alpine test crew')).toBeInTheDocument();
  expect(within(table).getByText('Coast test crew')).toBeInTheDocument();
  expect(within(table).getByText(/Garden test crew/)).toBeInTheDocument();
  fireEvent.click(within(table).getByRole('button', { name: `Preview order ${order.number}` }));
  const dialog = await screen.findByRole('dialog', { name: 'Order preview' });
  const teams = await within(dialog).findByRole('region', { name: 'Assigned teams' });
  for (const crew of crews) expect(within(teams).getByText(crew.name)).toBeInTheDocument();
  expect(mock).toHaveBeenCalledWith(`/orders/${order.id}`, expect.anything());
});
