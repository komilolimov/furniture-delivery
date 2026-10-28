import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseSelectOption } from '../test/select-option';
import { AccountFilters, initialAccountFilters, type AccountFilterValue } from './account-filters';

const applied = vi.fn();
function Harness({ initial = initialAccountFilters }: Readonly<{ initial?: AccountFilterValue }>) {
  const [value, setValue] = useState(initial);
  return (
    <AccountFilters
      value={value}
      onApply={(next) => {
        applied(next);
        setValue(next);
      }}
    />
  );
}
async function openFilters() {
  fireEvent.click(screen.getByRole('button', { name: 'Filter accounts' }));
  return screen.findByRole('dialog', { name: 'Account filters' });
}
async function dismiss() {
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Account filters' })).not.toBeInTheDocument(),
  );
}
beforeEach(() => {
  applied.mockReset();
});

describe('Account directory filters', () => {
  it('applies normalized search and the three advanced choices together exactly once', async () => {
    render(<Harness />);
    expect(screen.queryByRole('combobox', { name: 'Account role' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search accounts' }), {
      target: { value: '  Synthetic worker  ' },
    });
    expect(applied).not.toHaveBeenCalled();
    const panel = await openFilters();
    await chooseSelectOption('Account role', 'Team member');
    await chooseSelectOption('Account status', 'Enabled');
    await chooseSelectOption('Team membership', 'Team members without a team');
    expect(applied).not.toHaveBeenCalled();
    fireEvent.submit(within(panel).getByRole('form', { name: 'Account filters' }));
    expect(applied).toHaveBeenCalledExactlyOnceWith({
      search: 'Synthetic worker',
      role: 'CREW_MEMBER',
      status: 'enabled',
      membership: 'unassigned',
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Account filters' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('textbox', { name: 'Search accounts' })).toHaveValue(
      'Synthetic worker',
    );
    expect(
      within(screen.getByRole('button', { name: 'Filter accounts' })).getByText('3'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove membership filter' })).toBeInTheDocument();
  });

  it('discards advanced drafts on Escape and returns focus without erasing an unsent search', async () => {
    render(
      <Harness initial={{ ...initialAccountFilters, role: 'DISPATCHER', status: 'enabled' }} />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Search accounts' }), {
      target: { value: 'Unsent name' },
    });
    const trigger = screen.getByRole('button', { name: 'Filter accounts' });
    trigger.focus();
    await openFilters();
    await chooseSelectOption('Account role', 'Administrator');
    await chooseSelectOption('Account status', 'Disabled');
    await dismiss();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByRole('textbox', { name: 'Search accounts' })).toHaveValue('Unsent name');
    expect(applied).not.toHaveBeenCalled();
    const panel = await openFilters();
    expect(within(panel).getByRole('combobox', { name: 'Account role' })).toHaveTextContent(
      'Dispatcher',
    );
    expect(within(panel).getByRole('combobox', { name: 'Account status' })).toHaveTextContent(
      'Enabled',
    );
    fireEvent.click(within(panel).getByRole('button', { name: 'Close account filters' }));
    fireEvent.submit(screen.getByRole('search', { name: 'Search accounts' }));
    expect(applied).toHaveBeenCalledExactlyOnceWith({
      ...initialAccountFilters,
      role: 'DISPATCHER',
      status: 'enabled',
      search: 'Unsent name',
    });
  });

  it('keeps Reset selection local until Apply and includes the current search text', async () => {
    render(
      <Harness
        initial={{
          search: 'Previous',
          role: 'CREW_MEMBER',
          status: 'disabled',
          membership: 'assigned',
        }}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Search accounts' }), {
      target: { value: '  Revised name  ' },
    });
    const panel = await openFilters();
    fireEvent.click(within(panel).getByRole('button', { name: 'Reset selection' }));
    expect(within(panel).getByRole('combobox', { name: 'Account role' })).toHaveTextContent(
      'All roles',
    );
    expect(within(panel).getByRole('combobox', { name: 'Account status' })).toHaveTextContent(
      'All statuses',
    );
    expect(within(panel).getByRole('combobox', { name: 'Team membership' })).toHaveTextContent(
      'All users',
    );
    expect(applied).not.toHaveBeenCalled();
    fireEvent.submit(within(panel).getByRole('form', { name: 'Account filters' }));
    expect(applied).toHaveBeenCalledExactlyOnceWith({
      ...initialAccountFilters,
      search: 'Revised name',
    });
  });

  it('removes one applied condition without changing others and clears all fields explicitly', () => {
    const initial: AccountFilterValue = {
      search: 'worker',
      role: 'CREW_MEMBER',
      status: 'enabled',
      membership: 'assigned',
    };
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove role filter' }));
    expect(applied).toHaveBeenLastCalledWith({ ...initial, role: 'all' });
    expect(screen.getByRole('textbox', { name: 'Search accounts' })).toHaveValue('worker');
    expect(screen.getByRole('button', { name: 'Remove status filter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove membership filter' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove search filter' }));
    expect(applied).toHaveBeenLastCalledWith({ ...initial, role: 'all', search: '' });
    expect(screen.getByRole('textbox', { name: 'Search accounts' })).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search accounts' }), {
      target: { value: 'Unsent text' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(applied).toHaveBeenLastCalledWith(initialAccountFilters);
    expect(screen.getByRole('textbox', { name: 'Search accounts' })).toHaveValue('');
    expect(screen.queryByLabelText('Applied account filters')).not.toBeInTheDocument();
  });

  it('preserves local drafts across a background rerender while adopting a parent search clear', async () => {
    const initial: AccountFilterValue = { ...initialAccountFilters, search: 'Saved name' };
    const view = render(<AccountFilters value={initial} onApply={applied} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search accounts' }), {
      target: { value: 'Unsent updated name' },
    });
    const panel = await openFilters();
    await chooseSelectOption('Account role', 'Administrator');
    view.rerender(<AccountFilters value={{ ...initial }} onApply={applied} />);
    expect(within(panel).getByRole('combobox', { name: 'Account role' })).toHaveTextContent(
      'Administrator',
    );
    expect(applied).not.toHaveBeenCalled();
    await dismiss();
    expect(screen.getByRole('textbox', { name: 'Search accounts' })).toHaveValue(
      'Unsent updated name',
    );
    view.rerender(<AccountFilters value={{ ...initialAccountFilters }} onApply={applied} />);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Search accounts' })).toHaveValue(''),
    );
    expect(applied).not.toHaveBeenCalled();
  });
});
