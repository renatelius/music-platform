import { createTranslator } from '@mp/i18n';
import { describe, expect, it } from 'vitest';

import {
  countLabel,
  coverColors,
  formatDuration,
  formatTotalDuration,
  moveActive,
  normalizeQuery,
  releaseYear,
  searchHref,
  suggestionHref,
} from './catalog';

describe('durations', () => {
  it('formats track lengths', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(215_000)).toBe('3:35');
    expect(formatDuration(59_600)).toBe('1:00');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });

  it('formats release lengths in both languages', () => {
    const en = createTranslator('en');
    const ru = createTranslator('ru');
    expect(formatTotalDuration(42 * 60_000, en)).toBe('42 min');
    expect(formatTotalDuration(65 * 60_000, ru)).toBe('1 ч 5 мин');
    expect(formatTotalDuration(10_000, en)).toBe('1 min');
    expect(formatTotalDuration(0, en)).toBe('0 min');
  });
});

describe('countLabel', () => {
  it('uses the plural rules of the language', () => {
    const ru = createTranslator('ru');
    expect(countLabel(ru, 'ru', 'tracks', 1)).toBe('1 трек');
    expect(countLabel(ru, 'ru', 'tracks', 3)).toBe('3 трека');
    expect(countLabel(ru, 'ru', 'tracks', 5)).toBe('5 треков');
    expect(countLabel(ru, 'ru', 'tracks', 21)).toBe('21 трек');
    expect(countLabel(ru, 'ru', 'artists', 74)).toBe('74 исполнителя');
    expect(countLabel(ru, 'ru', 'releases', 84)).toBe('84 релиза');
    const en = createTranslator('en');
    expect(countLabel(en, 'en', 'tracks', 1)).toBe('1 track');
    expect(countLabel(en, 'en', 'releases', 0)).toBe('0 releases');
  });
});

describe('search helpers', () => {
  it('normalizes queries like the API', () => {
    expect(normalizeQuery('  kai \n engel ')).toBe('kai engel');
    expect(normalizeQuery('a'.repeat(150))).toHaveLength(100);
    expect(searchHref('  ')).toBe('/search');
    expect(searchHref('ёлка & co')).toBe('/search?q=%D1%91%D0%BB%D0%BA%D0%B0%20%26%20co');
  });

  it('opens artists, releases and the release of a track', () => {
    const base = { title: 'x', subtitle: null };
    const id = '019a5f2e-8c1b-7a3d-9f00-0123456789ab';
    const rel = '019a5f2e-8c1b-7a3d-9f00-0123456789ac';
    expect(suggestionHref({ ...base, kind: 'artist', id, releaseId: null })).toBe(`/artist/${id}`);
    expect(suggestionHref({ ...base, kind: 'release', id, releaseId: id })).toBe(`/release/${id}`);
    expect(suggestionHref({ ...base, kind: 'track', id, releaseId: rel })).toBe(`/release/${rel}`);
  });

  it('moves the keyboard selection with wrap-around', () => {
    expect(moveActive(-1, 3, 1)).toBe(0);
    expect(moveActive(-1, 3, -1)).toBe(2);
    expect(moveActive(2, 3, 1)).toBe(0);
    expect(moveActive(0, 3, -1)).toBe(2);
    expect(moveActive(1, 0, 1)).toBe(-1);
  });
});

describe('misc', () => {
  it('gives stable cover colors and years', () => {
    expect(coverColors('abc')).toEqual(coverColors('abc'));
    expect(coverColors('abc')).not.toEqual(coverColors('abd'));
    expect(coverColors('abc').from).toMatch(/^hsl\(\d+ 62% 52%\)$/);
    expect(releaseYear('2016-04-01')).toBe('2016');
    expect(releaseYear(null)).toBeNull();
  });
});
