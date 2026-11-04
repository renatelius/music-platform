import { describe, expect, it } from 'vitest';

import { DEFAULT_ARGON2, hashPassword, needsRehash, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('produces a PHC argon2id string with the default parameters', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse batterY')).toBe(false);
  });

  it('uses a unique salt per hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('treats Unicode-equivalent passwords as equal (NFKC)', async () => {
    const hash = await hashPassword('caf\u00e9-password');
    expect(await verifyPassword(hash, 'cafe\u0301-password')).toBe(true);
  });

  it('never matches malformed hashes', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
    expect(
      await verifyPassword(
        '$argon2i$v=19$m=1,t=1,p=1$aaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbb',
        'x',
      ),
    ).toBe(false);
  });

  it('detects hashes that need an upgrade', async () => {
    const weak = await hashPassword('pw', { memoryKiB: 4096, passes: 1, parallelism: 1 });
    expect(needsRehash(weak)).toBe(true);
    expect(needsRehash(await hashPassword('pw', DEFAULT_ARGON2))).toBe(false);
    expect(needsRehash('garbage')).toBe(true);
  });
});
