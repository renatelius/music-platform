import { ApiRequestError, NetworkError } from '@mp/api-client';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@mp/contracts';
import type { Translator } from '@mp/i18n';
import type { z } from 'zod';

export type FieldErrors = Partial<Record<string, string>>;

/** Client-side validation with the same contracts the API uses, in the user's language. */
export function validationErrors(error: z.ZodError, t: Translator): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? '');
    if (result[field] !== undefined) continue;
    result[field] = messageFor(field, issue, t);
  }
  return result;
}

function messageFor(field: string, issue: z.core.$ZodIssue, t: Translator): string {
  const empty = issue.code === 'too_small' && 'minimum' in issue && Number(issue.minimum) <= 1;
  if (empty && field !== 'email') return t('validation.required');
  switch (field) {
    case 'email':
      return t('validation.email');
    case 'password':
      return issue.code === 'custom'
        ? t('validation.passwordEqualsEmail')
        : t('validation.passwordLength', { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH });
    case 'displayName':
      return t('validation.displayName');
    default:
      return t('validation.required');
  }
}

export type ErrorContext = 'login' | 'register' | 'link' | 'generic';

/** Maps API failures to a user-facing message. Never shows raw server text. */
export function apiErrorMessage(
  error: unknown,
  t: Translator,
  context: ErrorContext = 'generic',
): string {
  if (error instanceof NetworkError) return t('errors.network');
  if (!(error instanceof ApiRequestError)) return t('errors.unknown');
  switch (error.code) {
    case 'RATE_LIMITED':
      return t('errors.rateLimited');
    case 'SERVICE_UNAVAILABLE':
      return t('errors.unavailable');
    case 'UNAUTHENTICATED':
      return context === 'login' ? t('errors.invalidCredentials') : t('errors.sessionExpired');
    case 'CONFLICT':
      return context === 'register' ? t('errors.emailTaken') : t('errors.unknown');
    case 'BAD_REQUEST':
      return context === 'link' ? t('errors.invalidLink') : t('errors.unknown');
    case null:
      // No problem body: the proxy could not reach the API, or an unexpected gateway error.
      return error.status >= 500 ? t('errors.unavailable') : t('errors.unknown');
    default:
      return t('errors.unknown');
  }
}
