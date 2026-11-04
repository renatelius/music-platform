import type { PipeTransform } from '@nestjs/common';

import { fieldErrorsFromZod } from '@mp/contracts';
import type { z } from 'zod';

import { ApiError } from './api-error.js';

/** Validates a request part with a contract schema: `@Body(new ZodValidationPipe(Schema))`. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiError('VALIDATION_FAILED', { errors: fieldErrorsFromZod(result.error) });
    }
    return result.data;
  }
}
