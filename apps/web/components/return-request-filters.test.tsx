import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseSelectOption } from '../test/select-option';
import { ReturnRequestFilters, type ReturnRequestFilterValue } from './return-request-filters';

const initial: ReturnRequestFilterValue = { status: '', pageSize: '20' };
const applied = vi.fn();
const refresh = vi.fn();
function Harness({ value = initial }: Readonly<{ value?: ReturnRequestFilterValue }>) {
  const [filters, setFilters] = useState(value);
  return (
    <ReturnRequestFilters
      value={filters}
      onApply={(next) => {
        applied(next);
        setFilters(next);
      }}
      onRefresh={refresh}
    />
  );
}
async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Filter return requests' }));
  return screen.findByRole('dialog', { name: 'Return request filters' });
}
async function escape() {
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Return request filters' }),
    ).not.toBeInTheDocument(),
  );
}
beforeEach(() => {
  applied.mockReset();
  refresh.mockReset();
});

describe('Return request filters', () => {
  it('applies status and page size together while keeping planned needs explicitly unresolved', async () => {
    render(<Harness />);
    expect(screen.queryByRole('combobox', { name: 'Request status' })).not.toBeInTheDocument();
    const panel = await open();
    await chooseSelectOption('Request status', 'Planned · need still open');
    await chooseSelectOption('Per page', '50');
    expect(applied).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.submit(within(panel).getByRole('form', { name: 'Return request filters' }));
    expect(applied).toHaveBeenCalledExactlyOnceWith({ status: 'PLANNED', pageSize: '50' });
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Return request filters' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText('50 per page')).toBeInTheDocument();
    expect(screen.getByText('Planned · need still open')).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: 'Filter return requests' })).getByText('1'),
    ).toBeInTheDocument();
  });

  it('discards drafts on Escape and Close and returns focus to the filter trigger', async () => {
    render(<Harness value={{ status: 'OPEN', pageSize: '20' }} />);
    const trigger = screen.getByRole('button', { name: 'Filter return requests' });
    trigger.focus();
    await open();
    await chooseSelectOption('Request status', 'Resolved');
    await escape();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(applied).not.toHaveBeenCalled();
    const panel = await open();
    expect(within(panel).getByRole('combobox', { name: 'Request status' })).toHaveTextContent(
      'Open',
    );
    await chooseSelectOption('Per page', '100');
    fireEvent.click(within(panel).getByRole('button', { name: 'Close request filters' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Return request filters' }),
      ).not.toBeInTheDocument(),
    );
    await open();
    expect(screen.getByRole('combobox', { name: 'Per page' })).toHaveTextContent('20');
    expect(applied).not.toHaveBeenCalled();
  });

  it('resets only the draft status and preserves the draft page size until Apply', async () => {
    render(<Harness value={{ status: 'PLANNED', pageSize: '50' }} />);
    const panel = await open();
    await chooseSelectOption('Per page', '100');
    fireEvent.click(within(panel).getByRole('button', { name: 'Reset selection' }));
    expect(screen.getByRole('combobox', { name: 'Request status' })).toHaveTextContent(
      'All requests',
    );
    expect(screen.getByRole('combobox', { name: 'Per page' })).toHaveTextContent('100');
    expect(applied).not.toHaveBeenCalled();
    fireEvent.submit(within(panel).getByRole('form', { name: 'Return request filters' }));
    expect(applied).toHaveBeenCalledExactlyOnceWith({ status: '', pageSize: '100' });
    expect(screen.queryByLabelText('Applied return request filters')).not.toBeInTheDocument();
  });

  it('removes the applied status by chip or Clear without resetting page size', () => {
    const view = render(<Harness value={{ status: 'RESOLVED', pageSize: '100' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove request status filter' }));
    expect(applied).toHaveBeenLastCalledWith({ status: '', pageSize: '100' });
    expect(screen.queryByLabelText('Applied return request filters')).not.toBeInTheDocument();
    view.unmount();
    render(<Harness value={{ status: 'OPEN', pageSize: '50' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear request filters' }));
    expect(applied).toHaveBeenLastCalledWith({ status: '', pageSize: '50' });
    expect(screen.getByText('50 per page')).toBeInTheDocument();
  });

  it('keeps open drafts on a background rerender and reopens with the current parent criteria', async () => {
    const view = render(
      <ReturnRequestFilters value={initial} onApply={applied} onRefresh={refresh} />,
    );
    const panel = await open();
    await chooseSelectOption('Request status', 'Planned · need still open');
    view.rerender(
      <ReturnRequestFilters value={{ ...initial }} onApply={applied} onRefresh={refresh} />,
    );
    expect(within(panel).getByRole('combobox', { name: 'Request status' })).toHaveTextContent(
      'Planned · need still open',
    );
    expect(applied).not.toHaveBeenCalled();
    await escape();
    view.rerender(
      <ReturnRequestFilters
        value={{ ...initial, status: 'RESOLVED' }}
        onApply={applied}
        onRefresh={refresh}
      />,
    );
    await open();
    expect(screen.getByRole('combobox', { name: 'Request status' })).toHaveTextContent('Resolved');
  });

  it('refreshes only explicitly and preserves the accessible button name while pending', () => {
    const view = render(
      <ReturnRequestFilters value={initial} onApply={applied} onRefresh={refresh} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh requests' }));
    expect(refresh).toHaveBeenCalledExactlyOnceWith();
    expect(applied).not.toHaveBeenCalled();
    view.rerender(
      <ReturnRequestFilters value={initial} onApply={applied} onRefresh={refresh} refreshing />,
    );
    const busy = screen.getByRole('button', { name: 'Refresh requests' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveTextContent('Refreshing requests…');
    fireEvent.click(busy);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
