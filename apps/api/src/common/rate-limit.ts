import type { IncomingMessage, ServerResponse } from 'node:http';

import type { LoggerService } from '@nestjs/common';

import { createProblem } from '@mp/contracts';
import type { Redis } from 'ioredis';

import type { RateLimitConfig } from '../config/env.js';
import { writeProblem } from './problem-response.js';
import {
  clientIp,
  getRequestId,
  type HttpRequest,
  type NextFn,
  pathOnly,
} from './request-context.js';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Milliseconds until the current window resets. */
  resetMs: number;
}

/** Fixed-window counter in Redis. Shared by all API instances. */
export class RedisRateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  async hit(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): Promise<RateLimitResult> {
    const windowIndex = Math.floor(now / windowMs);
    const redisKey = `${this.prefix}:${key}:${String(windowIndex)}`;
    const results = await this.redis.multi().incr(redisKey).pexpire(redisKey, windowMs).exec();
    const count = results?.[0]?.[1];
    if (typeof count !== 'number') throw new Error('Unexpected Redis reply for INCR');
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetMs: (windowIndex + 1) * windowMs - now,
    };
  }
}

const UNLIMITED_PREFIXES = ['/health'];

/**
 * Global per-IP limit. Fails open: if Redis is unavailable the request is served
 * (availability first); stricter per-route limits for auth fail closed (I2b).
 */
export function rateLimitMiddleware(
  limiter: RedisRateLimiter,
  config: RateLimitConfig,
  logger: LoggerService,
) {
  return (req: IncomingMessage, res: ServerResponse, next: NextFn): void => {
    const request = req as HttpRequest;
    const path = pathOnly(request.originalUrl ?? request.url);
    if (UNLIMITED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      next();
      return;
    }
    void limiter
      .hit(`ip:${clientIp(request)}`, config.max, config.windowMs)
      .then(
        (result) => {
          const resetSec = Math.ceil(result.resetMs / 1000);
          res.setHeader('ratelimit-limit', String(result.limit));
          res.setHeader('ratelimit-remaining', String(result.remaining));
          res.setHeader('ratelimit-reset', String(resetSec));
          if (result.allowed) {
            next();
            return;
          }
          res.setHeader('retry-after', String(resetSec));
          writeProblem(
            res,
            createProblem('RATE_LIMITED', { requestId: getRequestId(req), instance: path }),
          );
        },
        (error: unknown) => {
          logger.warn(
            `Rate limiter unavailable, request allowed: ${error instanceof Error ? error.message : 'unknown'}`,
          );
          next();
        },
      )
      .catch(next);
  };
}
