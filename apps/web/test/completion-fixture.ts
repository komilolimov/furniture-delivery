import type {
  CompletionHistoryResponse,
  CompletionReadinessRecord,
  CompletionRecordRecord,
} from '@furniture-delivery/contracts';
import { orderFixture } from './order-fixture';
export const completionReadinessFixture: CompletionReadinessRecord = {
  orderId: orderFixture.id,
  orderVersion: 12,
  canComplete: true,
  physicalReady: true,
  confirmationsReady: true,
  currentCompletion: null,
  blockers: [],
  snapshotIds: ['snapshot-1'],
  signatureIds: ['staff-signature', 'customer-signature'],
  exceptionIds: [],
  coverageRequestIds: [],
};
export const completionRecordFixture: CompletionRecordRecord = {
  id: 'completion-1',
  orderId: orderFixture.id,
  actorId: 'dispatcher',
  createdAt: '2030-01-07T12:00:00.000Z',
  reason: 'Reviewed completed fictional delivery',
  readiness: {
    schemaVersion: 1,
    orderVersion: 12,
    snapshotIds: ['snapshot-1'],
    signatureIds: ['staff-signature', 'customer-signature'],
    exceptionIds: [],
    coverageRequestIds: [],
    operationalDetails: { workReady: true, openIssueCount: 0, openReturnCount: 0 },
  },
};
export const completedReadinessFixture: CompletionReadinessRecord = {
  ...completionReadinessFixture,
  orderVersion: 13,
  canComplete: false,
  currentCompletion: completionRecordFixture,
  blockers: [
    { code: 'ALREADY_COMPLETED', message: 'This order already has a current explicit completion.' },
  ],
};
export const completionHistoryFixture: CompletionHistoryResponse = {
  currentCompletionId: null,
  completions: [],
  reopenEvents: [],
};
