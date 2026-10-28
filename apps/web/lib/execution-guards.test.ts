import { describe, expect, it } from 'vitest';
import type { CrewAssignmentDetail, FinishReportRecord } from '@furniture-delivery/contracts';
import { crewAssignmentFixture } from '../test/execution-fixture';
import { appointmentFixture } from '../test/planning-fixture';
import { orderFixture } from '../test/order-fixture';
import {
  isCrewAssignmentDetail,
  isCrewAssignmentListResponse,
  isCrewAssignmentResponse,
  isCrewAssignmentSummary,
  isCrewWorkItem,
  isCrewWorkTask,
  isFinishReport,
  isOrderExecutionResponse,
} from './execution-guards';
import { isOrderProgress } from './execution-record-guards';
const fixture = () => structuredClone(crewAssignmentFixture);
const list = (assignment = fixture()) => ({
  assignments: [assignment],
  total: 1,
  page: 1,
  pageSize: 20,
  businessDate: '2030-01-07',
  timeZone: 'Europe/Rome',
});
const report = (): FinishReportRecord => ({
  id: 'finish-fixture',
  orderId: crewAssignmentFixture.orderId,
  appointmentId: crewAssignmentFixture.appointmentId,
  assignmentId: crewAssignmentFixture.id,
  outcome: 'PARTIALLY_COMPLETED',
  summary: 'Some furniture delivered',
  reason: 'Missing fittings',
  remainingWork: 'Remaining assembly',
  quantityScope: 'ACCUMULATED_ORDER',
  taskResults: structuredClone(crewAssignmentFixture.tasks),
  quantities: structuredClone(crewAssignmentFixture.items),
  knownIssueIds: ['issue-fixture'],
  attachmentIds: ['attachment-fixture'],
  authorId: 'actor-fixture',
  actualEndAt: '2030-01-07T11:30:00.000Z',
  createdAt: '2030-01-07T11:30:00.000Z',
});
describe('M5 browser contracts accept explicit public work and reject sensitive or malformed data', () => {
  it('accepts separate crew detail/list and safe mutation receipt contracts', () => {
    const assignment = fixture();
    expect(isCrewAssignmentSummary(assignment)).toBe(true);
    expect(isCrewAssignmentDetail(assignment)).toBe(true);
    expect(isCrewAssignmentListResponse(list(assignment))).toBe(true);
    expect(
      isCrewAssignmentResponse({
        assignment,
        receipt: {
          id: 'receipt-fixture',
          action: 'DEPART',
          resultId: assignment.id,
          createdAt: '2030-01-07T08:00:00.000Z',
        },
      }),
    ).toBe(true);
    expect(
      isCrewAssignmentDetail({
        ...assignment,
        crewActive: false,
        departureBlockedReason: 'Team is inactive',
      }),
    ).toBe(true);
  });
  it.each([
    'orderTotalCents',
    'paidCents',
    'balanceCents',
    'paymentStatus',
    'payments',
    'internalNotes',
    'passwordHash',
    'token',
    'tokenHash',
    'storageKey',
    'sourceHash',
    'fingerprint',
    'operationKey',
  ])('rejects forbidden %s even when nested in an otherwise valid response', (key) => {
    const assignment = fixture();
    expect(isCrewAssignmentDetail({ ...assignment, [key]: 'unexpected' })).toBe(false);
    expect(
      isCrewAssignmentDetail({
        ...assignment,
        order: { ...assignment.order, [key]: 'unexpected' },
      }),
    ).toBe(false);
    expect(
      isCrewAssignmentResponse({
        assignment,
        receipt: { id: 'receipt', action: 'FINISH', [key]: 'unexpected' },
      }),
    ).toBe(false);
    expect(
      isCrewAssignmentListResponse({ ...list(assignment), extra: { [key]: 'unexpected' } }),
    ).toBe(false);
  });
  it('rejects invalid execution revisions, unknown statuses and local timestamps without UTC provenance', () => {
    const assignment = fixture();
    for (const execution of [
      { ...assignment.execution, version: 0 },
      { ...assignment.execution, version: 1.5 },
      { ...assignment.execution, status: 'CANCELLED' },
      { ...assignment.execution, departedAt: '2030-01-07T09:00' },
      { ...assignment.execution, actualEndAt: 'broken' },
    ])
      expect(isCrewAssignmentDetail({ ...assignment, execution })).toBe(false);
    expect(isCrewAssignmentListResponse({ ...list(), timeZone: 'Asia/Tokyo' })).toBe(false);
    expect(isCrewAssignmentListResponse({ ...list(), total: -1 })).toBe(false);
    expect(isCrewAssignmentListResponse({ ...list(), pageSize: 1.5 })).toBe(false);
  });
  it('checks independent task and absolute item versions with integer bounds', () => {
    const task = fixture().tasks[0]!,
      item = fixture().items[0]!;
    expect(isCrewWorkTask(task)).toBe(true);
    expect(isCrewWorkItem(item)).toBe(true);
    for (const patch of [
      { resultVersion: 0 },
      { resultStatus: 'COMPLETED' },
      { doneAt: 'not a timestamp' },
      { priority: -1 },
    ])
      expect(isCrewWorkTask({ ...task, ...patch })).toBe(false);
    for (const patch of [
      { fulfillmentVersion: 0 },
      { deliveredQuantity: -1 },
      { deliveredQuantity: 0.5 },
      { deliveredQuantity: item.quantity + 1 },
      { assembledQuantity: 1, deliveredQuantity: 0 },
    ])
      expect(isCrewWorkItem({ ...item, ...patch })).toBe(false);
  });
  it('keeps terminal report snapshots public and separately validates backoffice execution projections', () => {
    const snapshot = report();
    expect(isFinishReport(snapshot)).toBe(true);
    expect(isFinishReport({ ...snapshot, quantityScope: 'THIS_ASSIGNMENT' })).toBe(false);
    expect(
      isFinishReport({
        ...snapshot,
        quantities: [{ ...snapshot.quantities[0], orderTotalCents: 123 }],
      }),
    ).toBe(false);
    const assignment: CrewAssignmentDetail = { ...fixture(), finishReport: snapshot };
    expect(isCrewAssignmentDetail(assignment)).toBe(true);
    const backoffice = {
      execution: { ...orderFixture.execution, finishReports: [snapshot] },
      appointments: [appointmentFixture],
    };
    expect(isOrderExecutionResponse(backoffice)).toBe(true);
    expect(
      isOrderExecutionResponse({
        ...backoffice,
        execution: { ...backoffice.execution, completedAssignmentCount: -1 },
      }),
    ).toBe(false);
    expect(isOrderProgress('AWAITING_REVIEW')).toBe(true);
    expect(isOrderProgress('COMPLETED')).toBe(true);
    expect(isOrderProgress('ARCHIVED')).toBe(false);
  });
});
