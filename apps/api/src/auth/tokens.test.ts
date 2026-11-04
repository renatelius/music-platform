import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { AccessTokens, generateOpaqueToken, hashToken } from './tokens.js';

const options = {
  secret: 'x'.repeat(48),
  issuer: 'http://api.test',
  audience: 'test',
  ttlSec: 900,
};
const claims = { userId: randomUUID(), sessionId: randomUUID() };

describe('opaque tokens', () => {
  it('are random, URL-safe and 256-bit', () => {
    const a = generateOpaqueToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateOpaqueToken()).not.toBe(a);
  });

  it('hash deterministically to hex SHA-256', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('AccessTokens', () => {
  const tokens = new AccessTokens(options);

  it('round-trips claims and reports expiry', async () => {
    const now = new Date();
    const { token, expiresAt } = await tokens.sign(claims, now);
    expect(await tokens.verify(token)).toEqual(claims);
    expect(expiresAt.getTime() - now.getTime()).toBeGreaterThan(899_000);
  });

  it('rejects expired tokens', async () => {
    const { token } = await tokens.sign(claims, new Date(Date.now() - 3_600_000));
    expect(await tokens.verify(token)).toBeNull();
  });

  it('rejects tokens signed with another secret, issuer or audience', async () => {
    for (const other of [
      { ...options, secret: 'y'.repeat(48) },
      { ...options, issuer: 'http://evil.test' },
      { ...options, audience: 'other' },
    ]) {
      const { token } = await new AccessTokens(other).sign(claims);
      expect(await tokens.verify(token)).toBeNull();
    }
  });

  it('rejects tampered and unsigned tokens', async () => {
    const { token } = await tokens.sign(claims);
    const [header, payload] = token.split('.');
    expect(await tokens.verify(`${header ?? ''}.${payload ?? ''}.`)).toBeNull();
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(await tokens.verify(`${none}.${payload ?? ''}.`)).toBeNull();
    expect(await tokens.verify('garbage')).toBeNull();
  });
});
