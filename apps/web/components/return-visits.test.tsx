import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlotCandidate, SlotSearchQuery } from '@furniture-delivery/contracts';
import { apiRequest, ApiError } from '../lib/api-client';
import { planningCrews } from '../test/planning-fixture';
import { realtimeUser } from '../test/realtime-fixture';
import { chooseSelectOption } from '../test/select-option';
import {
  failedReturnAttemptFixture,
  plannedReturnDetailFixture,
  returnDetailFixture,
  returnSlotFixture,
} from '../test/return-fixture';
import { ReturnRequestQueue } from './return-request-queue';
import { CreateReturnRequestControl, ReturnRequestPanel } from './return-request-panel';
import { requiredReturnTargets, ReturnVisitPlanForm } from './return-visit-plan-form';

vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
vi.mock('./session-provider', () => ({ useCurrentUser: () => realtimeUser }));
vi.mock('./slot-finder', () => ({
  SlotFinder: ({
    query,
    onSelect,
    disabled,
  }: {
    query: SlotSearchQuery;
    onSelect: (value: SlotCandidate) => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() =>
        onSelect({
          ...returnSlotFixture,
          crewIds: [...query.crewIds],
          crews: planningCrews
            .filter((crew) => query.crewIds.includes(crew.id))
            .map((crew) => ({ ...crew, travelBufferMinutes: 30 })),
        })
      }
    >
      Choose fixture slot
    </button>
  ),
}));
const apiMock = vi.mocked(apiRequest);
beforeEach(() => {
  apiMock.mockReset();
  refresh.mockClear();
});
const refresh = vi.fn(async () => undefined);

