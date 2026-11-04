import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ApiError } from './api-error.js';
import { toProblem } from './problem-mapping.js';

const context = { requestId: 'req-12345678', instance: '/x' };

describe('toProblem', () => {
  it('renders ApiError with its code and field errors', () => {
    const problem = toProblem(
      new ApiError('VALIDATION_FAILED', { errors: [{ path: 'email', message: 'Invalid email' }] }),
      context,
    );
    expect(problem).toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
      requestId: 'req-12345678',
      instance: '/x',
      errors: [{ path: 'email', message: 'Invalid email' }],
    });
  });

  it('maps Nest HTTP exceptions by status', () => {
    expect(toProblem(new NotFoundException('Cannot GET /x'), context)).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Cannot GET /x',
    });
    expect(toProblem(new NotFoundException('Cannot GET /x?token=secret'), context).detail).toBe(
      'Cannot GET /x',
    );
    expect(toProblem(new BadRequestException('Unexpected token'), context)).toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
    });
  });

  it('hides details of server errors', () => {
    const problem = toProblem(new HttpException('db password is wrong', 502), context);
    expect(problem).toMatchObject({ status: 500, code: 'INTERNAL' });
    expect(problem.detail).toBeUndefined();
    expect(toProblem(new Error('boom'), context)).not.toHaveProperty('detail');
  });
});
