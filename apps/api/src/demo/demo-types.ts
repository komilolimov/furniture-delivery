export const DEMO_MAGIC = 'furniture-delivery-synthetic-demo-v1';
export const DEMO_ORDER_COUNT = 40;
export interface DemoTarget {
  host: string;
  port: number;
  name: string;
  user: string;
}
export interface DemoOwner {
  magic: typeof DEMO_MAGIC;
  runId: string;
  ownerId: string;
  workspaceHash: string;
}
export interface DemoProcess {
  pid: number;
  startTime: string;
  command: string;
  cwd: string;
}
export interface DemoRunState {
  version: 1;
  owner: DemoOwner;
  target: DemoTarget;
  baseDate: string;
  schema: string;
  createdAt: string;
  status: 'PREPARING' | 'PREPARED' | 'FAILED' | 'RUNNING' | 'STOPPED';
  supervisor?: DemoProcess;
  children?: DemoProcess[];
  generatedNextEnvHash?: string;
  originalNextEnvPresent?: boolean;
}
export interface DemoCredential {
  username: string;
  password: string;
  role: 'ADMIN' | 'DISPATCHER' | 'CREW_MEMBER';
  displayName: string;
  crewCode?: string;
}
export interface DemoOrderReference {
  key: string;
  orderId: string;
  orderNumber: string;
  scenario: string;
  intendedState: string;
  appointmentIds: string[];
  crewCodes: string[];
  crewAssignments: { assignmentId: string; crewCode: string; crewPath: string }[];
  requestIds: string[];
  issueIds: string[];
  snapshotIds: string[];
  completionIds: string[];
  backofficePath: string;
}
export interface DemoManifest {
  version: 1;
  synthetic: true;
  runId: string;
  baseDate: string;
  createdAt: string;
  orders: DemoOrderReference[];
  counts: { orders: number; crews: number; employees: number; backofficeUsers: number };
  narratives: { key: string; title: string; orderIds: string[]; steps: string[] }[];
  observedProgress: Record<string, number>;
  limitations: string[];
}
