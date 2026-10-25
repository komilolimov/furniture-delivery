import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthResponse, MessageResponse } from '@furniture-delivery/contracts';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from './auth.decorators';
import { AUTH_CONFIG } from './auth.types';
import type { AuthConfig, AuthenticatedRequest } from './auth.types';
import { LoginRateLimiter } from './login-rate-limiter';
import { objectPayload, passwordValue, usernameValue } from './validation';
import { readSessionCookie, SESSION_COOKIE, sessionCookieOptions } from './session-cookie';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(LoginRateLimiter) private readonly limiter: LoginRateLimiter,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const payload = objectPayload(body, ['username', 'password']);
    const username = usernameValue(payload.username);
    const retryAfter = this.limiter.consume(username, request.socket.remoteAddress ?? 'unknown');
    if (retryAfter !== undefined) {
      response.setHeader('Retry-After', retryAfter.toString());
      throw LoginRateLimiter.rejection();
    }
    const password = passwordValue(payload.password);
    const session = await this.auth.login(
      username,
      password,
      readSessionCookie(request.headers.cookie),
    );
    response.cookie(SESSION_COOKIE, session.token, {
      ...sessionCookieOptions(this.config),
      expires: session.expiresAt,
      maxAge: this.config.sessionTtlSeconds * 1000,
    });
    return { user: session.user };
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@Req() request: AuthenticatedRequest): AuthResponse {
    if (!request.user) throw new UnauthorizedException('Authentication required.');
    return { user: request.user };
  }

  @Post('logout')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MessageResponse> {
    if (!request.sessionId) throw new UnauthorizedException('Authentication required.');
    await this.auth.logout(request.sessionId);
    response.clearCookie(SESSION_COOKIE, sessionCookieOptions(this.config));
    return { message: 'Logged out.' };
  }
}
