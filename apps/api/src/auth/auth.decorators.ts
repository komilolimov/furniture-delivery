import { createParamDecorator, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthUser, UserRole } from '@furniture-delivery/contracts';
import type { AuthenticatedRequest } from './auth.types';

export const PUBLIC_ROUTE = Symbol('PUBLIC_ROUTE');
export const ALLOWED_ROLES = Symbol('ALLOWED_ROLES');
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const Roles = (...roles: UserRole[]) => SetMetadata(ALLOWED_ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new UnauthorizedException('Authentication required.');
    return user;
  },
);

/** Trusted guard context; never accepted from a business request body. */
export const CurrentSessionId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const sessionId = context.switchToHttp().getRequest<AuthenticatedRequest>().sessionId;
    if (!sessionId) throw new UnauthorizedException('Authentication required.');
    return sessionId;
  },
);
