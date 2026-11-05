import { z } from 'zod';

/** Machine-readable error codes. Clients branch on `code`, never on `title` text. */
export const ErrorCode = z.enum([
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  /** A track to add is already in the playlist; `errors` name the request fields. */
  'DUPLICATE_TRACKS',
  /** A per-user limit (likes, playlists, playlist length) would be exceeded. */
  'LIMIT_EXCEEDED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'INTERNAL',
  'SERVICE_UNAVAILABLE',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const FieldError = z.object({
  path: z.string(),
  message: z.string(),
});
export type FieldError = z.infer<typeof FieldError>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** RFC 9457 Problem Details, extended with `code`, `requestId` and field `errors`. */
export const ProblemDetails = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: ErrorCode,
  requestId: z.string().optional(),
  errors: z.array(FieldError).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_TRACKS: 409,
  LIMIT_EXCEEDED: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
};

const TITLE_BY_CODE: Record<ErrorCode, string> = {
  BAD_REQUEST: 'Malformed request',
  VALIDATION_FAILED: 'Request validation failed',
  UNAUTHENTICATED: 'Authentication required',
  FORBIDDEN: 'Access denied',
  NOT_FOUND: 'Resource not found',
  CONFLICT: 'Resource conflict',
  DUPLICATE_TRACKS: 'Already in the playlist',
  LIMIT_EXCEEDED: 'Limit reached',
  PAYLOAD_TOO_LARGE: 'Payload too large',
  UNSUPPORTED_MEDIA_TYPE: 'Unsupported media type',
  RATE_LIMITED: 'Too many requests',
  INTERNAL: 'Internal server error',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable',
};

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

/** Problem type URI reference, e.g. `/problems/not-found`. */
export function problemType(code: ErrorCode): string {
  return `/problems/${code.toLowerCase().replaceAll('_', '-')}`;
}

export interface ProblemOptions {
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: FieldError[];
}

export function createProblem(code: ErrorCode, options: ProblemOptions = {}): ProblemDetails {
  const problem: ProblemDetails = {
    type: problemType(code),
    title: TITLE_BY_CODE[code],
    status: STATUS_BY_CODE[code],
    code,
  };
  if (options.detail !== undefined) problem.detail = options.detail;
  if (options.instance !== undefined) problem.instance = options.instance;
  if (options.requestId !== undefined) problem.requestId = options.requestId;
  if (options.errors !== undefined && options.errors.length > 0) problem.errors = options.errors;
  return problem;
}

/** Converts zod issues into flat field errors: `items.0.title` -> message. */
export function fieldErrorsFromZod(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path
      .map((segment) =>
        typeof segment === 'symbol' ? (segment.description ?? '') : String(segment),
      )
      .join('.'),
    message: issue.message,
  }));
}
