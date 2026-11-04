import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';

import { type RateLimitResult, RedisRateLimiter } from './rate-limit.js';

// Uses the real Redis from docker compose (see test/setup-env.ts).
const redis = new Redis(process.env.REDIS_URL ?? '', { maxRetriesPerRequest: 1 });
const limiter = new RedisRateLimiter(redis, `rl-unit-${randomUUID()}`);

afterAll(async () => {
  await redis.quit();
});

describe('RedisRateLimiter', () => {
  const windowMs = 60_000;
  const start = 1_800_000_000_000; // aligned to a window boundary

  it('allows up to the limit within one window, then blocks', async () => {
    const results: RateLimitResult[] = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.hit('k1', 3, windowMs, start + 1000));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[3]?.resetMs).toBe(windowMs - 1000);
  });

  it('starts a fresh count in the next window', async () => {
    for (let i = 0; i < 3; i++) await limiter.hit('k2', 3, windowMs, start);
    expect((await limiter.hit('k2', 3, windowMs, start)).allowed).toBe(false);
    expect((await limiter.hit('k2', 3, windowMs, start + windowMs)).allowed).toBe(true);
  });

  it('keeps separate counters per key', async () => {
    for (let i = 0; i < 3; i++) await limiter.hit('k3', 3, windowMs, start);
    expect((await limiter.hit('k4', 3, windowMs, start)).allowed).toBe(true);
  });
});
