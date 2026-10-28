'use client';
import { createContext, useContext } from 'react';
import type { RealtimeCoordinator } from './realtime-coordinator';
export const RealtimeContext = createContext<RealtimeCoordinator | null>(null);
export const useRealtimeCoordinator = () => useContext(RealtimeContext);
