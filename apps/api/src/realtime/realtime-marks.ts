import type { EntityManager } from 'typeorm';
import { markRealtime } from './post-commit';

/** These are invalidation hints, not serialized activity logs or domain-event payloads. */
export function markOrder(manager: EntityManager, orderId: string, crewVisible: boolean): void {
  markRealtime(manager, {
    orderId,
    backoffice: ['orders', 'dashboard', 'completion'],
    ...(crewVisible ? { crew: ['crew-work', 'completion'] as const } : {}),
  });
}
export function markPlanning(
  manager: EntityManager,
  orderId: string,
  listCrewIds: readonly string[] = [],
  crewVisible = true,
): void {
  markRealtime(manager, {
    orderId,
    backoffice: ['orders', 'dashboard', 'planning', 'returns', 'completion'],
    ...(crewVisible
      ? { crew: ['planning', 'crew-work', 'returns', 'completion'] as const, listCrewIds }
      : {}),
  });
}
export function markExecution(manager: EntityManager, orderId: string): void {
  markRealtime(manager, {
    orderId,
    backoffice: [
      'orders',
      'dashboard',
      'planning',
      'crew-work',
      'evidence',
      'returns',
      'completion',
    ],
    crew: ['crew-work', 'planning', 'evidence', 'returns', 'completion'],
  });
}
export function markEvidence(manager: EntityManager, orderId: string, visibility: string): void {
  markRealtime(manager, {
    orderId,
    backoffice: ['orders', 'dashboard', 'evidence', 'completion'],
    ...(visibility === 'CREW_VISIBLE'
      ? { crew: ['evidence', 'crew-work', 'completion'] as const }
      : {}),
  });
}
export function markAcceptance(
  manager: EntityManager,
  orderId: string,
  crewIds?: readonly string[],
): void {
  markRealtime(manager, {
    orderId,
    backoffice: ['orders', 'dashboard', 'acceptance', 'completion'],
    ...(crewIds === undefined || crewIds.length
      ? { crew: ['acceptance', 'crew-work', 'completion'] as const }
      : {}),
    ...(crewIds ? { crewIds } : {}),
  });
}
export function markCompletion(manager: EntityManager, orderId: string): void {
  markRealtime(manager, {
    orderId,
    backoffice: ['orders', 'dashboard', 'completion'],
    crew: ['crew-work', 'acceptance', 'completion'],
  });
}
export function markReturn(
  manager: EntityManager,
  orderId: string,
  listCrewIds: readonly string[] = [],
): void {
  markRealtime(manager, {
    orderId,
    backoffice: ['orders', 'dashboard', 'returns', 'planning', 'completion'],
    crew: ['crew-work', 'returns', 'planning', 'completion'],
    listCrewIds,
  });
}
export function markCrew(manager: EntityManager, crewId: string, userId?: string): void {
  markRealtime(manager, {
    backoffice: ['crews', 'accounts', 'planning'],
    crew: ['crew-team', 'crew-work'],
    crewIds: [crewId],
    ...(userId ? { userId } : {}),
  });
}
