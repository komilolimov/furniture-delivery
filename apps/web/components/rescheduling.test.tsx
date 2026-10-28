import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ApplyRescheduleResponse,
  EstimateResponse,
  RiskBoardResponse,
  SlotCandidate,
  SlotSearchQuery,
  SlotSearchResponse,
} from '@furniture-delivery/contracts';
import { apiRequest, ApiError } from '../lib/api-client';
import {
  appointmentFixture,
  planningCrews,
  planningTemplates,
  plannedOrderFixture,
} from '../test/planning-fixture';
import { AssignmentEstimate } from './assignment-estimate';
import { SlotFinder } from './slot-finder';
import { ReschedulePanel } from './reschedule-panel';
import { RiskPanel } from './risk-panel';
import { AppointmentForm } from './appointment-form';
vi.mock('../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const mock = vi.mocked(apiRequest),
  instant = '2030-01-07T08:00:00.000Z';
const candidate: SlotCandidate = {
  localStart: '2030-01-07T14:30',
  plannedStartAt: '2030-01-07T13:30:00.000Z',
  plannedEndAt: '2030-01-07T14:30:00.000Z',
  durationMinutes: 60,
  crewIds: [planningCrews[0]!.id],
  crews: [{ ...planningCrews[0]!, travelBufferMinutes: 30 }],
  basis: 'ESTIMATE',
  notes: ['Team forecast; no guarantee.'],
};
const slots: SlotSearchResponse = {
  dataAsOf: instant,
  timeZone: 'Europe/Rome',
  from: '2030-01-07',
  to: '2030-01-21',
  earliestAt: instant,
  candidates: [candidate],
  limited: false,
  blockedCrews: [],
  message: null,
};
const query: SlotSearchQuery = {
  context: 'APPOINTMENT',
  orderId: appointmentFixture.orderId,
  appointmentId: appointmentFixture.id,
  earliestLocal: '2030-01-07T09:00',
  durationMinutes: 60,
  crewIds: [planningCrews[0]!.id],
  alternativeCrews: false,
};
const receipt = { id: 'receipt', action: 'ESTIMATE_SET', resultId: null, createdAt: instant };
const estimateResult: EstimateResponse = {
  assignmentId: appointmentFixture.assignments[0]!.id,
  estimatedFinishAt: '2030-01-07T13:00:00.000Z',
  estimateUpdatedAt: instant,
  estimateUpdatedBy: 'actor',
  estimateReason: 'Later fixture work',
  estimateVersion: 2,
  receipt,
};
const applyResult: ApplyRescheduleResponse = {
  appointment: {
    ...appointmentFixture,
    version: 2,
    plannedStartAt: candidate.plannedStartAt,
    plannedEndAt: candidate.plannedEndAt,
  },
  order: plannedOrderFixture,
  receipt: { ...receipt, action: 'APPOINTMENT_RESCHEDULED', resultId: appointmentFixture.id },
};
const active = { ...appointmentFixture.assignments[0]!.execution, status: 'IN_PROGRESS' as const };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
beforeEach(() => {
  mock.mockReset();
});
async function choosePreview() {
  fireEvent.click(screen.getByRole('button', { name: 'Find available time' }));
  fireEvent.click(screen.getByRole('button', { name: 'Find windows' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Preview this window' }));
}
function fillPreview() {
  fireEvent.change(screen.getByLabelText('Reschedule reason'), {
    target: { value: 'Customer agreed to a later fictional window' },
  });
  fireEvent.click(
    screen.getByLabelText('I reviewed the new window, teams and client confirmation requirement'),
  );
}

describe('M6 available windows and explicit reschedule preview', () => {
  it('retries a failed slot search inside a return-plan form without submitting its parent', async () => {
    mock
      .mockRejectedValueOnce(new ApiError(503, 'Search temporarily unavailable'))
      .mockResolvedValue({ ...slots, candidates: [] });
    const submitted = vi.fn();
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitted();
        }}
      >
        <SlotFinder query={query} onSelect={vi.fn()} />
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Find windows' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/ }));
    await screen.findByText('No available windows in this range.');
    expect(submitted).not.toHaveBeenCalled();
    expect(
      mock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
    ).toBe(true);
  });

  it('searches only on request, shows loading, and selecting a candidate never sends a mutation', async () => {
    const pending = deferred<SlotSearchResponse>(),
      selected = vi.fn();
    mock.mockReturnValue(pending.promise);
    render(<SlotFinder query={query} onSelect={selected} />);
    expect(mock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Find windows' }));
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    await act(async () => pending.resolve(slots));
    fireEvent.click(await screen.findByRole('button', { name: 'Preview this window' }));
    expect(selected).toHaveBeenCalledWith(candidate);
    expect(
      mock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Earliest local start'), {
      target: { value: '2030-01-08T09:00' },
    });
    expect(screen.getByText(/Search settings changed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview this window' })).toBeDisabled();
  });
  it('distinguishes an explained unknown release, empty range and an API error with Retry', async () => {
    mock.mockRejectedValueOnce(new ApiError(503, 'Window search unavailable')).mockResolvedValue({
      ...slots,
      candidates: [],
      blockedCrews: [
        { crewId: 'crew', crewName: 'Aurora', message: 'Release unknown. Update the estimate.' },
      ],
      message: 'No matching windows.',
    });
    render(<SlotFinder query={query} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find windows' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Window search unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No available windows in this range.')).toBeInTheDocument();
    expect(screen.getByText(/Release unknown/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview this window' })).not.toBeInTheDocument();
  });
  it('retains fixed draft version and reason on a conflict while a refreshed live visit has a newer revision', async () => {
    const saved = vi.fn(),
      reload = vi.fn();
    mock.mockImplementation(<T,>(path: string, options?: Parameters<typeof apiRequest>[1]) =>
      options?.method === 'POST'
        ? Promise.reject(new ApiError(409, 'Slot was taken'))
        : Promise.resolve(slots as T),
    );
    const view = render(
      <ReschedulePanel
        appointment={appointmentFixture}
        crews={planningCrews}
        onSaved={saved}
        onReload={reload}
      />,
    );
    await choosePreview();
    expect(mock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
    fillPreview();
    fireEvent.submit(screen.getByRole('form', { name: 'Reschedule preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Slot was taken');
    view.rerender(
      <ReschedulePanel
        appointment={{ ...appointmentFixture, version: 9 }}
        crews={planningCrews}
        onSaved={saved}
        onReload={reload}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Read current visit' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Reschedule reason')).toHaveValue(
      'Customer agreed to a later fictional window',
    );
    fireEvent.submit(screen.getByRole('form', { name: 'Reschedule preview' }));
    await waitFor(() =>
      expect(mock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2),
    );
    for (const [, options] of mock.mock.calls.filter(([, options]) => options?.method === 'POST'))
      expect(options?.body).toMatchObject({ expectedVersion: 1, localStart: candidate.localStart });
    expect(saved).not.toHaveBeenCalled();
  });
  it('retries an unknown reschedule using the identical key and payload, and requires explicit review', async () => {
    const saved = vi.fn();
    let mutations = 0;
    mock.mockImplementation(<T,>(_path: string, options?: Parameters<typeof apiRequest>[1]) => {
      if (options?.method === 'POST')
        return ++mutations === 1
          ? Promise.reject(new ApiError(0, 'Outcome unknown'))
          : Promise.resolve(applyResult as T);
      return Promise.resolve(slots as T);
    });
    render(
      <ReschedulePanel
        appointment={appointmentFixture}
        crews={planningCrews}
        onSaved={saved}
        onReload={vi.fn()}
      />,
    );
    await choosePreview();
    expect(screen.getByRole('button', { name: 'Confirm reschedule' })).toBeDisabled();
    fillPreview();
    fireEvent.submit(screen.getByRole('form', { name: 'Reschedule preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry original reschedule' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(applyResult));
    const calls = mock.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(calls).toHaveLength(2);
    expect(calls[1]![1]!.body).toEqual(calls[0]![1]!.body);
  });
  it('locks a previously opened preview when the visit departs without erasing the draft', async () => {
    mock.mockResolvedValue(slots);
    const view = render(
      <ReschedulePanel
        appointment={appointmentFixture}
        crews={planningCrews}
        onSaved={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    await choosePreview();
    fillPreview();
    const changed = {
      ...appointmentFixture,
      assignments: appointmentFixture.assignments.map((a) => ({
        ...a,
        execution: { ...a.execution, departedAt: instant, status: 'ON_THE_WAY' as const },
      })),
    };
    view.rerender(
      <ReschedulePanel
        appointment={changed}
        crews={planningCrews}
        onSaved={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Confirm reschedule' })).toBeDisabled();
    expect(screen.getByLabelText('Reschedule reason')).toHaveValue(
      'Customer agreed to a later fictional window',
    );
  });
});

describe('M6 team estimates and risk projection UI', () => {
  it('clears an estimate explicitly with a reason and its own version without changing execution facts', async () => {
    const saved = vi.fn();
    mock.mockResolvedValue({ ...estimateResult, estimatedFinishAt: null });
    render(
      <AssignmentEstimate
        assignmentId="assignment"
        execution={active}
        mode="crew"
        onSaved={saved}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Update finish estimate' }));
    fireEvent.click(screen.getByLabelText('Explicitly clear the estimate'));
    fireEvent.change(screen.getByLabelText('Reason for estimate change'), {
      target: { value: 'Team cannot currently estimate remaining work' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear estimate with reason' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(mock).toHaveBeenCalledWith(
      '/crew/assignments/assignment/estimate',
      expect.objectContaining({
        body: expect.objectContaining({
          expectedEstimateVersion: 1,
          localFinish: null,
          reason: 'Team cannot currently estimate remaining work',
        }),
      }),
    );
  });
  it('keeps estimate input and revision after refresh and conflicts rather than automatically using the new revision', async () => {
    mock.mockRejectedValue(new ApiError(409, 'Estimate changed'));
    const reload = vi.fn();
    const view = render(
      <AssignmentEstimate
        assignmentId="assignment"
        execution={active}
        mode="backoffice"
        onSaved={reload}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Update finish estimate' }));
    fireEvent.change(screen.getByLabelText('Estimated local finish'), {
      target: { value: '2030-01-07T14:00' },
    });
    fireEvent.change(screen.getByLabelText('Reason for estimate change'), {
      target: { value: 'Later fictional assembly' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save estimate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Estimate changed');
    view.rerender(
      <AssignmentEstimate
        assignmentId="assignment"
        execution={{ ...active, estimateVersion: 8 }}
        mode="backoffice"
        onSaved={reload}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Read current estimate' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Reason for estimate change')).toHaveValue(
      'Later fictional assembly',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save estimate' }));
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
    expect(mock.mock.calls[1]![1]!.body).toMatchObject({ expectedEstimateVersion: 1 });
  });
  it('retains the last estimate for terminal work without offering a new edit', () => {
    render(
      <AssignmentEstimate
        assignmentId="assignment"
        execution={{
          ...active,
          status: 'COMPLETED',
          actualEndAt: instant,
          estimatedFinishAt: instant,
        }}
        mode="crew"
        onSaved={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'Update finish estimate' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Estimated finish:/)).toHaveTextContent('Actual finish:');
  });
  it('retries an unknown estimate with the original payload and locks its fields until a receipt is read', async () => {
    mock
      .mockRejectedValueOnce(new ApiError(0, 'Unknown save result'))
      .mockResolvedValue(estimateResult);
    const saved = vi.fn();
    render(
      <AssignmentEstimate
        assignmentId="assignment"
        execution={active}
        mode="crew"
        onSaved={saved}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Update finish estimate' }));
    fireEvent.change(screen.getByLabelText('Estimated local finish'), {
      target: { value: '2030-01-07T14:00' },
    });
    fireEvent.change(screen.getByLabelText('Reason for estimate change'), {
      target: { value: 'Assembly is taking longer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save estimate' }));
    const retry = await screen.findByRole('button', { name: 'Retry original estimate request' });
    expect(screen.getByLabelText('Estimated local finish')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard estimate draft' })).toBeDisabled();
    fireEvent.click(retry);
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(mock.mock.calls).toHaveLength(2);
    expect(mock.mock.calls[1]![1]!.body).toEqual(mock.mock.calls[0]![1]!.body);
  });
  it('renders one risk visit with each affected team and distinct plan, forecast and release evidence', async () => {
    const board: RiskBoardResponse = {
      dataAsOf: instant,
      timeZone: 'Europe/Rome',
      from: instant,
      to: '2030-01-08T08:00:00.000Z',
      risks: [
        {
          appointmentId: appointmentFixture.id,
          orderId: appointmentFixture.orderId,
          orderNumber: 'RISK-1',
          plannedStartAt: candidate.plannedStartAt,
          plannedEndAt: candidate.plannedEndAt,
          reasons: planningCrews.slice(0, 2).map((crew) => ({
            code: 'NEXT_VISIT_AT_RISK',
            crewId: crew.id,
            crewName: crew.name,
            sourceAssignmentId: 'source-' + crew.id,
            sourceAppointmentId: 'source-visit',
            sourcePlannedStartAt: instant,
            sourcePlannedEndAt: '2030-01-07T11:00:00.000Z',
            sourceEstimatedFinishAt: '2030-01-07T13:00:00.000Z',
            sourceActualEndAt: null,
            travelBufferMinutes: 30,
            expectedReleaseAt: candidate.plannedStartAt,
            basis: 'ESTIMATE',
            message: 'A later team forecast affects this visit.',
          })),
        },
      ],
    };
    mock.mockResolvedValue(board);
    render(
      <RiskPanel query={{ from: '2030-01-07', to: '2030-01-08', allTeams: true, crewIds: [] }} />,
    );
    expect(await screen.findByText('Aurora: Next visit at risk')).toBeInTheDocument();
    expect(screen.getByText('Birch: Next visit at risk')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /RISK-1/ })).toHaveLength(1);
    expect(screen.getAllByText(/buffer 30 min · release .*basis estimate/)).toHaveLength(2);
  });
  it('shows server risk reasons and calculation time, refreshes, and distinguishes an empty board from failure', async () => {
    const board: RiskBoardResponse = {
      dataAsOf: instant,
      timeZone: 'Europe/Rome',
      from: instant,
      to: '2030-01-08T08:00:00.000Z',
      risks: [],
    };
    mock
      .mockRejectedValueOnce(new ApiError(503, 'Risk board unavailable'))
      .mockResolvedValue(board);
    render(
      <RiskPanel query={{ from: '2030-01-07', to: '2030-01-08', allTeams: true, crewIds: [] }} />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Risk board unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No schedule risks in this range.')).toBeInTheDocument();
    expect(screen.getByText(/Calculated .*Europe\/Rome/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh risks' }));
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(3));
  });
  it('preserves item-only follow-up scope in the normal editor and omits arbitrary task edits', async () => {
    const followup = {
      ...appointmentFixture,
      returnRequestId: 'request',
      assignments: appointmentFixture.assignments.map((a) => ({ ...a, tasks: [] })),
    };
    mock.mockResolvedValue({ appointment: followup, order: plannedOrderFixture });
    render(
      <AppointmentForm
        order={plannedOrderFixture}
        appointment={followup}
        crews={planningCrews}
        templates={planningTemplates}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText(/Follow-up task scope is fixed/)).toBeInTheDocument();
    expect(screen.queryByText(/Tasks for Aurora/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save visit' }));
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(mock.mock.calls[0]![1]!.body).not.toHaveProperty('tasks');
  });
});
