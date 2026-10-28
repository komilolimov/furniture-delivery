import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseSelectOption } from '../test/select-option';
import { IssueFilters, type IssueFilterValue } from './issue-filters';

const initial: IssueFilterValue = { status: '', type: '', pageSize: '20' };
const applied = vi.fn();
const refresh = vi.fn();
function Harness({ value = initial }: Readonly<{ value?: IssueFilterValue }>) {
  const [filters, setFilters] = useState(value);
  return (
    <IssueFilters
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
  fireEvent.click(screen.getByRole('button', { name: 'Filter issues' }));
  return screen.findByRole('dialog', { name: 'Issue filters' });
}
async function escape() {
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Issue filters' })).not.toBeInTheDocument(),
  );
}
beforeEach(() => {
  applied.mockReset();
  refresh.mockReset();
});

describe('Issue filters', () => {
  it('applies server status, type and page size together, never while choosing', async () => {
    render(<Harness />);
    expect(screen.queryByRole('combobox', { name: 'Issue status' })).not.toBeInTheDocument();
    const panel = await open();
    await chooseSelectOption('Issue status', 'Open');
    await chooseSelectOption('Issue type', 'Missing parts');
    await chooseSelectOption('Per page', '50');
    expect(applied).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.submit(within(panel).getByRole('form', { name: 'Issue filters' }));
    expect(applied).toHaveBeenCalledExactlyOnceWith({
      status: 'OPEN',
      type: 'MISSING_PARTS',
      pageSize: '50',
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Issue filters' })).not.toBeInTheDocument(),
    );
    expect(screen.getByText('50 per page')).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: 'Filter issues' })).getByText('2'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove issue type filter' })).toBeInTheDocument();
  });

  it('discards draft choices on Escape and Close and returns keyboard focus', async () => {
    const value: IssueFilterValue = { status: 'OPEN', type: 'DAMAGE', pageSize: '20' };
    render(<Harness value={value} />);
    const trigger = screen.getByRole('button', { name: 'Filter issues' });
    trigger.focus();
    await open();
    await chooseSelectOption('Issue status', 'Resolved');
    await chooseSelectOption('Issue type', 'Other');
    await escape();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(applied).not.toHaveBeenCalled();
    const panel = await open();
    expect(within(panel).getByRole('combobox', { name: 'Issue status' })).toHaveTextContent('Open');
    expect(within(panel).getByRole('combobox', { name: 'Issue type' })).toHaveTextContent('Damage');
    await chooseSelectOption('Per page', '100');
    fireEvent.click(within(panel).getByRole('button', { name: 'Close issue filters' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Issue filters' })).not.toBeInTheDocument(),
    );
    await open();
    expect(screen.getByRole('combobox', { name: 'Per page' })).toHaveTextContent('20');
    expect(applied).not.toHaveBeenCalled();
  });

  it('keeps Reset selection local until Apply and preserves the selected page size', async () => {
    render(<Harness value={{ status: 'RESOLVED', type: 'WRONG_PRODUCT', pageSize: '50' }} />);
    const panel = await open();
    await chooseSelectOption('Per page', '100');
    fireEvent.click(within(panel).getByRole('button', { name: 'Reset selection' }));
    expect(screen.getByRole('combobox', { name: 'Issue status' })).toHaveTextContent('All issues');
    expect(screen.getByRole('combobox', { name: 'Issue type' })).toHaveTextContent('All types');
    expect(screen.getByRole('combobox', { name: 'Per page' })).toHaveTextContent('100');
    expect(applied).not.toHaveBeenCalled();
    fireEvent.submit(within(panel).getByRole('form', { name: 'Issue filters' }));
    expect(applied).toHaveBeenCalledExactlyOnceWith({ status: '', type: '', pageSize: '100' });
    expect(screen.queryByLabelText('Applied issue filters')).not.toBeInTheDocument();
  });

  it('removes one applied condition and clears the others without resetting page size', () => {
    const value: IssueFilterValue = { status: 'OPEN', type: 'DAMAGE', pageSize: '100' };
    render(<Harness value={value} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove issue type filter' }));
    expect(applied).toHaveBeenLastCalledWith({ ...value, type: '' });
    expect(screen.getByRole('button', { name: 'Remove issue status filter' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear issue filters' }));
    expect(applied).toHaveBeenLastCalledWith({ status: '', type: '', pageSize: '100' });
    expect(screen.getByText('100 per page')).toBeInTheDocument();
    expect(screen.queryByLabelText('Applied issue filters')).not.toBeInTheDocument();
  });

  it('preserves the open draft on a refresh rerender, but reopens from current parent criteria', async () => {
    const view = render(<IssueFilters value={initial} onApply={applied} onRefresh={refresh} />);
    const panel = await open();
    await chooseSelectOption('Issue type', 'Access problem');
    view.rerender(<IssueFilters value={{ ...initial }} onApply={applied} onRefresh={refresh} />);
    expect(within(panel).getByRole('combobox', { name: 'Issue type' })).toHaveTextContent(
      'Access problem',
    );
    expect(applied).not.toHaveBeenCalled();
    await escape();
    view.rerender(
      <IssueFilters
        value={{ ...initial, status: 'RESOLVED' }}
        onApply={applied}
        onRefresh={refresh}
      />,
    );
    await open();
    expect(screen.getByRole('combobox', { name: 'Issue status' })).toHaveTextContent('Resolved');
    expect(screen.getByRole('combobox', { name: 'Issue type' })).toHaveTextContent('All types');
  });

  it('refreshes only on request and prevents a second refresh while pending', () => {
    const view = render(<IssueFilters value={initial} onApply={applied} onRefresh={refresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh issues' }));
    expect(refresh).toHaveBeenCalledExactlyOnceWith();
    expect(applied).not.toHaveBeenCalled();
    view.rerender(
      <IssueFilters value={initial} onApply={applied} onRefresh={refresh} refreshing />,
    );
    const busy = screen.getByRole('button', { name: 'Refreshing issues…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(busy);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
