import type {
  AcceptanceDocumentRecord,
  BackofficeAcceptanceResponse,
  CrewAcceptanceResponse,
  CrewAcceptanceSlotRecord,
  SignatureConfirmationRecord,
} from '@furniture-delivery/contracts';
import { crewAssignmentFixture } from './execution-fixture';
import { appointmentFixture, fixtureActorId, planningCrews } from './planning-fixture';
import { returnDetailFixture } from './return-fixture';

const instant = '2030-01-07T10:00:00.000Z';
const report = returnDetailFixture.sourceReport;
export const acceptanceDocumentFixture: AcceptanceDocumentRecord = {
  snapshot: {
    id: 'a0000000-0000-4000-8000-000000000001',
    orderId: crewAssignmentFixture.orderId,
    appointmentId: appointmentFixture.id,
    version: 1,
    hash: 'a'.repeat(64),
    createdBy: fixtureActorId,
    createdAt: instant,
    invalidatedAt: null,
    invalidatedBy: null,
    invalidationReason: null,
    payload: {
      schemaVersion: 1,
      createdAt: instant,
      createdBy: fixtureActorId,
      order: {
        id: crewAssignmentFixture.orderId,
        number: crewAssignmentFixture.orderNumber,
        customerName: 'Fixture customer',
        address: 'Fictional street 10',
        city: 'Rome',
        country: 'Italy',
        postalCode: null,
        serviceType: 'DELIVERY_AND_ASSEMBLY',
        items: [
          {
            id: report.quantities[0]!.id,
            description: report.quantities[0]!.description,
            quantity: 2,
            configuration: '',
            ambient: '',
            requiresAssembly: true,
          },
        ],
      },
      appointment: {
        id: appointmentFixture.id,
        plannedStartAt: appointmentFixture.plannedStartAt,
        plannedEndAt: appointmentFixture.plannedEndAt,
      },
      teams: [0, 1].map((index) => ({
        assignmentId:
          index === 0 ? crewAssignmentFixture.id : 'b0000000-0000-4000-8000-000000000002',
        crewId: planningCrews[index]!.id,
        crewName: planningCrews[index]!.name,
        finishReportId: index === 0 ? report.id : 'b0000000-0000-4000-8000-000000000003',
        reportCreatedAt: index === 0 ? instant : '2030-01-07T11:00:00.000Z',
        authorId: fixtureActorId,
        outcome: index === 0 ? ('PARTIALLY_COMPLETED' as const) : ('COMPLETED' as const),
        summary:
          index === 0
            ? 'One cabinet delivered; assembly remains'
            : 'Second team recorded its result',
        reason: index === 0 ? 'Missing hinge' : null,
        remainingWork: index === 0 ? 'Fit replacement hinge' : null,
        departedAt: '2030-01-07T08:00:00.000Z',
        arrivedAt: '2030-01-07T08:10:00.000Z',
        actualStartAt: '2030-01-07T08:20:00.000Z',
        actualEndAt: index === 0 ? instant : '2030-01-07T11:00:00.000Z',
        taskResults: report.taskResults,
        quantities: report.quantities.map((item) => ({
          ...item,
          deliveredQuantity: index === 0 ? 1 : 2,
          assembledQuantity: index === 0 ? 0 : 2,
          remainingDeliveryQuantity: index === 0 ? 1 : 0,
          remainingAssemblyQuantity: index === 0 ? 2 : 0,
        })),
      })),
      issues: [
        {
          id: 'fixture-issue',
          type: 'MISSING_PARTS',
          description: 'Replacement hinge needed',
          status: 'OPEN',
          itemIds: [report.quantities[0]!.id],
        },
      ],
      returnRequests: [
        {
          id: returnDetailFixture.request.id,
          appointmentId: appointmentFixture.id,
          status: 'OPEN',
          reason: 'Return with hinge',
          remainingWork: 'Finish assembly',
        },
      ],
      evidence: [],
      confirmation: {
        version: 'm7-1',
        text: 'I acknowledge the recorded visit result, including the stated unfinished work and issues.',
      },
    },
  },
  slots: [
    {
      id: 'c0000000-0000-4000-8000-000000000001',
      snapshotId: 'a0000000-0000-4000-8000-000000000001',
      kind: 'CUSTOMER',
      assignmentId: null,
      status: 'MISSING',
      maySign: true,
      mayReportAbsence: true,
      canReadImage: false,
      confirmation: null,
      exception: null,
      mayReview: false,
    },
    {
      id: 'c0000000-0000-4000-8000-000000000002',
      snapshotId: 'a0000000-0000-4000-8000-000000000001',
      kind: 'CREW',
      assignmentId: crewAssignmentFixture.id,
      status: 'MISSING',
      maySign: false,
      mayReportAbsence: true,
      canReadImage: false,
      confirmation: null,
      exception: null,
      mayReview: false,
    },
    {
      id: 'c0000000-0000-4000-8000-000000000003',
      snapshotId: 'a0000000-0000-4000-8000-000000000001',
      kind: 'CREW',
      assignmentId: 'b0000000-0000-4000-8000-000000000002',
      status: 'MISSING',
      maySign: false,
      mayReportAbsence: true,
      canReadImage: false,
      confirmation: null,
      exception: null,
      mayReview: false,
    },
  ],
};
export const backofficeAcceptanceFixture: BackofficeAcceptanceResponse = {
  acceptance: {
    appointmentId: appointmentFixture.id,
    canPrepare: false,
    preparationBlockedReason: null,
    current: acceptanceDocumentFixture,
    history: [acceptanceDocumentFixture],
  },
};
function crewSlot(index: number): CrewAcceptanceSlotRecord {
  const slot = acceptanceDocumentFixture.slots[index]!,
    own = index < 2;
  return {
    id: slot.id,
    snapshotId: slot.snapshotId,
    kind: slot.kind,
    assignmentId: slot.assignmentId,
    status: slot.status,
    maySign: own,
    mayReportAbsence: own,
    canReadImage: false,
    confirmation: null,
    exception: null,
  };
}
export const crewAcceptanceFixture: CrewAcceptanceResponse = {
  acceptance: {
    appointmentId: appointmentFixture.id,
    ownAssignmentId: crewAssignmentFixture.id,
    canPrepare: false,
    preparationBlockedReason: null,
    current: { snapshot: acceptanceDocumentFixture.snapshot, slots: [0, 1, 2].map(crewSlot) },
    history: [{ snapshot: acceptanceDocumentFixture.snapshot, slots: [0, 1, 2].map(crewSlot) }],
  },
};
export const absenceConfirmationFixture: SignatureConfirmationRecord = {
  id: 'd0000000-0000-4000-8000-000000000001',
  slotId: acceptanceDocumentFixture.slots[0]!.id,
  snapshotId: acceptanceDocumentFixture.snapshot.id,
  snapshotHash: acceptanceDocumentFixture.snapshot.hash,
  method: 'ABSENCE',
  signerName: null,
  signerRelation: null,
  capturedByUserId: fixtureActorId,
  recordedAt: instant,
  imageDigest: null,
  width: null,
  height: null,
  sizeBytes: null,
  absenceKind: 'REFUSED',
  absenceReason: 'Customer asked dispatcher to review the missing part',
};
