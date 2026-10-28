import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../lib/api-client';
import { planningCrews } from '../test/planning-fixture';
import { returnDetailFixture } from '../test/return-fixture';
import { ReturnVisitPlanForm } from './return-visit-plan-form';
vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const api = vi.mocked(apiRequest);
const props = () => ({
  detail: returnDetailFixture,
  crews: planningCrews,
  onSaved: vi.fn(),
  onRefresh: vi.fn(async () => undefined),
});
beforeEach(() => {
  api.mockReset();
});

describe('Follow-up plan workspace', () => {
  it('keeps six discoverable form groups with native labels and decorative icons', () => {
    const { container } = render(<ReturnVisitPlanForm {...props()} />);
    for (const title of [
      'Teams and duration',
      'Unfinished carried work',
      'Explicit new work',
      'Absolute accumulated item targets',
      'Find available time',
      'Reason and preview',
    ]) {
      expect(screen.getByRole('group', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Visit duration in minutes')).toHaveAttribute('min', '1');
    expect(screen.getByLabelText('Visit duration in minutes')).toHaveAttribute('max', '1440');
    expect(screen.getByLabelText('Visit duration in minutes')).toHaveAttribute(
      'data-slot',
      'input',
    );
    expect(screen.getByLabelText('Team for Assemble remaining cabinet')).toHaveAttribute(
      'data-slot',
      'native-select',
    );
    expect(screen.getByLabelText('Reason for return plan')).toHaveAttribute(
      'data-slot',
      'textarea',
    );
    expect(screen.getByRole('button', { name: 'Confirm and plan return visit' })).toHaveAttribute(
      'type',
      'submit',
    );
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(5);
    expect(api).not.toHaveBeenCalled();
  });

  it('explains empty scope and team choices and lets new tasks be drafted without submitting', () => {
    render(
      <ReturnVisitPlanForm
        {...props()}
        crews={[]}
        detail={{ ...returnDetailFixture, scopeCandidates: [], items: [] }}
      />,
    );
    expect(screen.getByText('No enabled teams are available to select.')).toBeInTheDocument();
    expect(
      screen.getByText('No unfinished source tasks. Choose explicit new work or item targets.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No item targets are available for this order.')).toBeInTheDocument();
    expect(
      screen.getByText('No additional tasks. Add one only when the follow-up needs new work.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add explicit new task' }));
    fireEvent.change(screen.getByLabelText('New task 1 name'), {
      target: { value: 'Check the replacement hinge' },
    });
    expect(screen.getByLabelText('New task 1 name')).toHaveValue('Check the replacement hinge');
    fireEvent.click(screen.getByRole('button', { name: 'Remove new task 1' }));
    expect(screen.queryByLabelText('New task 1 name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm and plan return visit' })).toBeDisabled();
    expect(api).not.toHaveBeenCalled();
  });

  it('keeps an additional task draft and original revision while saved data refreshes', () => {
    const initial = props();
    const view = render(<ReturnVisitPlanForm {...initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add explicit new task' }));
    fireEvent.change(screen.getByLabelText('New task 1 name'), {
      target: { value: 'Inspect replacement fittings' },
    });
    fireEvent.change(screen.getByLabelText('Reason for new task 1'), {
      target: { value: 'The replacement is a different fitting' },
    });
    view.rerender(
      <ReturnVisitPlanForm
        {...initial}
        detail={{ ...returnDetailFixture, request: { ...returnDetailFixture.request, version: 3 } }}
      />,
    );
    expect(screen.getByLabelText('New task 1 name')).toHaveValue('Inspect replacement fittings');
    expect(screen.getByLabelText('Reason for new task 1')).toHaveValue(
      'The replacement is a different fitting',
    );
    expect(screen.getByText(/Draft request revision 2/)).toBeInTheDocument();
    expect(
      within(screen.getByRole('form', { name: 'Plan return visit' })).getByRole('button', {
        name: 'Confirm and plan return visit',
      }),
    ).toBeDisabled();
    expect(api).not.toHaveBeenCalled();
  });
});