function fillPlan() {
  fireEvent.click(screen.getByLabelText('Aurora', { exact: true }));
  fireEvent.change(screen.getByLabelText('Team for Assemble remaining cabinet'), {
    target: { value: planningCrews[0]!.id },
  });
  fireEvent.change(screen.getByLabelText('Reason for return plan'), {
    target: { value: 'Return with the replacement hinge' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Choose fixture slot' }));
  fireEvent.click(screen.getByLabelText('Confirm this return visit preview'));
}

describe('Return request queue', () => {
  it('shows loading, empty and API error states with retry', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(503, 'Return API unavailable'));
    apiMock.mockResolvedValue({ requests: [], total: 0, page: 1, pageSize: 20 });
    render(<ReturnRequestQueue />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(await screen.findByRole('alert')).toHaveTextContent('Return API unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { name: 'No matching return requests' });
  });
  it('filters PLANNED as an open need and paginates real server entries', async () => {
    apiMock.mockResolvedValue({
      requests: [
        {
          request: plannedReturnDetailFixture.request,
          orderNumber: 'FD-000001',
          customerName: 'Fixture customer',
          currentAppointmentId: plannedReturnDetailFixture.currentAppointment!.id,
          readyToResolve: false,
        },
      ],
      total: 21,
      page: 1,
      pageSize: 20,
    });
    render(<ReturnRequestQueue />);
    await screen.findByRole('link', { name: 'FD-000001 · Fixture customer' });
    expect(screen.getByText(/Need remains open/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filter return requests' }));
    await chooseSelectOption('Request status', 'Planned · need still open');
    fireEvent.click(screen.getByRole('button', { name: 'Apply request filters' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenLastCalledWith(
        '/backoffice/return-requests?page=1&pageSize=20&status=PLANNED',
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next requests' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next requests' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenLastCalledWith(
        '/backoffice/return-requests?page=2&pageSize=20&status=PLANNED',
        expect.anything(),
      ),
    );
  });
});

describe('Return visit explicit scope and preview', () => {
  it('does not reintroduce old DONE work and selecting a result does not save', async () => {
    const saved = vi.fn();
    apiMock.mockResolvedValue({ request: plannedReturnDetailFixture });
    render(
      <ReturnVisitPlanForm
        detail={returnDetailFixture}
        crews={planningCrews}
        onSaved={saved}
        onRefresh={refresh}
      />,
    );
    expect(screen.queryByText('Old completed inspection')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Assemble remaining cabinet · Required')).toBeDisabled();
    fillPlan();
    expect(screen.getByLabelText('Return visit preview')).toHaveTextContent(
      'Client confirmation will be required',
    );
    expect(apiMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and plan return visit' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    const call = apiMock.mock.calls[0]!;
    expect(call[0]).toBe(`/backoffice/return-requests/${returnDetailFixture.request.id}/plan`);
    expect(call[1]?.body).toMatchObject({
      expectedVersion: 2,
      localStart: returnSlotFixture.localStart,
      crewIds: [planningCrews[0]!.id],
      carriedTasks: [
        {
          sourceTaskId: returnDetailFixture.scopeCandidates[0]!.sourceTaskId,
          crewId: planningCrews[0]!.id,
        },
      ],
      newTasks: [],
      itemTargets: [],
    });
  });
  it('assigns one carried task once for two teams and carries failed absolute targets', async () => {
    const detail = { ...returnDetailFixture, attempts: [failedReturnAttemptFixture] };
    const saved = vi.fn();
    apiMock.mockResolvedValue({ request: plannedReturnDetailFixture });
    render(
      <ReturnVisitPlanForm
        detail={detail}
        crews={planningCrews}
        onSaved={saved}
        onRefresh={refresh}
      />,
    );
    const item = detail.items[0]!;
    expect(
      screen.getByLabelText(`Target: ${item.description} · Required from failed attempt`),
    ).toBeChecked();
    expect(
      screen.getByLabelText(`Target: ${item.description} · Required from failed attempt`),
    ).toBeDisabled();
    expect(screen.getByLabelText(`Delivery target for ${item.description}`)).toHaveValue(2);
    expect(screen.getByLabelText(`Assembly target for ${item.description}`)).toHaveValue(2);
    fillPlan();
    fireEvent.click(screen.getByLabelText('Birch', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose fixture slot' }));
    fireEvent.click(screen.getByLabelText('Confirm this return visit preview'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and plan return visit' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(apiMock.mock.calls[0]![1]?.body).toMatchObject({
      crewIds: planningCrews.slice(0, 2).map((crew) => crew.id),
      carriedTasks: [
        { sourceTaskId: detail.scopeCandidates[0]!.sourceTaskId, crewId: planningCrews[0]!.id },
      ],
      itemTargets: [{ itemId: item.id, deliveredQuantity: 2, assembledQuantity: 2 }],
    });
  });
  it('preserves draft and expected revision on 409 and background refresh', async () => {
    apiMock.mockRejectedValue(new ApiError(409, 'The request changed'));
    const props = { crews: planningCrews, onSaved: vi.fn(), onRefresh: refresh };
    const view = render(<ReturnVisitPlanForm detail={returnDetailFixture} {...props} />);
    fillPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and plan return visit' }));
    await screen.findByRole('alert');
    view.rerender(
      <ReturnVisitPlanForm
        detail={{ ...returnDetailFixture, request: { ...returnDetailFixture.request, version: 4 } }}
        {...props}
      />,
    );
    expect(screen.getByLabelText('Reason for return plan')).toHaveValue(
      'Return with the replacement hinge',
    );
    expect(screen.getByText(/Draft request revision 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm and plan return visit' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh current request' }));
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText(/Draft request revision 2/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Use latest request revision and review draft' }),
    );
    expect(screen.getByText(/Draft request revision 4/)).toBeInTheDocument();
    expect(screen.getByLabelText('Reason for return plan')).toHaveValue(
      'Return with the replacement hinge',
    );
  });
  it('retries an unknown plan using the original payload and operation key', async () => {
    apiMock
      .mockRejectedValueOnce(new ApiError(0, 'Connection lost'))
      .mockResolvedValueOnce({ request: plannedReturnDetailFixture });
    const saved = vi.fn();
    render(
      <ReturnVisitPlanForm
        detail={returnDetailFixture}
        crews={planningCrews}
        onSaved={saved}
        onRefresh={refresh}
      />,
    );
    fillPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and plan return visit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry same return plan' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(apiMock.mock.calls[1]![1]?.body).toEqual(apiMock.mock.calls[0]![1]?.body);
  });
  it('requires a reason when adding explicit new work', () => {
    render(
      <ReturnVisitPlanForm
        detail={returnDetailFixture}
        crews={planningCrews}
        onSaved={vi.fn()}
        onRefresh={refresh}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add explicit new task' }));
    expect(screen.getByLabelText('Reason for new task 1')).toBeRequired();
    expect(screen.getByLabelText('New task 1 name')).toBeRequired();
    expect(screen.getByLabelText('Team for new task 1')).toBeRequired();
  });
});

describe('Return review and history', () => {
  it('keeps an unknown create request when a canonical refresh reports that request already exists', async () => {
    apiMock
      .mockRejectedValueOnce(new ApiError(0, 'Create response lost'))
      .mockResolvedValueOnce({ request: returnDetailFixture });
    const props = {
      assignmentId: returnDetailFixture.request.assignmentId,
      executionVersion: 5,
      onRefresh: refresh,
    };
    const view = render(<CreateReturnRequestControl {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request a return visit for this team' }));
    fireEvent.change(screen.getByLabelText('Reason for another visit'), {
      target: { value: 'Keep original return reason' },
    });
    fireEvent.change(screen.getByLabelText('Remaining work'), {
      target: { value: 'Keep original scope' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save return request' }));
    await screen.findByRole('button', { name: 'Retry same return request' });
    const original = apiMock.mock.calls[0]![1]?.body;
    view.rerender(
      <CreateReturnRequestControl {...props} existingRequestId={returnDetailFixture.request.id} />,
    );
    expect(screen.getByLabelText('Reason for another visit')).toHaveValue(
      'Keep original return reason',
    );
    expect(screen.getByRole('button', { name: 'Save return request' })).toBeDisabled();
    expect(apiMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry same return request' }));
    await screen.findByRole('link', { name: 'Review and plan the remaining work' });
    expect(apiMock.mock.calls[1]![1]?.body).toEqual(original);
  });
  it('retains an unknown resolve key and reason after a live read observes RESOLVED', async () => {
    const resolved = {
      ...plannedReturnDetailFixture,
      request: {
        ...plannedReturnDetailFixture.request,
        status: 'RESOLVED' as const,
        version: 4,
        resolvedAt: '2030-01-09T12:00:00.000Z',
        resolvedBy: 'fixture-dispatcher',
        resolution: 'Reviewed the remaining work',
      },
      readyToResolve: false,
    };
    apiMock
      .mockRejectedValueOnce(new ApiError(0, 'Resolve response lost'))
      .mockResolvedValueOnce({ request: resolved });
    const props = { crews: planningCrews, onSaved: vi.fn(), onRefresh: refresh };
    const view = render(
      <ReturnRequestPanel
        detail={{ ...plannedReturnDetailFixture, readyToResolve: true, resolveBlockedReasons: [] }}
        {...props}
      />,
    );
    fireEvent.change(screen.getByLabelText('Resolution explanation'), {
      target: { value: 'Reviewed the remaining work' },
    });
    fireEvent.click(
      screen.getByLabelText('I reviewed the completed follow-up and remaining scope'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resolve return need' }));
    await screen.findByRole('button', { name: 'Retry same resolution' });
    const original = apiMock.mock.calls[0]![1]?.body;
    view.rerender(<ReturnRequestPanel detail={resolved} {...props} />);
    expect(screen.getByLabelText('Resolution explanation')).toHaveValue(
      'Reviewed the remaining work',
    );
    expect(screen.getByRole('button', { name: 'Retry same resolution' })).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry same resolution' }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));
    expect(apiMock.mock.calls[1]![1]?.body).toEqual(original);
  });
  it('keeps an open planning draft visible if another dispatcher plans during refresh', () => {
    const props = { crews: planningCrews, onSaved: vi.fn(), onRefresh: refresh };
    const view = render(<ReturnRequestPanel detail={returnDetailFixture} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Plan remaining work' }));
    fillPlan();
    view.rerender(<ReturnRequestPanel detail={plannedReturnDetailFixture} {...props} />);
    expect(screen.getByLabelText('Reason for return plan')).toHaveValue(
      'Return with the replacement hinge',
    );
    expect(screen.getByText(/Draft request revision 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm and plan return visit' })).toBeDisabled();
  });
  it('keeps original report, failed attempt and open need visible independently of issues', () => {
    render(
      <ReturnRequestPanel
        detail={{ ...returnDetailFixture, attempts: [failedReturnAttemptFixture] }}
        crews={planningCrews}
        onSaved={vi.fn()}
        onRefresh={refresh}
      />,
    );
    expect(screen.getByText('Delivered one cabinet; hinge missing')).toBeInTheDocument();
    expect(screen.getByText(/Replacement hinge still unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Issues have a separate lifecycle/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan remaining work' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Resolve return need' })).not.toBeInTheDocument();
  });
  it('blocks premature resolve and explicitly resolves only with review explanation', async () => {
    const saved = vi.fn();
    const props = { crews: planningCrews, onSaved: saved, onRefresh: refresh };
    const view = render(<ReturnRequestPanel detail={plannedReturnDetailFixture} {...props} />);
    expect(screen.getByRole('button', { name: 'Resolve return need' })).toBeDisabled();
    expect(
      screen.getByText('Every team must complete the follow-up before resolving it.'),
    ).toBeInTheDocument();
    apiMock.mockResolvedValue({
      request: {
        ...plannedReturnDetailFixture,
        request: { ...plannedReturnDetailFixture.request, status: 'RESOLVED', version: 4 },
      },
    });
    view.rerender(
      <ReturnRequestPanel
        detail={{ ...plannedReturnDetailFixture, readyToResolve: true, resolveBlockedReasons: [] }}
        {...props}
      />,
    );
    fireEvent.change(screen.getByLabelText('Resolution explanation'), {
      target: { value: 'Checked the remaining task and order totals' },
    });
    fireEvent.click(
      screen.getByLabelText('I reviewed the completed follow-up and remaining scope'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resolve return need' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(apiMock.mock.calls[0]![0]).toBe(
      `/backoffice/return-requests/${returnDetailFixture.request.id}/resolve`,
    );
    expect(apiMock.mock.calls[0]![1]?.body).toMatchObject({
      expectedVersion: 3,
      reason: 'Checked the remaining task and order totals',
    });
  });
  it('creates an explicit request from a finished team without changing its report', async () => {
    apiMock.mockResolvedValue({ request: returnDetailFixture });
    render(
      <CreateReturnRequestControl
        assignmentId={returnDetailFixture.request.assignmentId}
        executionVersion={5}
        onRefresh={refresh}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Request a return visit for this team' }));
    fireEvent.change(screen.getByLabelText('Reason for another visit'), {
      target: { value: 'Missing hinge' },
    });
    fireEvent.change(screen.getByLabelText('Remaining work'), {
      target: { value: 'Fit the hinge' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save return request' }));
    await screen.findByRole('link', { name: 'Review and plan the remaining work' });
    expect(apiMock.mock.calls[0]![1]?.body).toMatchObject({
      expectedExecutionVersion: 5,
      reason: 'Missing hinge',
      remainingWork: 'Fit the hinge',
    });
  });
});

describe('Failed target scope', () => {
  it('keeps maximum pending targets across failed attempts and omits already fulfilled targets', () => {
    const itemId = returnDetailFixture.items[0]!.id;
    expect(
      requiredReturnTargets({
        ...returnDetailFixture,
        attempts: [
          failedReturnAttemptFixture,
          {
            ...failedReturnAttemptFixture,
            id: 'second',
            scope: {
              tasks: [],
              itemTargets: [{ itemId, deliveredQuantity: 2, assembledQuantity: 1 }],
            },
          },
        ],
      }).get(itemId),
    ).toEqual({ itemId, deliveredQuantity: 2, assembledQuantity: 2 });
    expect(
      requiredReturnTargets({
        ...returnDetailFixture,
        items: [{ ...returnDetailFixture.items[0]!, deliveredQuantity: 2, assembledQuantity: 2 }],
        attempts: [failedReturnAttemptFixture],
      }).size,
    ).toBe(0);
  });
});
