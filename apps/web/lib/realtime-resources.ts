import type { RealtimeTopic } from '@furniture-delivery/contracts';

export function resourceTopics(path: string): RealtimeTopic[] {
  const route = path.split('?')[0]!;
  if (route === '/dashboard') return ['dashboard'];
  if (route.endsWith('/acceptance')) return ['acceptance', 'crew-work', 'planning'];
  if (/\/completion-(readiness|history)$/.test(route))
    return ['completion', 'acceptance', 'orders', 'planning', 'crew-work', 'evidence', 'returns'];
  if (route.startsWith('/planning/')) return ['planning'];
  if (route.includes('/evidence') || route.startsWith('/issues')) return ['evidence'];
  if (route.startsWith('/backoffice/return-requests')) return ['returns', 'planning', 'crew-work'];
  if (route.startsWith('/crew/assignments'))
    return ['crew-work', 'planning', 'evidence', 'returns', 'acceptance', 'completion'];
  if (route.startsWith('/orders'))
    return ['orders', 'planning', 'crew-work', 'evidence', 'returns', 'acceptance', 'completion'];
  if (route.startsWith('/crews/member-candidates') || route.startsWith('/users'))
    return ['accounts', 'crews'];
  if (route.startsWith('/crews/') && route.endsWith('/planning')) return ['planning', 'crews'];
  if (route.startsWith('/crews')) return ['crews', 'crew-team'];
  if (route.startsWith('/task-templates')) return ['templates'];
  return [];
}
export function resourceKey(path: string): string {
  const [route, query] = path.split('?');
  if (!query) return route!;
  const params = new URLSearchParams(query);
  params.sort();
  return `${route}?${params}`;
}
