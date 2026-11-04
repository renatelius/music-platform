import { PROBLEM_CONTENT_TYPE, ProblemDetails } from '@mp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers.js';

describe('HTTP basics', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('unknown routes return RFC 9457 problem details', async () => {
    const res = await fetch(`${t.url}/does-not-exist?token=secret`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    const problem = ProblemDetails.parse(await res.json());
    expect(problem.code).toBe('NOT_FOUND');
    expect(problem.instance).toBe('/does-not-exist');
    expect(JSON.stringify(problem)).not.toContain('secret');
    expect(problem.requestId).toBe(res.headers.get('x-request-id'));
  });

  it('generates a request id, or keeps a valid incoming one', async () => {
    const generated = await fetch(`${t.url}/health/live`);
    expect(generated.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);

    const incoming = 'proxy-request-0001';
    const kept = await fetch(`${t.url}/health/live`, { headers: { 'x-request-id': incoming } });
    expect(kept.headers.get('x-request-id')).toBe(incoming);

    const replaced = await fetch(`${t.url}/health/live`, {
      headers: { 'x-request-id': 'bad id!' },
    });
    expect(replaced.headers.get('x-request-id')).not.toBe('bad id!');
  });

  it('sends security headers and hides the framework', async () => {
    const res = await fetch(`${t.url}/health/live`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('allows CORS only for configured origins', async () => {
    const allowed = await fetch(`${t.url}/health/live`, {
      headers: { origin: 'http://localhost:3000' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');

    const denied = await fetch(`${t.url}/health/live`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
});
