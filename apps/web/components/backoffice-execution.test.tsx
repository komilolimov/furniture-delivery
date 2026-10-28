import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AppointmentDetail,
  OrderDetail,
  OrderExecutionSummary,
} from '@furniture-delivery/contracts';
import { apiRequest, ApiError } from '../lib/api-client';
import { orderFixture } from '../test/order-fixture';
import { appointmentFixture } from '../test/planning-fixture';
import { BackofficeExecutionPanel } from './backoffice-execution-panel';
vi.mock('../lib/api-client', async (original) => ({
  ...(await original<typeof import('../lib/api-client')>()),
  apiRequest: vi.fn(),
}));
const apiMock = vi.mocked(apiRequest);
const state: OrderExecutionSummary = {
  workReadyForReview: false,
  openIssueCount: 1,
  returnVisitRequired: true,
  activeAssignmentCount: 1,
  completedAssignmentCount: 1,
  partiallyCompletedAssignmentCount: 0,
  blockedAssignmentCount: 0,
  finishReports: [],
  returnRequests: [],
};
const actual = {
  version: 3,
  departedAt: '2030-01-07T07:00:00Z',
  arrivedAt: '2030-01-07T07:30:00Z',
  actualStartAt: '2030-01-07T08:00:00Z',
  actualEndAt: null,
  maybeDelayed: false,
};
const visit: AppointmentDetail = {
  ...appointmentFixture,
  execution: {
    orderProgress: 'IN_PROGRESS',
    workReadyForReview: false,
    openIssueCount: 1,
    returnVisitRequired: true,
    activeCount: 1,
    completedCount: 1,
    partiallyCompletedCount: 0,
    blockedCount: 0,
    notStartedCount: 0,
    requiredDoneCount: 1,
    requiredCount: 2,
    maybeDelayed: false,
  },
  assignments: appointmentFixture.assignments.map((assignment, index) => ({
    ...assignment,
    execution: {
      ...assignment.execution,
      ...actual,
      status: index === 0 ? 'COMPLETED' : 'IN_PROGRESS',
      actualEndAt: index === 0 ? '2030-01-07T09:00:00Z' : null,
    },
    tasks: assignment.tasks.map((task) => ({
      ...task,
      resultStatus: index === 0 ? 'DONE' : 'PENDING',
      resultVersion: 1,
      doneBy: index === 0 ? 'fixture-actor' : null,
      doneAt: index === 0 ? '2030-01-07T09:00:00Z' : null,
      resultReason: null,
    })),
  })),
};
const order: OrderDetail = {
  ...orderFixture,
  progress: 'IN_PROGRESS',
  workReadyForReview: false,
  openIssueCount: 1,
  returnVisitRequired: true,
  execution: state,
  appointments: [visit],
  items: orderFixture.items.map((item) => ({
    ...item,
    deliveredQuantity: 1,
    assembledQuantity: 0,
    fulfillmentVersion: 2,
  })),
};
beforeEach(() => apiMock.mockReset());
describe('Backoffice physical execution readout', () => {
  it('shows shared totals, independent teams and frozen results without declaring the order complete', async () => {
    apiMock.mockResolvedValue({
      execution: {
        ...state,
        finishReports: [
          {
            id: 'report-1',
            orderId: order.id,
            appointmentId: visit.id,
            assignmentId: visit.assignments[0]!.id,
            outcome: 'COMPLETED',
            summary: 'Our team checked the furniture',
            reason: null,
            remainingWork: null,
            quantityScope: 'ACCUMULATED_ORDER',
            taskResults: [],
            quantities: [
              {
                ...order.items[0],
                deliveredQuantity: 0,
                assembledQuantity: 0,
                remainingDeliveryQuantity: 1,
                remainingAssemblyQuantity: 0,
              },
            ],
            knownIssueIds: [],
            attachmentIds: [],
            authorId: 'fixture-actor',
            actualEndAt: '2030-01-07T09:00:00Z',
            createdAt: '2030-01-07T09:00:00Z',
          },
        ],
      },
      appointments: [visit],
    });
    render(<BackofficeExecutionPanel order={order} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await screen.findByText('Delivered 1/1 · remaining 0.');
    expect(apiMock).toHaveBeenCalledWith(`/orders/${order.id}/execution`, expect.anything());
    expect(screen.getByText('1 open issues', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Return visit required', { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Fixture chair: delivered 0\/1/)).toBeInTheDocument();
    expect(screen.getByText(/Aurora · Team's visit completed/)).toBeInTheDocument();
    expect(screen.getByText(/Birch · Work in progress/)).toBeInTheDocument();
    expect(screen.queryByText(/Ready for review · final/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /complete order/i })).not.toBeInTheDocument();
  });
  it('keeps saved data mounted during refresh and clears it when access is lost', async () => {
    apiMock.mockResolvedValue({ execution: state, appointments: [visit] });
    render(<BackofficeExecutionPanel order={order} />);
    await screen.findByRole('heading', { name: 'Frozen finish reports' });
    let rejectRefresh: (error: unknown) => void = () => undefined;
    apiMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRefresh = reject;
        }),
    );
    fireEvent.focus(window);
    expect(screen.getByRole('heading', { name: 'Frozen finish reports' })).toBeInTheDocument();
    rejectRefresh(new ApiError(503, 'API unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent('API unavailable');
    expect(screen.getByRole('heading', { name: 'Frozen finish reports' })).toBeInTheDocument();
    apiMock.mockRejectedValueOnce(new ApiError(403, 'Access denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Frozen finish reports' }),
      ).not.toBeInTheDocument(),
    );
  });
  it('retries a failed initial read and reports real empty execution', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(503, 'Read failed')).mockResolvedValueOnce({
      execution: { ...state, openIssueCount: 0, returnVisitRequired: false },
      appointments: [],
    });
    render(<BackofficeExecutionPanel order={order} />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByText('No visits yet. Plan the first visit from this order.'),
    ).toBeInTheDocument();
  });
});
