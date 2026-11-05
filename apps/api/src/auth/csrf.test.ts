import type { IncomingMessage } from 'node:http';

import { describe, expect, it } from 'vitest';

import { allowedOrigins, isAllowedCookieRequest } from './csrf.js';

const origins = allowedOrigins(['http://localhost:3000/', 'https://app.example', 'not a url']);
const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;

describe('allowedOrigins', () => {
  it('normalises URLs to origins and skips garbage', () => {
    expect([...origins]).toEqual(['http://localhost:3000', 'https://app.example']);
  });
});

describe('isAllowedCookieRequest', () => {
  it('accepts the web app origin', () => {
    expect(isAllowedCookieRequest(req({ origin: 'http://localhost:3000' }), origins)).toBe(true);
    expect(isAllowedCookieRequest(req({ origin: 'https://app.example' }), origins)).toBe(true);
  });

  it('refuses foreign, look-alike and opaque origins', () => {
    for (const origin of [
      'https://evil.example',
      'http://localhost:3001',
      'https://app.example.evil.example',
      'null',
    ]) {
      expect(isAllowedCookieRequest(req({ origin }), origins)).toBe(false);
    }
  });

  it('falls back to Fetch Metadata when Origin is absent', () => {
    expect(isAllowedCookieRequest(req({ 'sec-fetch-site': 'same-origin' }), origins)).toBe(true);
    expect(isAllowedCookieRequest(req({ 'sec-fetch-site': 'none' }), origins)).toBe(true);
    expect(isAllowedCookieRequest(req({ 'sec-fetch-site': 'cross-site' }), origins)).toBe(false);
    expect(isAllowedCookieRequest(req({ 'sec-fetch-site': 'same-site' }), origins)).toBe(false);
  });

  it('lets non-browser clients through: they cannot be forged into a cross-site request', () => {
    expect(isAllowedCookieRequest(req({}), origins)).toBe(true);
  });
});
