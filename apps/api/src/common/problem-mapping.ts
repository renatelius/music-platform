import { HttpException } from '@nestjs/common';

import { createProblem, type ErrorCode, type ProblemDetails } from '@mp/contracts';

import { ApiError } from './api-error.js';

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

export interface ProblemContext {
  requestId?: string;
  instance?: string;
}

/** Maps any thrown value to Problem Details. Internal error details are never exposed. */
export function toProblem(exception: unknown, context: ProblemContext): ProblemDetails {
  if (exception instanceof ApiError) {
    return createProblem(exception.code, { ...exception.options, ...context });
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL' : 'BAD_REQUEST');
    return createProblem(code, {
      ...context,
      detail: status < 500 ? stripQueryStrings(exception.message) : undefined,
    });
  }
  return createProblem('INTERNAL', context);
}

/** Router messages look like "Cannot GET /path?token=..." — never echo query strings back. */
function stripQueryStrings(message: string): string {
  return message.replace(/\?\S*/g, '');
}
