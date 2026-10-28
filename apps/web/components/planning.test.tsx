import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentResponse } from '@furniture-delivery/contracts';
import { apiRequest, ApiError } from '../lib/api-client';
import {
  appointmentFixture,
  plannedOrderFixture,
  planningCrews,
  planningTemplates,
} from '../test/planning-fixture';
import { AppointmentForm } from './appointment-form';
import { AppointmentCard, OrderAppointments } from './order-appointments';

vi.mock('../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const apiMock = vi.mocked(apiRequest);
const response: AppointmentResponse = {
  appointment: appointmentFixture,
  order: plannedOrderFixture,
};
const props = { order: plannedOrderFixture, crews: planningCrews, templates: planningTemplates };
const form = () =>
  screen
    .getByRole('button', { name: /^(Create visit|Save visit|Retry same visit)$/ })
    .closest('form')!;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};
beforeEach(() => {
  apiMock.mockReset();
});

describe('M4 appointment form', () => {
  it('starts from the order estimate, leaves no teams as Unassigned, and prevents selecting inactive teams or removing required templates', async () => {
    const saved = vi.fn();
    apiMock.mockResolvedValue(response);
    render(<AppointmentForm {...props} onSaved={saved} />);
    expect(screen.getByLabelText('Duration (minutes)')).toHaveValue(
      plannedOrderFixture.estimatedDurationMinutes,
    );
    expect(screen.getByLabelText('Team Inactive Team')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Check products/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Check products/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Local start (Europe/Rome)'), {
      target: { value: '2030-01-07T09:00' },
    });
    fireEvent.submit(form());
    await waitFor(() => expect(saved).toHaveBeenCalledWith(response));
    const [, options] = apiMock.mock.calls[0]!;
    expect(options?.body).toEqual(
      expect.objectContaining({
        localStart: '2030-01-07T09:00',
        durationMinutes: plannedOrderFixture.estimatedDurationMinutes,
        crewIds: [],
        templateIds: [],
        idempotencyKey: expect.any(String),
      }),
    );
  });
  it('keeps a datetime-local input event after another field rerenders the form', async () => {
    apiMock.mockResolvedValue(response);
    render(<AppointmentForm {...props} onSaved={vi.fn()} />);
    fireEvent.input(screen.getByLabelText('Local start (Europe/Rome)'), {
      target: { value: '2030-01-08T10:15' },
    });
    fireEvent.click(screen.getByLabelText('Team Aurora'));
    expect(screen.getByLabelText('Local start (Europe/Rome)')).toHaveValue('2030-01-08T10:15');
    fireEvent.submit(form());
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    expect(apiMock.mock.calls[0]![1]?.body).toEqual(
      expect.objectContaining({ localStart: '2030-01-08T10:15', crewIds: [planningCrews[0]!.id] }),
    );
  });

  it('freezes one create attempt and operation key across a lost response and Retry', async () => {
    const saved = vi.fn();
    apiMock.mockRejectedValueOnce(new ApiError(0, 'Network lost')).mockResolvedValueOnce(response);
    render(<AppointmentForm {...props} onSaved={saved} />);
    fireEvent.change(screen.getByLabelText('Local start (Europe/Rome)'), {
      target: { value: '2030-01-07T09:00' },
    });
    fireEvent.click(screen.getByLabelText('Team Aurora'));
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Original draft' } });
    fireEvent.submit(form());
    await screen.findByRole('button', { name: 'Retry same visit' });
    expect(screen.getByLabelText('Notes')).toBeDisabled();
    expect(screen.getByLabelText('Local start (Europe/Rome)')).toBeDisabled();
    const original = apiMock.mock.calls[0]![1]?.body;
    fireEvent.click(screen.getByRole('button', { name: 'Retry same visit' }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(apiMock.mock.calls[1]![1]?.body).toEqual(original);
  });
  it('blocks an immediate duplicate submit while a create request is pending', async () => {
    const pending = deferred<AppointmentResponse>(),
      saved = vi.fn();
    apiMock.mockReturnValue(pending.promise);
    render(<AppointmentForm {...props} onSaved={saved} />);
    const currentForm = form();
    fireEvent.submit(currentForm);
    fireEvent.submit(currentForm);
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await act(async () => pending.resolve(response));
    expect(saved).toHaveBeenCalledTimes(1);
  });
  it('retains the uncertain key if checking the order also fails', async () => {
    apiMock
      .mockRejectedValueOnce(new ApiError(0, 'Lost response'))
      .mockRejectedValueOnce(new ApiError(503, 'Journal unavailable'))
      .mockResolvedValueOnce(response);
    render(<AppointmentForm {...props} onSaved={vi.fn()} />);
    fireEvent.submit(form());
    await screen.findByRole('button', { name: 'Retry same visit' });
    const original = apiMock.mock.calls[0]![1]?.body;
    fireEvent.click(
      screen.getByRole('button', { name: 'Check visits before starting a new request' }),
    );
    await screen.findByText('Journal unavailable');
    expect(screen.getByRole('button', { name: 'Retry same visit' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry same visit' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));
    expect(apiMock.mock.calls[2]![1]?.body).toEqual(original);
  });
  it('propagates the freshly reread order before permitting an intentionally new create operation', async () => {
    const reloaded = vi.fn();
    apiMock
      .mockRejectedValueOnce(new ApiError(0, 'Unknown result'))
      .mockResolvedValueOnce({ order: plannedOrderFixture })
      .mockResolvedValueOnce(response);
    render(<AppointmentForm {...props} onSaved={vi.fn()} onOrderReloaded={reloaded} />);
    fireEvent.submit(form());
    await screen.findByRole('button', { name: 'Retry same visit' });
    const original = apiMock.mock.calls[0]![1]?.body as { idempotencyKey: string };
    fireEvent.click(
      screen.getByRole('button', { name: 'Check visits before starting a new request' }),
    );
    await waitFor(() => expect(reloaded).toHaveBeenCalledWith(plannedOrderFixture));
    await screen.findByRole('button', { name: 'Create visit' });
    fireEvent.submit(form());
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));
    const next = apiMock.mock.calls[2]![1]?.body as { idempotencyKey: string };
    expect(next.idempotencyKey).not.toBe(original.idempotencyKey);
  });

  it('keeps a rejected edit draft and its expectedVersion after a stale 409, without retrying automatically', async () => {
    const reload = vi.fn();
    apiMock.mockRejectedValue(
      new ApiError(409, 'Visit changed on the server.', 'STALE_APPOINTMENT_VERSION'),
    );
    render(
      <AppointmentForm
        {...props}
        appointment={appointmentFixture}
        onSaved={vi.fn()}
        onReload={reload}
      />,
    );
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: 'Unsaved dispatcher notes' },
    });
    fireEvent.change(screen.getByLabelText('Reason for change'), {
      target: { value: 'Fixture customer reschedule' },
    });
    fireEvent.change(screen.getByLabelText('Local start (Europe/Rome)'), {
      target: { value: '2030-01-08T10:00' },
    });
    fireEvent.submit(form());
    await screen.findByText('Visit changed on the server.');
    expect(screen.getByLabelText('Notes')).toHaveValue('Unsaved dispatcher notes');
    expect(screen.getByLabelText('Local start (Europe/Rome)')).toHaveValue('2030-01-08T10:00');
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls[0]![1]?.body).toEqual(
      expect.objectContaining({ expectedVersion: 1, notes: 'Unsaved dispatcher notes' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload visit before editing again' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('requires explicit rereading after an unknown edit result and preserves the draft until that choice', async () => {
    const reload = vi.fn();
    apiMock.mockRejectedValue(new ApiError(0, 'Disconnected'));
    render(
      <AppointmentForm
        {...props}
        appointment={appointmentFixture}
        onSaved={vi.fn()}
        onReload={reload}
      />,
    );
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Keep this draft' } });
    fireEvent.submit(form());
    await screen.findByText('Disconnected');
    expect(screen.getByRole('button', { name: 'Save visit' })).toBeDisabled();
    expect(screen.getByLabelText('Notes')).toHaveValue('Keep this draft');
    expect(
      screen.getByText(/no update is retried with a newer version automatically/),
    ).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reload visit before editing again' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('edits task severity and priority while retaining required IDs and logically removing an optional task', async () => {
    apiMock.mockResolvedValue(response);
    render(<AppointmentForm {...props} appointment={appointmentFixture} onSaved={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Remove Aurora: Check products' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Severity for Aurora: Check products'), {
      target: { value: 'MEDIUM' },
    });
    fireEvent.change(screen.getByLabelText('Priority for Aurora: Check products'), {
      target: { value: '35' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Aurora: Clear area' }));
    fireEvent.submit(form());
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    const body = apiMock.mock.calls[0]![1]?.body as {
      tasks: { assignmentId: string; tasks: unknown[] }[];
    };
    expect(body.tasks[0]).toEqual({
      assignmentId: appointmentFixture.assignments[0]!.id,
      tasks: [
        { id: appointmentFixture.assignments[0]!.tasks[0]!.id, severity: 'MEDIUM', priority: 35 },
      ],
    });
    expect(body.tasks[1]!.tasks).toHaveLength(2);
  });
});

describe('M4 appointment agreement and cancellation', () => {
  it('confirms exactly the displayed visit version', async () => {
    const saved = vi.fn(),
      confirmed = {
        ...appointmentFixture,
        version: 2,
        confirmationStatus: 'CONFIRMED' as const,
        confirmedBy: 'fixture',
        confirmedAt: '2030-01-01T00:00:00.000Z',
      };
    apiMock.mockResolvedValue({
      appointment: confirmed,
      order: { ...plannedOrderFixture, appointments: [confirmed] },
    });
    render(<AppointmentCard appointment={appointmentFixture} onSaved={saved} onReload={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm client agreement' }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(apiMock).toHaveBeenCalledWith(
      `/orders/${appointmentFixture.orderId}/appointments/${appointmentFixture.id}/confirm`,
      expect.objectContaining({ method: 'POST', body: { expectedVersion: 1 } }),
    );
  });
  it('prevents Edit from opening while an agreement request is still pending', async () => {
    const pending = deferred<AppointmentResponse>(),
      edit = vi.fn(),
      saved = vi.fn();
    apiMock.mockReturnValue(pending.promise);
    render(
      <AppointmentCard
        appointment={appointmentFixture}
        onEdit={edit}
        onSaved={saved}
        onReload={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm client agreement' }));
    expect(screen.getByRole('button', { name: 'Edit visit' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Edit visit' }));
    expect(edit).not.toHaveBeenCalled();
    await act(async () => pending.resolve(response));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Edit visit' })).toBeEnabled();
  });

  it('keeps Edit disabled after an uncertain agreement until the current record is explicitly reread', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    apiMock.mockRejectedValue(new ApiError(0, 'Unknown agreement result'));
    render(
      <AppointmentCard
        appointment={appointmentFixture}
        onEdit={vi.fn()}
        onSaved={vi.fn()}
        onReload={reload}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm client agreement' }));
    await screen.findByText('Unknown agreement result');
    expect(screen.getByRole('button', { name: 'Edit visit' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload current visit' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit visit' })).toBeEnabled());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('requires the explicit cancellation checkbox and sends its reason and captured version', async () => {
    const saved = vi.fn();
    apiMock.mockResolvedValue(response);
    render(<AppointmentCard appointment={appointmentFixture} onSaved={saved} onReload={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel visit' }));
    fireEvent.change(screen.getByLabelText('Reason for cancellation'), {
      target: { value: '  Customer requested cancellation  ' },
    });
    const cancelForm = screen
      .getByRole('button', { name: 'Confirm cancellation' })
      .closest('form')!;
    fireEvent.submit(cancelForm);
    expect(screen.getByRole('alert')).toHaveTextContent('Confirm cancellation');
    expect(apiMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm cancellation' }));
    fireEvent.submit(cancelForm);
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(apiMock).toHaveBeenCalledWith(
      `/orders/${appointmentFixture.orderId}/appointments/${appointmentFixture.id}/cancel`,
      expect.objectContaining({
        method: 'POST',
        body: { expectedVersion: 1, reason: 'Customer requested cancellation' },
      }),
    );
  });
  it('retains a stale cancellation reason and original version even if the visible record refreshes', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    apiMock.mockRejectedValue(
      new ApiError(409, 'A newer visit exists.', 'STALE_APPOINTMENT_VERSION'),
    );
    const view = render(
      <AppointmentCard appointment={appointmentFixture} onSaved={vi.fn()} onReload={reload} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel visit' }));
    fireEvent.change(screen.getByLabelText('Reason for cancellation'), {
      target: { value: 'Retain my cancellation reason' },
    });
    view.rerender(
      <AppointmentCard
        appointment={{ ...appointmentFixture, version: 2 }}
        onSaved={vi.fn()}
        onReload={reload}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirm cancellation' }));
    fireEvent.submit(screen.getByRole('button', { name: 'Confirm cancellation' }).closest('form')!);
    await screen.findByText('A newer visit exists.');
    expect(screen.getByLabelText('Reason for cancellation')).toHaveValue(
      'Retain my cancellation reason',
    );
    expect(apiMock.mock.calls[0]![1]?.body).toEqual({
      expectedVersion: 1,
      reason: 'Retain my cancellation reason',
    });
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Cancel visit' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload current visit' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
  it('retains cancelled assignments and tasks for display without offering new business mutations', () => {
    const cancelled = {
      ...appointmentFixture,
      status: 'CANCELLED' as const,
      cancelReason: 'Fixture cancellation',
      cancelledAt: '2030-01-01T00:00:00.000Z',
      cancelledBy: 'fixture',
      assignments: appointmentFixture.assignments.map((assignment) => ({
        ...assignment,
        status: 'CANCELLED' as const,
        cancelReason: 'Fixture cancellation',
      })),
    };
    render(
      <AppointmentCard
        appointment={cancelled}
        onEdit={vi.fn()}
        onSaved={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Cancel visit' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Confirm client agreement' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit visit' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Check products')).toHaveLength(2);
    expect(screen.getByText(/no longer reserves team time/)).toBeInTheDocument();
  });
});

describe('M4 create attempt lifetime in the order card', () => {
  it('keeps the new-visit editor open when a lost response leaves its operation key uncertain', async () => {
    apiMock
      .mockResolvedValueOnce({ crews: planningCrews })
      .mockResolvedValueOnce({ templates: planningTemplates })
      .mockRejectedValueOnce(new ApiError(0, 'Unknown visit result'));
    render(
      <OrderAppointments order={{ ...plannedOrderFixture, appointments: [] }} onSaved={vi.fn()} />,
    );
    const open = await screen.findByRole('button', { name: 'Plan a visit' });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    fireEvent.submit(form());
    await screen.findByRole('button', { name: 'Retry same visit' });
    expect(screen.getByRole('button', { name: 'Close new visit form' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close new visit form' }));
    expect(screen.getByRole('button', { name: 'Retry same visit' })).toBeInTheDocument();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });
});

describe('M7 planning after explicit closure', () => {
  it('disables new work and directs the dispatcher to explicit reopen without changing saved visits', async () => {
    apiMock.mockImplementation(async (path) =>
      path === '/crews' ? { crews: planningCrews } : { templates: planningTemplates },
    );
    render(
      <OrderAppointments
        order={{ ...plannedOrderFixture, progress: 'COMPLETED' }}
        onSaved={vi.fn()}
      />,
    );
    const plan = await screen.findByRole('button', { name: 'Plan a visit' });
    expect(plan).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Explicitly reopen the order' })).toHaveAttribute(
      'href',
      `/backoffice/orders/${plannedOrderFixture.id}#order-completion`,
    );
    expect(screen.getAllByRole('article', { name: `Visit ${appointmentFixture.id}` })).toHaveLength(
      1,
    );
    fireEvent.click(plan);
    expect(screen.queryByRole('heading', { name: 'New visit' })).not.toBeInTheDocument();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  });
  it('retains a newly drafted visit when closure is discovered but disables its submission until explicit reopening', async () => {
    apiMock.mockImplementation(async (path) =>
      path === '/crews' ? { crews: planningCrews } : { templates: planningTemplates },
    );
    const onSaved = vi.fn();
    const view = render(<OrderAppointments order={plannedOrderFixture} onSaved={onSaved} />);
    const plan = await screen.findByRole('button', { name: 'Plan a visit' });
    await waitFor(() => expect(plan).toBeEnabled());
    fireEvent.click(plan);
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: 'Retained additional visit draft' },
    });
    view.rerender(
      <OrderAppointments
        order={{ ...plannedOrderFixture, progress: 'COMPLETED' }}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByLabelText('Notes')).toHaveValue('Retained additional visit draft');
    expect(screen.getByRole('button', { name: 'Create visit' })).toBeDisabled();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  });
});
