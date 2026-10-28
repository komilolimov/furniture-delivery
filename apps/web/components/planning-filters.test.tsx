import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planningCrews } from '../test/planning-fixture';
import { chooseSelectOption } from '../test/select-option';
import {
  initialPlanningFilters,
  PlanningFilters,
  type PlanningFilterValue,
} from './planning-filters';

const applied = vi.fn();
const retry = vi.fn();
function Harness({
  initial = initialPlanningFilters,
}: Readonly<{ initial?: PlanningFilterValue }>) {
  const [value, setValue] = useState(initial);
  return (
    <PlanningFilters
      value={value}
      onApply={(next) => {
        applied(next);
        setValue(next);
      }}
      crews={planningCrews}
      pending={false}
      error={null}
      onRetry={retry}
    />
  );
}
async function openFilters() {
  fireEvent.click(screen.getByRole('button', { name: 'Teams & filters' }));
  return screen.findByRole('dialog', { name: 'Planning filters' });
}
async function dismiss() {
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Planning filters' })).not.toBeInTheDocument(),
  );
}
beforeEach(() => {
  applied.mockReset();
  retry.mockReset();
});

describe('Planning filters with local drafts', () => {
  it('keeps filter fields collapsed and does not apply local team search or choices until confirmation', async () => {
    render(<Harness />);
    expect(screen.queryByRole('checkbox', { name: 'All teams' })).not.toBeInTheDocument();
    const panel = await openFilters();
    expect(within(panel).getByLabelText('All teams')).toBeChecked();
    expect(within(panel).getByLabelText('Include unassigned')).toBeChecked();
    expect(within(panel).getByLabelText('Filter team Inactive Team')).toBeDisabled();
    fireEvent.change(within(panel).getByLabelText('Find teams'), { target: { value: '  aur  ' } });
    expect(within(panel).getByLabelText('Filter team Aurora')).toBeInTheDocument();
    expect(within(panel).queryByLabelText('Filter team Birch')).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByLabelText('All teams'));
    fireEvent.click(within(panel).getByLabelText('Filter team Aurora'));
    expect(applied).not.toHaveBeenCalled();
    fireEvent.submit(within(panel).getByRole('form', { name: 'Planning filters' }));
    expect(applied).toHaveBeenCalledExactlyOnceWith({
      ...initialPlanningFilters,
      allTeams: false,
      crewIds: [planningCrews[0]!.id],
    });
  });

  it('discards changes on Escape, returns focus and restores applied values without retaining team search', async () => {
    render(
      <Harness
        initial={{
          ...initialPlanningFilters,
          confirmation: 'CONFIRMED',
          allTeams: false,
          crewIds: [planningCrews[1]!.id],
        }}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Teams & filters' });
    trigger.focus();
    const panel = await openFilters();
    fireEvent.click(within(panel).getByLabelText('Include unassigned'));
    fireEvent.click(within(panel).getByLabelText('Filter team Inactive Team'));
    await chooseSelectOption('Confirmation', 'Needs confirmation');
    fireEvent.change(within(panel).getByLabelText('Find teams'), {
      target: { value: 'Missing crew' },
    });
    expect(within(panel).getByText('No matching teams.')).toBeInTheDocument();
    await dismiss();
    await waitFor(() => expect(trigger).toHaveFocus());
    const reopened = await openFilters();
    expect(within(reopened).getByLabelText('Find teams')).toHaveValue('');
    expect(within(reopened).getByLabelText('Include unassigned')).toBeChecked();
    expect(within(reopened).getByLabelText('Filter team Birch')).toBeChecked();
    expect(within(reopened).getByLabelText('Filter team Inactive Team')).not.toBeChecked();
    expect(within(reopened).getByRole('combobox', { name: 'Confirmation' })).toHaveTextContent(
      'Confirmed',
    );
    expect(applied).not.toHaveBeenCalled();
  });

  it('preserves explicit teams through All teams toggles, includes inactive teams and applies sorted IDs once', async () => {
    render(<Harness />);
    const panel = await openFilters();
    fireEvent.click(within(panel).getByLabelText('All teams'));
    fireEvent.click(within(panel).getByLabelText('Filter team Inactive Team'));
    fireEvent.click(within(panel).getByLabelText('Filter team Aurora'));
    fireEvent.click(within(panel).getByLabelText('All teams'));
    expect(within(panel).getByLabelText('Filter team Inactive Team')).toBeChecked();
    expect(within(panel).getByLabelText('Filter team Inactive Team')).toBeDisabled();
    fireEvent.click(within(panel).getByLabelText('All teams'));
    expect(within(panel).getByLabelText('Filter team Inactive Team')).toBeEnabled();
    fireEvent.click(within(panel).getByLabelText('Include unassigned'));
    await chooseSelectOption('Attention', 'Needs attention');
    await chooseSelectOption('Service', 'Delivery only');
    await chooseSelectOption('Work progress', 'In progress');
    fireEvent.submit(within(panel).getByRole('form', { name: 'Planning filters' }));
    expect(applied).toHaveBeenCalledExactlyOnceWith({
      ...initialPlanningFilters,
      allTeams: false,
      includeUnassigned: false,
      crewIds: [planningCrews[0]!.id, planningCrews[2]!.id],
      attention: 'attention',
      serviceType: 'DELIVERY_ONLY',
      progress: 'IN_PROGRESS',
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Planning filters' })).not.toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole('button', { name: 'Teams & filters' })).getByText('5'),
    ).toBeInTheDocument();
  });

  it('keeps Reset selection local, supports an explicit empty team selection and applies Clear separately', async () => {
    const initial: PlanningFilterValue = {
      ...initialPlanningFilters,
      allTeams: false,
      crewIds: [],
      includeUnassigned: false,
      confirmation: 'CONFIRMED',
      progress: 'ASSIGNED',
    };
    render(<Harness initial={initial} />);
    expect(screen.getByRole('button', { name: 'Remove team filter' })).toHaveTextContent(
      'No teams selected',
    );
    const panel = await openFilters();
    fireEvent.click(within(panel).getByRole('button', { name: 'Reset selection' }));
    expect(within(panel).getByLabelText('All teams')).toBeChecked();
    expect(within(panel).getByLabelText('Include unassigned')).toBeChecked();
    expect(within(panel).getByRole('combobox', { name: 'Confirmation' })).toHaveTextContent(
      'All confirmations',
    );
    expect(applied).not.toHaveBeenCalled();
    await dismiss();
    fireEvent.click(screen.getByRole('button', { name: 'Remove confirmation filter' }));
    expect(applied).toHaveBeenLastCalledWith({ ...initial, confirmation: 'all' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(applied).toHaveBeenLastCalledWith(initialPlanningFilters);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('keeps draft choices through a background rerender and offers an independent retry for the team catalogue', async () => {
    const props = {
      value: initialPlanningFilters,
      onApply: applied,
      crews: planningCrews,
      pending: true,
      error: null,
      onRetry: retry,
    };
    const { rerender } = render(<PlanningFilters {...props} />);
    const panel = await openFilters();
    expect(within(panel).getByRole('status')).toHaveTextContent('Loading teams');
    fireEvent.click(within(panel).getByLabelText('All teams'));
    fireEvent.click(within(panel).getByLabelText('Filter team Birch'));
    fireEvent.change(within(panel).getByLabelText('Find teams'), { target: { value: 'Birch' } });
    rerender(
      <PlanningFilters
        {...props}
        value={{ ...initialPlanningFilters }}
        pending={false}
        error="Teams unavailable"
      />,
    );
    expect(within(panel).getByLabelText('Find teams')).toHaveValue('Birch');
    expect(within(panel).getByLabelText('Filter team Birch')).toBeChecked();
    expect(within(panel).getByRole('alert')).toHaveTextContent('Teams unavailable');
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry teams' }));
    expect(retry).toHaveBeenCalledExactlyOnceWith();
    expect(applied).not.toHaveBeenCalled();
  });
});
