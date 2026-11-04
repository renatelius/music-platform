import { randomUUID } from 'node:crypto';

import { ProblemDetails } from '@mp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers.js';

describe('global rate limit', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp({ RATE_LIMIT_MAX: '3', RATE_LIMIT_PREFIX: `rl-it-${randomUUID()}` });
  });

  afterAll(async () => {
    await t.close();
  });

  it('returns 429 with Retry-After once the limit is exceeded', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await fetch(`${t.url}/nope`)).status);
    expect(statuses).toEqual([404, 404, 404]);

    const blocked = await fetch(`${t.url}/nope`);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(blocked.headers.get('ratelimit-remaining')).toBe('0');
    expect(ProblemDetails.parse(await blocked.json()).code).toBe('RATE_LIMITED');
  });

  it('never limits health probes', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await fetch(`${t.url}/health/live`)).status).toBe(200);
    }
  });
});
