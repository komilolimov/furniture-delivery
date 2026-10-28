'use client';

import { useEffect } from 'react';
import { useApiResource } from './use-api-resource';
import type { ResourceOptions } from './use-api-resource';
import { useRealtimeCoordinator } from './realtime-context';

export function ordersChanged() {
  window.dispatchEvent(new Event('fd:orders-changed'));
}

/** Lists and dashboard reread the server after local mutations and when returning to the tab. */
export function useOrderResource<T>(
  path: string,
  validate: (value: unknown) => value is T,
  options: ResourceOptions = {},
) {
  const coordinator = useRealtimeCoordinator();
  const resource = useApiResource(path, validate, options);
  const { refresh } = resource;
  useEffect(() => {
    if (coordinator) return;
    const reload = () => {
      void refresh();
    };
    window.addEventListener('focus', reload);
    window.addEventListener('fd:orders-changed', reload);
    return () => {
      window.removeEventListener('focus', reload);
      window.removeEventListener('fd:orders-changed', reload);
    };
  }, [refresh, coordinator]);
  return resource;
}
