import type {
  ReturnAttemptRecord,
  ReturnRequestDetail,
  SlotCandidate,
} from '@furniture-delivery/contracts';
import { crewAssignmentFixture } from './execution-fixture';
import { appointmentFixture, fixtureActorId, planningCrews } from './planning-fixture';

const instant = '2030-01-07T10:00:00.000Z';
export const returnDetailFixture: ReturnRequestDetail = {
  request: {
    id: '60000000-0000-4000-8000-000000000001',
    orderId: crewAssignmentFixture.orderId,
    appointmentId: appointmentFixture.id,
    assignmentId: crewAssignmentFixture.id,
    finishReportId: '70000000-0000-4000-8000-000000000001',
    status: 'OPEN',
    version: 2,
    reason: 'Missing cabinet hinge',
    remainingWork: 'Assemble the remaining cabinet',
    authorId: fixtureActorId,
    createdAt: instant,
    updatedAt: instant,
    updatedBy: fixtureActorId,
    resolvedAt: null,
    resolvedBy: null,
    resolution: null,
  },
  sourceReport: {
    id: '70000000-0000-4000-8000-000000000001',
    orderId: crewAssignmentFixture.orderId,
    appointmentId: appointmentFixture.id,
    assignmentId: crewAssignmentFixture.id,
    outcome: 'PARTIALLY_COMPLETED',
    summary: 'Delivered one cabinet; hinge missing',
    reason: 'Missing hinge',
    remainingWork: 'Deliver and assemble the rest',
    quantityScope: 'ACCUMULATED_ORDER',
    taskResults: [
      {
        ...crewAssignmentFixture.tasks[0]!,
        id: 'old-done-task',
        name: 'Old completed inspection',
        resultStatus: 'DONE',
        doneBy: fixtureActorId,
        doneAt: instant,
      },
    ],
    quantities: [
      {
        ...crewAssignmentFixture.items[0]!,
        quantity: 2,
        deliveredQuantity: 1,
        assembledQuantity: 0,
        requiresAssembly: true,
        remainingDeliveryQuantity: 1,
        remainingAssemblyQuantity: 2,
      },
    ],
    knownIssueIds: [],
    attachmentIds: [],
    authorId: fixtureActorId,
    actualEndAt: instant,
    createdAt: instant,
  },
  scopeCandidates: [
    {
      sourceTaskId: '80000000-0000-4000-8000-000000000001',
      sourceAssignmentId: crewAssignmentFixture.id,
      sourceAppointmentId: appointmentFixture.id,
      name: 'Assemble remaining cabinet',
      description: 'Fit the missing hinge',
      required: true,
      severity: 'HIGH',
      priority: 10,
      resultStatus: 'PENDING',
    },
  ],
  items: [
    {
      ...crewAssignmentFixture.items[0]!,
      quantity: 2,
      deliveredQuantity: 1,
      assembledQuantity: 0,
      requiresAssembly: true,
      remainingDeliveryQuantity: 1,
      remainingAssemblyQuantity: 2,
    },
  ],
  attempts: [],
  currentAppointment: null,
  readyToResolve: false,
  resolveBlockedReasons: ['Plan and complete a current follow-up before resolving this request.'],
};

export const failedReturnAttemptFixture: ReturnAttemptRecord = {
  id: '90000000-0000-4000-8000-000000000001',
  requestId: returnDetailFixture.request.id,
  appointmentId: '40000000-0000-4000-8000-000000000002',
  current: false,
  closedOutcome: 'FAILED',
  scope: {
    tasks: [],
    itemTargets: [
      { itemId: returnDetailFixture.items[0]!.id, deliveredQuantity: 2, assembledQuantity: 2 },
    ],
  },
  returnRequested: true,
  createdBy: fixtureActorId,
  createdAt: instant,
  closedAt: '2030-01-08T12:00:00.000Z',
  closedBy: fixtureActorId,
  closeReason: 'Replacement hinge still unavailable',
};

export const returnSlotFixture: SlotCandidate = {
  localStart: '2030-01-09T10:00',
  plannedStartAt: '2030-01-09T09:00:00.000Z',
  plannedEndAt: '2030-01-09T10:00:00.000Z',
  durationMinutes: 60,
  crewIds: [planningCrews[0]!.id],
  crews: [{ ...planningCrews[0]!, travelBufferMinutes: 30 }],
  basis: 'PLAN',
  notes: ['Availability must be checked again on submit.'],
};

export const plannedReturnDetailFixture: ReturnRequestDetail = {
  ...returnDetailFixture,
  request: { ...returnDetailFixture.request, status: 'PLANNED', version: 3 },
  currentAppointment: {
    ...appointmentFixture,
    id: failedReturnAttemptFixture.appointmentId,
    returnRequestId: returnDetailFixture.request.id,
  },
  attempts: [
    {
      ...failedReturnAttemptFixture,
      current: true,
      closedOutcome: null,
      closedAt: null,
      closedBy: null,
      closeReason: null,
      returnRequested: false,
    },
  ],
  readyToResolve: false,
  resolveBlockedReasons: ['Every team must complete the follow-up before resolving it.'],
};
