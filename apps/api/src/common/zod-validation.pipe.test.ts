import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApiError } from './api-error.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const pipe = new ZodValidationPipe(z.object({ email: z.email(), age: z.coerce.number().int() }));

describe('ZodValidationPipe', () => {
  it('returns parsed and coerced data', () => {
    expect(pipe.transform({ email: 'a@b.co', age: '42', extra: true })).toEqual({
      email: 'a@b.co',
      age: 42,
    });
  });

  it('throws VALIDATION_FAILED with field errors', () => {
    try {
      pipe.transform({ email: 'nope' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.code).toBe('VALIDATION_FAILED');
      expect(apiError.options.errors?.map((e) => e.path).sort()).toEqual(['age', 'email']);
    }
  });
});
