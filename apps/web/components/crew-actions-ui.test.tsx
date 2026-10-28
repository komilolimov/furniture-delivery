import type { CrewAssignmentDetail } from '@furniture-delivery/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import { crewAssignmentFixture } from '../test/execution-fixture';
import { deferred } from '../test/realtime-fixture';
import {
  ExecutionActions,
  FinishWorkForm,
  FulfillmentForm,
  TaskResultForm,
} from './crew-execution-forms';

vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const api = vi.mocked(apiRequest);
const working: CrewAssignmentDetail = {
  ...crewAssignmentFixture,
  allowedActions: ['FINISH'],
  canEditResults: true,
  execution: { ...crewAssignmentFixture.execution, status: 'IN_PROGRESS', version: 5 },
};
const callbacks = () => ({
  onSaved: vi.fn(),
  onCancel: vi.fn(),
  onReload: vi.fn(),
  onBusyChange: vi.fn(),
});
beforeEach(() => {
  api.mockReset();
});

describe('Crew execution command presentation', () => {
  it('keeps only allowed step actions and saves with the original departure versions', async () => {
    api.mockResolvedValue({ assignment: crewAssignmentFixture });
    const props = callbacks();
    const { container } = render(
      <ExecutionActions assignment={crewAssignmentFixture} {...props} disabled={false} />,
    );
    expect(screen.queryByRole('button', { name: 'Arrive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start work' })).not.toBeInTheDocument();
    const depart = screen.getByRole('button', { name: 'Depart' });
    expect(depart).toHaveAttribute('type', 'button');
    expect(depart).toHaveAttribute('data-slot', 'button');
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
    fireEvent.click(depart);
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith(
      `/crew/assignments/${crewAssignmentFixture.id}/actions/depart`,
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          expectedExecutionVersion: crewAssignmentFixture.execution.version,
          expectedAppointmentVersion: crewAssignmentFixture.appointmentVersion,
        }),
      }),
    );
  });

  it('keeps required checklist controls and native validation while adding clear form groups', () => {
    const task = { ...working.tasks[0]!, required: true };
    render(<TaskResultForm assignmentId={working.id} task={task} {...callbacks()} />);
    const form = screen.getByRole('form', { name: `Edit task ${task.name}` });
    expect(within(form).getByRole('group', { name: 'Task result' })).toBeInTheDocument();
    expect(within(form).getByLabelText('Task result')).toHaveAttribute(
      'data-slot',
      'native-select',
    );
    expect(within(form).queryByRole('option', { name: 'Skipped' })).not.toBeInTheDocument();
    expect(within(form).getByLabelText('Reason for checklist change')).toHaveAttribute(
      'maxlength',
      '4000',
    );
    expect(within(form).getByRole('button', { name: 'Save task result' })).toHaveAttribute(
      'type',
      'submit',
    );
    expect(api).not.toHaveBeenCalled();
  });

  it('separates delivery from assembly and keeps accumulated numeric bounds', () => {
    const item = {
      ...working.items[0]!,
      quantity: 3,
      requiresAssembly: true,
      deliveredQuantity: 1,
      assembledQuantity: 0,
    };
    const props = callbacks();
    const view = render(<FulfillmentForm assignmentId={working.id} item={item} {...props} />);
    expect(screen.getByRole('group', { name: 'Delivery and assembly' })).toBeInTheDocument();
    expect(screen.getByLabelText('Delivered in total')).toHaveValue(1);
    expect(screen.getByLabelText('Assembled in total')).toHaveValue(0);
    expect(screen.getByLabelText('Delivered in total')).toHaveAttribute('max', '3');
    expect(screen.getByLabelText('Assembled in total')).toHaveAttribute('step', '1');
    fireEvent.change(screen.getByLabelText('Delivered in total'), { target: { value: '0' } });
    expect(screen.getByLabelText('Reason for quantity correction')).toBeRequired();
    view.unmount();
    render(
      <FulfillmentForm
        assignmentId={working.id}
        item={{ ...item, requiresAssembly: false }}
        {...props}
      />,
    );
    expect(screen.getByLabelText('Assembled in total')).toBeDisabled();
    expect(screen.getByLabelText('Assembled in total')).toHaveAttribute('max', '0');
    expect(api).not.toHaveBeenCalled();
  });

  it('retains partial-result and return-visit requirements in the modern finish report', () => {
    render(<FinishWorkForm assignment={working} currentOpenIssueCount={2} {...callbacks()} />);
    expect(screen.getByRole('group', { name: 'Finish report' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Outcome'), {
      target: { value: 'PARTIALLY_COMPLETED' },
    });
    expect(screen.getByLabelText('Reason for partial or blocked result')).toBeRequired();
    expect(screen.getByLabelText('Remaining work')).toBeRequired();
    fireEvent.click(screen.getByLabelText('Another visit is required'));
    expect(screen.getByLabelText('Reason for another visit')).toBeRequired();
    expect(screen.getByLabelText('Reason for another visit')).toHaveAttribute('maxlength', '4000');
    expect(screen.getByText(/2 visible open issues/)).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it.each(['task', 'item', 'finish'] as const)(
    'reports pending and unknown locks for the %s editor and retries its frozen request',
    async (kind) => {
      const pending = deferred<unknown>();
      api.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ assignment: working });
      const props = callbacks();
      const task = working.tasks[0]!;
      const item = working.items[0]!;
      const element = (readOnly = false) =>
        kind === 'task' ? (
          <TaskResultForm assignmentId={working.id} task={task} {...props} readOnly={readOnly} />
        ) : kind === 'item' ? (
          <FulfillmentForm assignmentId={working.id} item={item} {...props} readOnly={readOnly} />
        ) : (
          <FinishWorkForm
            assignment={working}
            currentOpenIssueCount={0}
            {...props}
            readOnly={readOnly}
          />
        );
      const view = render(element());
      if (kind === 'finish')
        fireEvent.change(screen.getByLabelText('Result summary'), {
          target: { value: 'Our team completed the assigned work' },
        });
      fireEvent.submit(screen.getByRole('form'));
      await waitFor(() => expect(props.onBusyChange).toHaveBeenLastCalledWith(true));
      expect(screen.getByRole('button', { name: 'Discard draft' })).toBeDisabled();
      const original = api.mock.calls[0]!;
      await act(async () => pending.reject(new ApiError(503, 'Original result not confirmed')));
      const retry = await screen.findByRole('button', { name: 'Retry original request' });
      expect(props.onBusyChange).toHaveBeenLastCalledWith(true);
      view.rerender(element(true));
      expect(screen.getByRole('button', { name: 'Discard draft' })).toBeDisabled();
      fireEvent.click(retry);
      await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));
      expect(api.mock.calls[1]![0]).toBe(original[0]);
      expect(api.mock.calls[1]![1]?.body).toEqual(original[1]?.body);
      await waitFor(() => expect(props.onBusyChange).toHaveBeenLastCalledWith(false));
      view.unmount();
      expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
    },
  );

  it('clears editor ownership on unmount while a result remains in flight', async () => {
    const pending = deferred<unknown>();
    api.mockReturnValue(pending.promise);
    const props = callbacks();
    const view = render(
      <TaskResultForm assignmentId={working.id} task={working.tasks[0]!} {...props} />,
    );
    fireEvent.submit(screen.getByRole('form'));
    await waitFor(() => expect(props.onBusyChange).toHaveBeenLastCalledWith(true));
    view.unmount();
    expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
    await act(async () => pending.resolve({ assignment: working }));
    expect(props.onSaved).not.toHaveBeenCalled();
  });
});
