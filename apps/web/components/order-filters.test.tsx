import { chooseSelectOption } from '../test/select-option';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderFilters, type OrderFilterValues } from './order-filters';

const empty: OrderFilterValues = {
  search: '',
  serviceType: '',
  paymentStatus: '',
  progress: '',
  hasOpenIssues: '',
  pageSize: '10',
};
const applied = vi.fn();
function Harness({ initial = empty }: Readonly<{ initial?: OrderFilterValues }>) {
  const [value, setValue] = useState(initial);
  return (
    <OrderFilters
      value={value}
      onApply={(next) => {
        applied(next);
        setValue(next);
      }}
    />
  );
}
async function openFilters() {
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  return screen.findByRole('dialog', { name: 'Order filters' });
}
async function dismissFilters() {
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Order filters' })).not.toBeInTheDocument(),
  );
}
beforeEach(() => applied.mockReset());

describe('Compact order filters', () => {
  it('keeps advanced fields out of the toolbar until the accessible Filters control is opened', async () => {
    render(<Harness />);
    expect(screen.getByRole('form', { name: 'Order search' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search orders' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Work progress' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Payment status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Service' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Filters' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    const dialog = await openFilters();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(dialog).getByRole('form', { name: 'Advanced order filters' }),
    ).toBeInTheDocument();
    for (const label of ['Work progress', 'Payment status', 'Service', 'Issues']) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    }
    expect(applied).not.toHaveBeenCalled();
  });

  it('discards unconfirmed advanced choices on Escape, restores focus, and keeps the separate search draft', async () => {
    render(<Harness initial={{ ...empty, search: 'Rome', progress: 'ASSIGNED' }} />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Unsubmitted chair' } });
    const trigger = screen.getByRole('button', { name: 'Filters' });
    trigger.focus();
    await openFilters();
    await chooseSelectOption('Work progress', 'Completed');
    await chooseSelectOption('Payment status', 'Unpaid');
    await chooseSelectOption('Service', 'Delivery only');
    expect(applied).not.toHaveBeenCalled();

    await dismissFilters();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByLabelText('Search')).toHaveValue('Unsubmitted chair');
    const reopened = await openFilters();
    expect(within(reopened).getByRole('combobox', { name: 'Work progress' })).toHaveTextContent(
      'Assigned',
    );
    expect(within(reopened).getByRole('combobox', { name: 'Payment status' })).toHaveTextContent(
      'All payment states',
    );
    expect(within(reopened).getByRole('combobox', { name: 'Service' })).toHaveTextContent(
      'All services',
    );
    expect(applied).not.toHaveBeenCalled();
  });

  it('submits a trimmed search with current applied criteria, without reviving dismissed advanced choices', async () => {
    const initial: OrderFilterValues = {
      ...empty,
      progress: 'ASSIGNED',
      hasOpenIssues: 'false',
      pageSize: '25',
    };
    render(<Harness initial={initial} />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '  Rome & chair  ' } });
    await openFilters();
    await chooseSelectOption('Payment status', 'Paid');
    await dismissFilters();
    fireEvent.submit(screen.getByRole('form', { name: 'Order search' }));

    expect(applied).toHaveBeenCalledExactlyOnceWith({ ...initial, search: 'Rome & chair' });
    expect(screen.getByLabelText('Search')).toHaveValue('Rome & chair');
    expect(screen.getByRole('button', { name: 'Remove search filter' })).toBeInTheDocument();
  });

  it('confirms the advanced selections and pending search together, and counts only advanced criteria', async () => {
    render(<Harness initial={{ ...empty, pageSize: '50' }} />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '  Chair  ' } });
    const dialog = await openFilters();
    await chooseSelectOption('Work progress', 'In progress');
    await chooseSelectOption('Payment status', 'Unpaid');
    await chooseSelectOption('Service', 'Delivery only');
    await chooseSelectOption('Issues', 'Has open issues');
    fireEvent.submit(within(dialog).getByRole('form', { name: 'Advanced order filters' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Order filters' })).not.toBeInTheDocument(),
    );

    expect(applied).toHaveBeenCalledExactlyOnceWith({
      search: 'Chair',
      serviceType: 'DELIVERY_ONLY',
      paymentStatus: 'UNPAID',
      progress: 'IN_PROGRESS',
      hasOpenIssues: 'true',
      pageSize: '50',
    });
    expect(
      within(screen.getByRole('button', { name: 'Filters' })).getByText('4'),
    ).toBeInTheDocument();
    for (const criterion of ['search', 'work progress', 'payment status', 'service', 'issues']) {
      expect(
        screen.getByRole('button', { name: `Remove ${criterion} filter` }),
      ).toBeInTheDocument();
    }
  });

  it('removes one applied criterion without disturbing others and clears criteria without resetting page size', async () => {
    const initial: OrderFilterValues = {
      search: 'Rome',
      serviceType: 'DELIVERY_ONLY',
      paymentStatus: 'UNPAID',
      progress: 'ASSIGNED',
      hasOpenIssues: 'true',
      pageSize: '25',
    };
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove payment status filter' }));
    expect(applied).toHaveBeenLastCalledWith({ ...initial, paymentStatus: '' });
    expect(
      within(screen.getByRole('button', { name: 'Filters' })).getByText('3'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove work progress filter' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toHaveValue('Rome');

    fireEvent.click(screen.getByRole('button', { name: 'Remove search filter' }));
    expect(applied).toHaveBeenLastCalledWith({ ...initial, search: '', paymentStatus: '' });
    expect(screen.getByLabelText('Search')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(applied).toHaveBeenLastCalledWith({ ...empty, pageSize: '25' });
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove work progress filter' }),
    ).not.toBeInTheDocument();
  });

  it('preserves typing across a background rerender and keeps Reset selection local until confirmation', async () => {
    const initial: OrderFilterValues = { ...empty, progress: 'ASSIGNED' };
    const { rerender } = render(<OrderFilters value={initial} onApply={applied} />);
    const search = screen.getByLabelText('Search');
    fireEvent.change(search, { target: { value: 'Pending search' } });
    rerender(<OrderFilters value={{ ...initial }} onApply={applied} />);
    expect(search).toHaveValue('Pending search');
    const dialog = await openFilters();
    await chooseSelectOption('Payment status', 'Unpaid');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset selection' }));
    expect(within(dialog).getByRole('combobox', { name: 'Work progress' })).toHaveTextContent(
      'All work states',
    );
    expect(within(dialog).getByRole('combobox', { name: 'Payment status' })).toHaveTextContent(
      'All payment states',
    );
    expect(applied).not.toHaveBeenCalled();
    expect(search).toHaveValue('Pending search');

    await dismissFilters();
    const reopened = await openFilters();
    expect(within(reopened).getByRole('combobox', { name: 'Work progress' })).toHaveTextContent(
      'Assigned',
    );
    expect(within(reopened).getByRole('combobox', { name: 'Payment status' })).toHaveTextContent(
      'All payment states',
    );
    expect(applied).not.toHaveBeenCalled();
  });
});
