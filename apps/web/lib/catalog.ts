import { SEARCH_QUERY_MAX_LENGTH, type Suggestion } from '@mp/contracts';
import type { AppLocale, Translator } from '@mp/i18n';

/** 215000 -> "3:35", 3725000 -> "1:02:05". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${String(minutes)}:${seconds}`;
}

/** Length of a release: "42 min", "1 h 5 min". */
export function formatTotalDuration(ms: number, t: Translator): string {
  const totalMinutes = ms <= 0 ? 0 : Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0
    ? t('duration.hoursMinutes', { hours, minutes })
    : t('duration.minutes', { minutes });
}

export function releaseYear(date: string | null): string | null {
  return date === null ? null : date.slice(0, 4);
}

export type CountKind = 'tracks' | 'releases' | 'artists';
type PluralForm = 'one' | 'few' | 'many' | 'other';

function pluralForm(locale: AppLocale, count: number): PluralForm {
  const category = new Intl.PluralRules(locale).select(count);
  return category === 'one' || category === 'few' || category === 'many' ? category : 'other';
}

/** "1 track", "3 трека", "5 треков". */
export function countLabel(t: Translator, locale: AppLocale, kind: CountKind, count: number) {
  const key = `count.${kind}.${pluralForm(locale, count)}` as const;
  return t(key, { count });
}

export function artistNames(artists: readonly { name: string }[]): string {
  return artists.map((artist) => artist.name).join(', ');
}

/** Same normalization as the API contract (whitespace collapsed, at most 100 characters). */
export function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, SEARCH_QUERY_MAX_LENGTH).trim();
}

export function searchHref(query: string): string {
  const q = normalizeQuery(query);
  return q === '' ? '/search' : `/search?q=${encodeURIComponent(q)}`;
}

export function suggestionHref(item: Suggestion): string {
  if (item.kind === 'artist') return `/artist/${item.id}`;
  return `/release/${item.releaseId ?? item.id}`;
}

/** Keyboard navigation in a list: wraps around, -1 means "nothing selected". */
export function moveActive(current: number, count: number, delta: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/** Two stable colors per id for generated covers (the test catalog has no artwork). */
export function coverColors(id: string): { from: string; to: string } {
  let hash = 2_166_136_261;
  for (const char of id) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  const value = hash >>> 0;
  const hue = value % 360;
  const shift = 30 + ((value >>> 9) % 70);
  return {
    from: `hsl(${String(hue)} 62% 52%)`,
    to: `hsl(${String((hue + shift) % 360)} 68% 34%)`,
  };
}
