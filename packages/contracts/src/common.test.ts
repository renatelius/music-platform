import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { Id, PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX, pageOf, PageQuery } from './common.js';

describe('PageQuery', () => {
  it('applies the default limit', () => {
    expect(PageQuery.parse({}).limit).toBe(PAGE_LIMIT_DEFAULT);
  });

  it('coerces query-string limits', () => {
    expect(PageQuery.parse({ limit: '50' }).limit).toBe(50);
  });

  it('rejects limits above the maximum', () => {
    expect(PageQuery.safeParse({ limit: PAGE_LIMIT_MAX + 1 }).success).toBe(false);
  });
});

describe('Id', () => {
  it('accepts UUID v7 and rejects garbage', () => {
    expect(Id.safeParse('0193f2a4-7b1e-7cc2-9a40-3f6d2b9e8a11').success).toBe(true);
    expect(Id.safeParse('not-an-id').success).toBe(false);
  });
});

describe('pageOf', () => {
  it('validates page envelopes', () => {
    const schema = pageOf(z.object({ id: Id }));
    expect(schema.safeParse({ items: [], nextCursor: null }).success).toBe(true);
    expect(schema.safeParse({ items: [{ id: 'x' }], nextCursor: null }).success).toBe(false);
  });
});
