import { describe, expect, it } from 'vitest';

import { safeNext } from './navigation';

describe('safeNext', () => {
  it('keeps same-site paths', () => {
    expect(safeNext('/account')).toBe('/account');
    expect(safeNext('/a?b=c#d')).toBe('/a?b=c#d');
  });

  it('blocks open redirects and loops', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '',
      null,
      undefined,
    ]) {
      expect(safeNext(bad)).toBe('/');
    }
    expect(safeNext('/login?next=/x')).toBe('/');
  });
});
