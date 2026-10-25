import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@furniture-delivery/contracts';
import { AuthService } from './auth.service';
import { ALLOWED_ROLES, PUBLIC_ROUTE } from './auth.decorators';
import { AUTH_CONFIG } from './auth.types';
import type { AuthConfig, AuthenticatedRequest } from './auth.types';
import { readSessionCookie } from './session-cookie';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (
        request.headers.origin !== this.config.webOrigin ||
        request.headers['x-csrf-protection'] !== '1'
      ) {
        throw new ForbiddenException('Request origin or CSRF protection is invalid.');
      }
    }
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) return true;
    const token = readSessionCookie(request.headers.cookie);
    if (!token) throw new UnauthorizedException('Authentication required.');
    try {
      const session = await this.auth.resolveSession(token);
      if (!session) throw new UnauthorizedException('Authentication required.');
      request.user = session.user;
      request.sessionId = session.sessionId;
      const roles = this.reflector.getAllAndOverride<UserRole[]>(ALLOWED_ROLES, targets);
      if (roles && !roles.includes(session.user.role))
        throw new ForbiddenException('Insufficient permissions.');
      return true;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Authentication service is unavailable.');
    }
  }
}
