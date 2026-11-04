import { describe, expect, it } from 'vitest';

import { isThemePreference, resolveTheme, themeInitScript } from './theme';

describe('theme', () => {
  it('resolves system preference from the OS', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('validates stored values', () => {
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('blue')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it('inline script is self-contained and safe to fail', () => {
    expect(themeInitScript).toContain("localStorage.getItem('mp-theme')");
    expect(themeInitScript).toContain('catch(e){}');
    expect(themeInitScript).toMatch(/^\(function\(\)\{.*\}\)\(\);$/);
    expect(themeInitScript.split('{').length).toBe(themeInitScript.split('}').length);
  });
});
