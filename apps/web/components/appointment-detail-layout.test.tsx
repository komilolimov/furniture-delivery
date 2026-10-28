import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AppointmentResponse } from '@furniture-delivery/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from '../lib/api-client';
import {
  appointmentFixture,
  plannedOrderFixture,
  planningCrews,
  planningTemplates,
} from '../test/planning-fixture';
import { AppointmentDetailScreen } from './appointment-detail';
import AppointmentPage from '../app/backoffice/planning/orders/[orderId]/appointments/[id]/page';

const mocks = vi.hoisted(() => ({ workflowRender: vi.fn() }));
vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
vi.mock('./backoffice-execution-panel', () => ({
  AppointmentExecutionReadout: () => <p>Fixture execution summary</p>,
  BackofficeExecutionPanel: () => {
    mocks.workflowRender('execution');
    return (
      <label>
        Execution draft
        <input defaultValue="" />
      </label>
    );
  },
}));
vi.mock('./acceptance-panel', () => ({
  VisitAcceptancePanel: () => {
    mocks.workflowRender('acknowledgements');
    return (
      <div>
        <label>
          Signing name draft
          <input defaultValue="" />
        </label>
        <canvas aria-label="Fixture visit signature canvas" />
      </div>
    );
  },
}));
vi.mock('./reschedule-panel', () => ({
  ReschedulePanel: () => {
    mocks.workflowRender('reschedule');
    return (
      <label>
        Reschedule draft
        <input defaultValue="" />
      </label>
    );
  },
}));
vi.mock('./evidence-panel', () => ({
  EvidencePanel: () => {
    mocks.workflowRender('files');
    return (
      <label>
        Evidence draft
        <input defaultValue="" />
      </label>
    );
  },
}));

const apiMock = vi.mocked(apiRequest);
const response: AppointmentResponse = {
  order: plannedOrderFixture,
  appointment: appointmentFixture,
};
let current: AppointmentResponse;
function activateTab(name: string) {
  const trigger = screen.getByRole('tab', { name });
  fireEvent.mouseDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}
async function ready() {
  return screen.findByRole('heading', { level: 1, name: current.order.customerName });
}
beforeEach(() => {
  apiMock.mockReset();
  mocks.workflowRender.mockReset();
  current = response;
  apiMock.mockImplementation((path) =>
    Promise.resolve(
      (path === '/crews'
        ? { crews: planningCrews }
        : path === '/task-templates'
          ? { templates: planningTemplates }
          : current) as never,
    ),
  );
});

