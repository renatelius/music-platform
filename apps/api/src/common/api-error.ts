import type { ErrorCode, ProblemOptions } from '@mp/contracts';

export interface ApiErrorOptions extends ProblemOptions {
  /** Extra response headers, e.g. Retry-After or WWW-Authenticate. */
  headers?: Record<string, string>;
}

/** Domain error rendered as RFC 9457 Problem Details by ProblemExceptionFilter. */
export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly code: ErrorCode,
    readonly options: ApiErrorOptions = {},
  ) {
    super(options.detail ?? code);
  }
}
