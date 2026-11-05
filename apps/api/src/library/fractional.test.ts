import { describe, expect, it } from 'vitest';

import { isValidOrderKey, keyBetween, keysBetween, OrderKeyError } from './fractional.js';

/** Deterministic pseudo-random numbers (mulberry32), so a failure can be reproduced. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('fractional order keys', () => {
  it('starts in the middle and keeps appends and prepends short', () => {
    expect(keyBetween(null, null)).toBe('a0');
    expect(keyBetween('a0', null)).toBe('a1');
    expect(keyBetween('az', null)).toBe('b00');
    expect(keyBetween(null, 'a0')).toBe('Zz');
    expect(keyBetween('a0', 'a1')).toBe('a0V');
    expect(keyBetween('Zz', 'a0')).toBe('ZzV');
    let key: string | null = null;
    for (let i = 0; i < 10_000; i += 1) key = keyBetween(key, null);
    expect(key?.length).toBeLessThanOrEqual(4);
  });

  it('keeps the order through 10 000 random inserts', () => {
    const next = random(42);
    const keys: string[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      const at = Math.floor(next() * (keys.length + 1));
      const key = keyBetween(keys[at - 1] ?? null, keys[at] ?? null);
      keys.splice(at, 0, key);
    }
    for (let i = 1; i < keys.length; i += 1) {
      expect((keys[i - 1] ?? '') < (keys[i] ?? '')).toBe(true);
    }
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every(isValidOrderKey)).toBe(true);
  });

  it('survives inserting again and again at the same place', () => {
    let low = 'a0';
    const high = 'a1';
    for (let i = 0; i < 1000; i += 1) {
      const key = keyBetween(low, high);
      expect(low < key && key < high).toBe(true);
      low = key;
    }
  });

  it('spreads several keys between two others', () => {
    for (const [a, b] of [
      [null, null],
      ['a0', null],
      [null, 'a0'],
      ['a0', 'a1'],
    ] as const) {
      const keys = keysBetween(a, b, 25);
      expect(keys).toHaveLength(25);
      const all = [a, ...keys, b].filter((key) => key !== null);
      for (let i = 1; i < all.length; i += 1)
        expect((all[i - 1] ?? '') < (all[i] ?? '')).toBe(true);
    }
    expect(keysBetween('a0', 'a1', 0)).toEqual([]);
  });

  it('refuses invalid or reversed bounds', () => {
    expect(() => keyBetween('a1', 'a0')).toThrow(OrderKeyError);
    expect(() => keyBetween('a0', 'a0')).toThrow(OrderKeyError);
    expect(() => keyBetween('a00', null)).toThrow(OrderKeyError);
    expect(() => keyBetween('!!', null)).toThrow(OrderKeyError);
    expect(isValidOrderKey('a')).toBe(false);
    expect(isValidOrderKey('a0V')).toBe(true);
  });
});
