import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { PlanningConflict } from '../planning/planning-errors';

/** Never serialize connection errors, stacks, or body-parser excerpts of credentials. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const parseFailure =
      error instanceof SyntaxError ||
      (typeof error === 'object' &&
        error !== null &&
        'type' in error &&
        error.type === 'entity.parse.failed');
    const status = parseFailure ? 400 : error instanceof HttpException ? error.getStatus() : 500;
    let message: string | string[] =
      status === 503
        ? 'The service is temporarily unavailable.'
        : 'The request could not be completed.';
    if (parseFailure) {
      message = 'The request body must be valid JSON.';
    } else if (error instanceof HttpException && status < 500) {
      const body = error.getResponse();
      if (typeof body === 'string') message = body;
      else if (typeof body === 'object' && body !== null && 'message' in body) {
        const value: unknown = body.message;
        if (typeof value === 'string') message = value;
        else if (Array.isArray(value) && value.every((item) => typeof item === 'string'))
          message = value;
      }
    }
    response.status(status).setHeader('Cache-Control', 'no-store');
    response.json({
      statusCode: status,
      message,
      ...(error instanceof PlanningConflict ? { code: error.code, details: error.details } : {}),
    });
  }
}
