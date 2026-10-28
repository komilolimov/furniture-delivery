/** Invalidation hints only. Re-read the normal authorized API; no record data travels in SSE. */
export const realtimeTopics = [
  'orders',
  'dashboard',
  'planning',
  'crew-work',
  'crew-team',
  'evidence',
  'returns',
  'acceptance',
  'completion',
  'crews',
  'templates',
  'accounts',
] as const;
export type RealtimeTopic = (typeof realtimeTopics)[number];
export interface RealtimeReady {
  emittedAt: string;
}
export interface RealtimeInvalidation {
  eventId: string;
  emittedAt: string;
  topics: RealtimeTopic[];
}
export interface RealtimeAccessReset {
  eventId: string;
  emittedAt: string;
  reason: 'SESSION_ENDED' | 'SCOPE_CHANGED';
}
