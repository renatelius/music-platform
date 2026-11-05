import { describe, expect, it } from 'vitest';

import { MEDIA_TOKEN, MediaTokens, parseRange } from './media-token.js';

const SECRET = 'a-test-secret-that-is-long-enough-123456';
const grant = {
  key: 'tracks/019a/opus-128.webm',
  sizeBytes: 5000,
  contentType: 'audio/webm',
  expiresAt: new Date('2026-11-05T12:00:00Z'),
};

describe('MediaTokens', () => {
  const tokens = new MediaTokens(SECRET);

  it('signs and verifies a grant until it expires', () => {
    const token = tokens.sign(grant);
    expect(token).toMatch(MEDIA_TOKEN);
    expect(tokens.verify(token, new Date('2026-11-05T11:59:00Z'))).toEqual(grant);
    expect(tokens.verify(token, new Date('2026-11-05T12:00:00Z'))).toBeNull();
  });

  it('rejects tampered, foreign and malformed tokens', () => {
    const token = tokens.sign(grant);
    const now = new Date('2026-11-05T11:00:00Z');
    const [payload = '', mac = ''] = token.split('.');
    const other = Buffer.from(
      JSON.stringify({ k: 'tracks/other/aac-256.m4a', s: 5000, t: 'audio/mp4', e: 1_793_880_000 }),
    ).toString('base64url');
    expect(tokens.verify(`${other}.${mac}`, now)).toBeNull();
    const flipped = mac.endsWith('A') ? `${mac.slice(0, -1)}B` : `${mac.slice(0, -1)}A`;
    expect(tokens.verify(`${payload}.${flipped}`, now)).toBeNull();
    expect(new MediaTokens(`${SECRET}-other`).verify(token, now)).toBeNull();
    for (const bad of ['', 'abc', payload, `${payload}.${mac}.x`, 'a'.repeat(30)]) {
      expect(tokens.verify(bad, now), bad).toBeNull();
    }
  });
});

describe('parseRange', () => {
  it('parses single ranges and clamps the end', () => {
    expect(parseRange('bytes=0-99', 5000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=4990-', 5000)).toEqual({ start: 4990, end: 4999 });
    expect(parseRange('bytes=-20', 5000)).toEqual({ start: 4980, end: 4999 });
    expect(parseRange('bytes=-9000', 5000)).toEqual({ start: 0, end: 4999 });
    expect(parseRange('bytes=100-99999', 5000)).toEqual({ start: 100, end: 4999 });
  });

  it('serves the whole file when the header is absent, odd or invalid', () => {
    for (const header of [
      undefined,
      'items=0-1',
      'bytes=0-1,5-6',
      'bytes=-',
      'bytes=50-10',
      'nonsense',
    ]) {
      expect(parseRange(header, 5000), String(header)).toBeNull();
    }
  });

  it('reports ranges outside the file', () => {
    expect(parseRange('bytes=5000-', 5000)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 5000)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-10', 0)).toBe('unsatisfiable');
  });
});
