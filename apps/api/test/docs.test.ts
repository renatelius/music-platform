import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OPERATIONS } from '../dist/docs/openapi.js';
import { startTestApp, type TestApp } from './helpers.js';

interface OpenApiDocument {
  openapi: string;
  info: { version: string };
  paths: Record<string, Record<string, { parameters?: { name: string; required: boolean }[] }>>;
}

describe('API docs', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('serves an OpenAPI 3.1 document with every operation', async () => {
    const res = await fetch(`${t.url}/openapi.json`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as OpenApiDocument;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe(t.config.version);
    for (const op of OPERATIONS) {
      expect(doc.paths[op.path]?.[op.method], `${op.method} ${op.path}`).toBeDefined();
    }
    for (const path of ['/auth/login', '/me', '/catalog/home', '/catalog/releases/{id}']) {
      expect(Object.keys(doc.paths)).toContain(path);
    }
    const params = doc.paths['/catalog/search']?.get?.parameters ?? [];
    expect(params).toContainEqual(expect.objectContaining({ name: 'q', required: true }));
    expect(params).toContainEqual(expect.objectContaining({ name: 'limit', required: false }));
  });

  it('documents only routes that exist', async () => {
    // Unauthenticated requests without a body: 401 / 422 / 2xx prove the route exists, 404 not.
    const missing: string[] = [];
    for (const op of OPERATIONS) {
      const path = op.path.replace('{id}', '00000000-0000-7000-8000-000000000000');
      const res = await fetch(`${t.url}${path}`, { method: op.method.toUpperCase() });
      if (res.status === 404) missing.push(`${op.method} ${op.path}`);
    }
    expect(missing).toEqual([]);
  });

  it('serves a self-contained HTML page with a strict CSP', async () => {
    const res = await fetch(`${t.url}/docs`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain('/catalog/search');
    expect(html).not.toContain('<script');
  });

  it('is off when API_DOCS=false', async () => {
    const off = await startTestApp({ API_DOCS: 'false' });
    try {
      expect((await fetch(`${off.url}/openapi.json`)).status).toBe(404);
      expect((await fetch(`${off.url}/docs`)).status).toBe(404);
    } finally {
      await off.close();
    }
  });
});
