import { HealthResponse } from '@mp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers.js';

describe('health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('GET /health/live answers without checking dependencies', async () => {
    const res = await fetch(`${t.url}/health/live`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health reports every dependency as ok', async () => {
    const res = await fetch(`${t.url}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = HealthResponse.parse(await res.json());
    expect(body.status).toBe('ok');
    expect(body.checks.postgres?.status).toBe('ok');
    expect(body.checks.redis?.status).toBe('ok');
    expect(body.checks.s3?.status).toBe('ok');
    expect(body.version).toBe(t.config.version);
  });

  it('GET /health returns 503 when a critical dependency is down', async () => {
    const broken = await startTestApp({ REDIS_URL: 'redis://127.0.0.1:1/0' });
    try {
      const res = await fetch(`${broken.url}/health`);
      expect(res.status).toBe(503);
      const body = HealthResponse.parse(await res.json());
      expect(body.status).toBe('down');
      expect(body.checks.redis?.status).toBe('down');
      expect(body.checks.postgres?.status).toBe('ok');
    } finally {
      await broken.close();
    }
  });
});
