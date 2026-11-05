import { describe, expect, it } from 'vitest';

import { moveLocally, moveLocallyTo, moveTarget, moveTargetTo } from './playlist-order';

const items = ['a', 'b', 'c', 'd'].map((itemId) => ({ itemId }));
const ids = (list: readonly { itemId: string }[]) => list.map((item) => item.itemId);

describe('playlist order', () => {
  it('turns one step up or down into the API "after"', () => {
    expect(moveTarget(items, 1, -1)).toBeNull();
    expect(moveTarget(items, 2, -1)).toBe('a');
    expect(moveTarget(items, 1, 1)).toBe('c');
    expect(moveTarget(items, 0, -1)).toBeUndefined();
    expect(moveTarget(items, 3, 1)).toBeUndefined();
  });

  it('reorders the local list the same way the server does', () => {
    expect(ids(moveLocally(items, 1, -1))).toEqual(['b', 'a', 'c', 'd']);
    expect(ids(moveLocally(items, 1, 1))).toEqual(['a', 'c', 'b', 'd']);
    expect(ids(moveLocally(items, 0, -1))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('moves by drag and drop to any place, with the same "after" the server applies', () => {
    expect(moveTargetTo(items, 3, 0)).toBeNull();
    expect(ids(moveLocallyTo(items, 3, 0))).toEqual(['d', 'a', 'b', 'c']);
    expect(moveTargetTo(items, 0, 3)).toBe('d');
    expect(ids(moveLocallyTo(items, 0, 3))).toEqual(['b', 'c', 'd', 'a']);
    expect(moveTargetTo(items, 0, 2)).toBe('c');
    expect(ids(moveLocallyTo(items, 0, 2))).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTargetTo(items, 2, 2)).toBeUndefined();
    expect(moveTargetTo(items, 1, 9)).toBeUndefined();
  });
});
