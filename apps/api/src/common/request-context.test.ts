import { describe, expect, it } from 'vitest';

import { isValidRequestId, pathOnly } from './request-context.js';

describe('isValidRequestId', () => {
  it('accepts UUIDs and typical proxy ids', () => {
    expect(isValidRequestId('0193f2a4-7b1e-7cc2-9a40-3f6d2b9e8a11')).toBe(true);
    expect(isValidRequestId('req_abc.123:XYZ')).toBe(true);
  });

  it('rejects short, long, non-string and injection-like values', () => {
    expect(isValidRequestId('short')).toBe(false);
    expect(isValidRequestId('x'.repeat(129))).toBe(false);
    expect(isValidRequestId(['a', 'b'])).toBe(false);
    expect(isValidRequestId('abc\r\nset-cookie: x')).toBe(false);
  });
});

describe('pathOnly', () => {
  it('drops the query string', () => {
    expect(pathOnly('/auth/reset?token=secret')).toBe('/auth/reset');
    expect(pathOnly(undefined)).toBe('/');
  });
});
