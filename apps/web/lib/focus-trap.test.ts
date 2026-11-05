import { describe, expect, it } from 'vitest';

import { wrapFocusIndex } from './focus-trap';

describe('wrapFocusIndex', () => {
  it('wraps at both ends', () => {
    expect(wrapFocusIndex(5, 4, false)).toBe(0);
    expect(wrapFocusIndex(5, 0, true)).toBe(4);
  });

  it('lets the browser move focus in the middle', () => {
    expect(wrapFocusIndex(5, 2, false)).toBeNull();
    expect(wrapFocusIndex(5, 2, true)).toBeNull();
    expect(wrapFocusIndex(5, 0, false)).toBeNull();
  });

  it('pulls focus back in from outside the dialog', () => {
    expect(wrapFocusIndex(3, -1, false)).toBe(0);
    expect(wrapFocusIndex(3, -1, true)).toBe(2);
  });

  it('does nothing without focusable elements', () => {
    expect(wrapFocusIndex(0, -1, false)).toBeNull();
  });
});
