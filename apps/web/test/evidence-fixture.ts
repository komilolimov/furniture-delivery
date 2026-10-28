import type {
  AttachmentRecord,
  EvidenceResponse,
  ExecutionNoteRecord,
  IssueRecord,
} from '@furniture-delivery/contracts';
export const evidenceOrderId = '10000000-0000-4000-8000-000000000001';
export const evidenceAssignmentId = '20000000-0000-4000-8000-000000000001';
export const evidenceItems = [
  { id: '30000000-0000-4000-8000-000000000001', description: 'Oak table' },
  { id: '30000000-0000-4000-8000-000000000002', description: 'Chairs' },
];
const instant = '2030-01-07T09:00:00.000Z';
export const evidenceFile: AttachmentRecord = {
  id: '40000000-0000-4000-8000-000000000001',
  orderId: evidenceOrderId,
  appointmentId: null,
  assignmentId: evidenceAssignmentId,
  itemId: null,
  visibility: 'CREW_VISIBLE',
  proofType: 'DELIVERY',
  kind: 'IMAGE',
  displayName: 'proof.png',
  contentType: 'image/webp',
  sizeBytes: 200,
  width: 4,
  height: 3,
  authorId: 'author',
  createdAt: instant,
  withdrawnAt: null,
  withdrawReason: null,
  contentUrl: `/api/orders/${evidenceOrderId}/attachments/40000000-0000-4000-8000-000000000001/content`,
  thumbnailUrl: `/api/orders/${evidenceOrderId}/attachments/40000000-0000-4000-8000-000000000001/thumbnail`,
};
export const evidenceNote: ExecutionNoteRecord = {
  id: '50000000-0000-4000-8000-000000000001',
  orderId: evidenceOrderId,
  appointmentId: null,
  assignmentId: evidenceAssignmentId,
  itemId: null,
  visibility: 'CREW_VISIBLE',
  text: 'Saved execution note',
  authorId: 'author',
  createdAt: instant,
};
export const evidenceIssue: IssueRecord = {
  id: '60000000-0000-4000-8000-000000000001',
  orderId: evidenceOrderId,
  appointmentId: null,
  assignmentId: evidenceAssignmentId,
  visibility: 'CREW_VISIBLE',
  type: 'DAMAGE',
  description: 'A fitting is scratched',
  reportedSource: 'CREW',
  status: 'OPEN',
  version: 1,
  itemIds: [evidenceItems[0]!.id],
  attachmentIds: [evidenceFile.id],
  authorId: 'author',
  createdAt: instant,
  updatedAt: instant,
  resolvedAt: null,
  resolvedBy: null,
  resolution: null,
  events: [
    {
      id: 'event',
      issueId: '60000000-0000-4000-8000-000000000001',
      kind: 'CREATED',
      text: 'Issue reported',
      actorId: 'author',
      createdAt: instant,
    },
  ],
};
export const emptyEvidence: EvidenceResponse = {
  notes: [],
  issues: [],
  attachments: [],
  limits: {
    imageMaxBytes: 10485760,
    pdfMaxBytes: 20971520,
    maxPixels: 40000000,
    orderMaxFiles: 100,
    orderMaxBytes: 262144000,
  },
};
export const evidenceFixture: EvidenceResponse = {
  ...emptyEvidence,
  notes: [evidenceNote],
  issues: [evidenceIssue],
  attachments: [evidenceFile],
};
