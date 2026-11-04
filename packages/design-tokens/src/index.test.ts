import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  cssVariables,
  type SemanticColors,
  type ThemeName,
  themes,
  tokensCss,
} from './index.js';

const AA = 4.5;

/** Text/background pairs that must stay readable (WCAG AA for normal text). */
const PAIRS: [keyof SemanticColors, keyof SemanticColors][] = [
  ['text', 'bg'],
  ['text', 'bgElevated'],
  ['text', 'surface'],
  ['textMuted', 'bg'],
  ['textMuted', 'bgElevated'],
  ['textMuted', 'surface'],
  ['textSubtle', 'bgElevated'],
  ['textSubtle', 'surface'],
  ['accentFg', 'accent'],
  ['accent', 'bg'],
  ['accent', 'bgElevated'],
  ['danger', 'bgElevated'],
  ['danger', 'surface'],
  ['danger', 'dangerSoft'],
  ['success', 'successSoft'],
  ['warning', 'warningSoft'],
];

describe.each<ThemeName>(['light', 'dark'])('%s theme', (name) => {
  it.each(PAIRS)('%s on %s meets WCAG AA', (fg, bg) => {
    expect(contrastRatio(themes[name][fg], themes[name][bg])).toBeGreaterThanOrEqual(AA);
  });

  it('defines every semantic color as a CSS variable', () => {
    const vars = cssVariables(name);
    expect(vars['--mp-bg-elevated']).toBe(themes[name].bgElevated);
    expect(Object.keys(vars).length).toBe(Object.keys(themes[name]).length + 2);
  });
});

describe('contrastRatio', () => {
  it('matches known reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  });
});

describe('tokensCss', () => {
  const css = tokensCss();

  it('has light defaults, explicit dark and an OS fallback', () => {
    expect(css).toContain(':root {');
    expect(css).toContain(":root[data-theme='dark'] {");
    expect(css).toContain(
      "@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {",
    );
    expect(css).toContain(`--mp-bg: ${themes.light.bg};`);
    expect(css).toContain(`--mp-bg: ${themes.dark.bg};`);
    expect(css).toContain('--mp-brand-violet: #7C5CFF;');
  });

  it('produces balanced braces', () => {
    expect(css.split('{').length).toBe(css.split('}').length);
  });
});
