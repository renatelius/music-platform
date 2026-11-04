import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  createProblem,
  ErrorCode,
  fieldErrorsFromZod,
  ProblemDetails,
  problemType,
  statusForCode,
} from './problem.js';

describe('problem details', () => {
  it('maps every error code to a valid HTTP error status', () => {
    for (const code of ErrorCode.options) {
      const status = statusForCode(code);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it('creates RFC 9457 compliant problems', () => {
    const problem = createProblem('NOT_FOUND', { detail: 'Track not found', requestId: 'req-1' });
    expect(ProblemDetails.parse(problem)).toEqual({
      type: '/problems/not-found',
      title: 'Resource not found',
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Track not found',
      requestId: 'req-1',
    });
  });

  it('omits empty field error lists', () => {
    expect(createProblem('VALIDATION_FAILED', { errors: [] })).not.toHaveProperty('errors');
  });

  it('builds kebab-case type references', () => {
    expect(problemType('UNSUPPORTED_MEDIA_TYPE')).toBe('/problems/unsupported-media-type');
  });

  it('flattens zod issues into field errors', () => {
    const schema = z.object({ items: z.array(z.object({ title: z.string().min(1) })) });
    const result = schema.safeParse({ items: [{ title: '' }] });
    expect(result.success).toBe(false);
    if (result.success) return;
    const errors = fieldErrorsFromZod(result.error);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe('items.0.title');
  });
});