describe('Visit detail workspace', () => {
  it('separates the planned customer window, estimates and actual times without replacing their values', async () => {
    current = {
      ...response,
      appointment: {
        ...appointmentFixture,
        assignments: appointmentFixture.assignments.map((team, index) => ({
          ...team,
          execution:
            index === 0
              ? {
                  ...team.execution,
                  status: 'IN_PROGRESS',
                  departedAt: '2030-01-07T07:30:00.000Z',
                  actualStartAt: '2030-01-07T08:05:00.000Z',
                  estimatedFinishAt: '2030-01-07T10:00:00.000Z',
                }
              : team.execution,
        })),
      },
    };
    render(
      <AppointmentDetailScreen orderId={response.order.id} appointmentId={appointmentFixture.id} />,
    );
    await ready();
    const summary = screen.getByRole('region', { name: 'Visit summary' });
    expect(summary).toHaveTextContent('09:00');
    expect(summary).toHaveTextContent('10:00');
    expect(summary).toHaveTextContent('60 min');
    expect(summary).toHaveTextContent('Aurora · Birch');
    expect(summary).toHaveTextContent('Travel buffers are separate');
    expect(screen.getByRole('tablist', { name: 'Visit sections' })).toBeInTheDocument();
    for (const name of [
      'Overview',
      'Execution',
      'Acknowledgements',
      'Reschedule',
      'Files',
      'History',
    ])
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    activateTab('Execution');
    const times = screen.getByRole('region', { name: 'Team forecasts and actual times' });
    const aurora = within(times).getByRole('heading', { name: 'Aurora' }).closest('article')!;
    expect(within(aurora).getByText('Estimated finish').nextElementSibling).toHaveTextContent(
      '11:00',
    );
    expect(within(aurora).getByText('Actual start').nextElementSibling).toHaveTextContent('09:05');
    expect(within(aurora).getByText('Actual end').nextElementSibling).toHaveTextContent(
      'Not recorded',
    );
    activateTab('Overview');
    expect(screen.getByRole('button', { name: 'Cancel visit' })).toBeDisabled();
    expect(summary).toHaveTextContent('09:00');
    expect(summary).toHaveTextContent('10:00');
  });

  it('keeps drafts and canvas mounted, without rerendering unrelated workflow modules on tab navigation', async () => {
    render(
      <AppointmentDetailScreen orderId={response.order.id} appointmentId={appointmentFixture.id} />,
    );
    await ready();
    const before = mocks.workflowRender.mock.calls.length;
    activateTab('Acknowledgements');
    const name = screen.getByLabelText('Signing name draft');
    const canvas = screen.getByLabelText('Fixture visit signature canvas');
    fireEvent.change(name, { target: { value: 'Unsigned synthetic name' } });
    activateTab('Reschedule');
    const reschedule = screen.getByLabelText('Reschedule draft');
    fireEvent.change(reschedule, { target: { value: 'Unsent proposed change' } });
    activateTab('Files');
    const evidence = screen.getByLabelText('Evidence draft');
    fireEvent.change(evidence, { target: { value: 'Unsent file note' } });
    activateTab('Overview');
    expect(name).toBeInTheDocument();
    expect(canvas).toBeInTheDocument();
    expect(canvas).not.toBeVisible();
    activateTab('Acknowledgements');
    expect(screen.getByLabelText('Signing name draft')).toBe(name);
    expect(name).toHaveValue('Unsigned synthetic name');
    expect(screen.getByLabelText('Fixture visit signature canvas')).toBe(canvas);
    activateTab('Reschedule');
    expect(screen.getByLabelText('Reschedule draft')).toBe(reschedule);
    expect(reschedule).toHaveValue('Unsent proposed change');
    activateTab('Files');
    expect(screen.getByLabelText('Evidence draft')).toBe(evidence);
    expect(evidence).toHaveValue('Unsent file note');
    expect(mocks.workflowRender).toHaveBeenCalledTimes(before);
    expect(apiMock).toHaveBeenCalledTimes(3);
  });

  it('retains the real visit editor draft and its original expectedVersion after a background refresh', async () => {
    render(
      <AppointmentDetailScreen orderId={response.order.id} appointmentId={appointmentFixture.id} />,
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Edit visit' }));
    const notes = screen.getByLabelText('Notes');
    fireEvent.change(notes, { target: { value: 'Unsent visit edit' } });
    expect(screen.getByRole('button', { name: 'Refresh visit' })).toBeDisabled();
    activateTab('Files');
    current = {
      order: { ...response.order, version: 2, customerName: 'Updated server customer' },
      appointment: { ...appointmentFixture, version: 2, notes: 'Other dispatcher note' },
    };
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await ready();
    activateTab('Overview');
    expect(screen.getByLabelText('Notes')).toBe(notes);
    expect(notes).toHaveValue('Unsent visit edit');
    fireEvent.click(screen.getByRole('button', { name: 'Save visit' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/orders/${response.order.id}/appointments/${appointmentFixture.id}`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.objectContaining({ expectedVersion: 1, notes: 'Unsent visit edit' }),
        }),
      ),
    );
  });

  it('clears the record and every mounted workflow when the visit access is revoked', async () => {
    render(
      <AppointmentDetailScreen orderId={response.order.id} appointmentId={appointmentFixture.id} />,
    );
    await ready();
    activateTab('Acknowledgements');
    expect(screen.getByLabelText('Fixture visit signature canvas')).toBeInTheDocument();
    apiMock.mockRejectedValueOnce(new ApiError(403, 'Access revoked'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh visit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Fixture visit signature canvas')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsent proposed change')).not.toBeInTheDocument();
  });

  it('opens another visit on its own overview, without carrying over an earlier editor or signature draft', async () => {
    const { rerender } = render(
      await AppointmentPage({
        params: Promise.resolve({ orderId: response.order.id, id: appointmentFixture.id }),
      }),
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Edit visit' }));
    const notes = screen.getByLabelText('Notes');
    fireEvent.change(notes, { target: { value: 'First visit unsent notes' } });
    activateTab('Acknowledgements');
    const firstCanvas = screen.getByLabelText('Fixture visit signature canvas');
    const secondId = '40000000-0000-4000-8000-000000000002';
    current = {
      ...response,
      appointment: { ...appointmentFixture, id: secondId, notes: 'Other visit notes' },
    };
    rerender(
      await AppointmentPage({
        params: Promise.resolve({ orderId: response.order.id, id: secondId }),
      }),
    );
    await ready();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(notes).not.toBeInTheDocument();
    expect(firstCanvas).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('First visit unsent notes')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit visit' }));
    expect(screen.getByLabelText('Notes')).toHaveValue('Other visit notes');
    expect(apiMock).toHaveBeenCalledWith(
      `/orders/${response.order.id}/appointments/${secondId}`,
      expect.anything(),
    );
  });

  it('shows only this visit history and keeps original reasons and structured changes readable', async () => {
    current = {
      ...response,
      order: {
        ...response.order,
        activity: [
          {
            id: '80000000-0000-4000-8000-000000000001',
            orderId: response.order.id,
            targetId: appointmentFixture.id,
            actorId: '90000000-0000-4000-8000-000000000001',
            action: 'APPOINTMENT_UPDATED',
            reason: 'Synthetic customer requested later visit',
            changes: { plannedStartAt: { before: '09:00', after: '11:00' } },
            createdAt: '2030-01-07T08:00:00.000Z',
          },
          {
            id: '80000000-0000-4000-8000-000000000002',
            orderId: response.order.id,
            targetId: '40000000-0000-4000-8000-000000000002',
            actorId: '90000000-0000-4000-8000-000000000001',
            action: 'APPOINTMENT_UPDATED',
            reason: 'Different visit change',
            changes: {},
            createdAt: '2030-01-07T08:00:00.000Z',
          },
        ],
      },
    };
    render(
      <AppointmentDetailScreen orderId={response.order.id} appointmentId={appointmentFixture.id} />,
    );
    await ready();
    activateTab('History');
    const history = screen.getByRole('region', { name: 'Visit history' });
    expect(within(history).getByText('Appointment updated')).toBeInTheDocument();
    expect(
      within(history).getByText('Synthetic customer requested later visit'),
    ).toBeInTheDocument();
    expect(within(history).queryByText('Different visit change')).not.toBeInTheDocument();
    fireEvent.click(within(history).getByText('View recorded changes'));
    expect(within(history).getByText('Planned Start At')).toBeVisible();
    expect(within(history).getByText(/"before": "09:00"/)).toBeVisible();
  });
});
