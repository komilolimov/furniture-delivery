import type { AuthUser } from '@furniture-delivery/contracts';
import type { Request } from 'express';

export interface AuthConfig {
  webOrigin: string;
  sessionTtlSeconds: number;
  cookieSecure: boolean;
  loginWindowSeconds: number;
  loginMaxAttempts: number;
}

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  sessionId?: string;
}
