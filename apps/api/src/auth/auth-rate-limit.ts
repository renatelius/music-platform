import { Inject, Injectable } from '@nestjs/common';

import { ApiError } from '../common/api-error.js';
import type { RedisRateLimiter } from '../common/rate-limit.js';
import { RATE_LIMITER } from '../infra/tokens.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const AUTH_LIMITS = {
  register: { limit: 20, windowMs: HOUR },
  loginIp: { limit: 50, windowMs: 15 * MINUTE },
  loginEmail: { limit: 10, windowMs: 15 * MINUTE },
  refreshIp: { limit: 120, windowMs: 15 * MINUTE },
  tokenIp: { limit: 30, windowMs: 15 * MINUTE },
  forgotIp: { limit: 20, windowMs: HOUR },
  forgotEmail: { limit: 3, windowMs: HOUR },
  resendVerification: { limit: 3, windowMs: HOUR },
} as const;

export type AuthLimit = keyof typeof AUTH_LIMITS;

/** Strict per-action limits. Fails CLOSED: if Redis is down, auth actions are refused. */
@Injectable()
export class AuthRateLimiter {
  constructor(@Inject(RATE_LIMITER) private readonly limiter: RedisRateLimiter) {}

  async consume(rule: AuthLimit, key: string): Promise<void> {
    const { limit, windowMs } = AUTH_LIMITS[rule];
    let result;
    try {
      result = await this.limiter.hit(`auth:${rule}:${key}`, limit, windowMs);
    } catch {
      throw new ApiError('SERVICE_UNAVAILABLE', { detail: 'Please try again in a moment.' });
    }
    if (!result.allowed) {
      throw new ApiError('RATE_LIMITED', {
        detail: 'Too many attempts. Please try again later.',
        headers: { 'retry-after': String(Math.ceil(result.resetMs / 1000)) },
      });
    }
  }
}
