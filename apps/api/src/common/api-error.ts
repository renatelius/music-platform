import type { ErrorCode, ProblemOptions } from '@mp/contracts';

/** Domain error rendered as RFC 9457 Problem Details by ProblemExceptionFilter. */
export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly code: ErrorCode,
    readonly options: ProblemOptions = {},
  ) {
    super(options.detail ?? code);
  }
}
