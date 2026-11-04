import { en, type MessageKey, type Messages } from './messages/en.js';
import { ru } from './messages/ru.js';

export type { MessageKey, Messages } from './messages/en.js';

export const LOCALES = ['en', 'ru'] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = 'en';
/** Cookie that remembers the chosen UI language. */
export const LOCALE_COOKIE = 'mp_locale';

const CATALOG: Record<AppLocale, Messages> = { en, ru };
const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur']);

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Best supported locale from an Accept-Language header, or null. */
export function parseAcceptLanguage(header: string | null | undefined): AppLocale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const quality = q === undefined ? 1 : Number(q.slice(2));
      return {
        language: tag.toLowerCase().split('-')[0] ?? '',
        quality: Number.isNaN(quality) ? 0 : quality,
        index,
      };
    })
    .filter((entry) => entry.quality > 0 && entry.language !== '')
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  return ranked.map((entry) => entry.language).find(isAppLocale) ?? null;
}

/** Explicit choice (cookie) first, then the browser languages, then English. */
export function resolveLocale(
  cookieValue: string | null | undefined,
  acceptLanguage: string | null | undefined,
): AppLocale {
  if (isAppLocale(cookieValue)) return cookieValue;
  return parseAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}

export function localeDirection(locale: string): 'ltr' | 'rtl' {
  return RTL_LANGUAGES.has(locale.split('-')[0] ?? '') ? 'rtl' : 'ltr';
}

export type TranslationVars = Record<string, string | number>;
export type Translator = (key: MessageKey, vars?: TranslationVars) => string;

export function createTranslator(locale: AppLocale): Translator {
  const messages = CATALOG[locale];
  return (key, vars) => {
    const template = messages[key];
    if (vars === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = vars[name];
      return value === undefined ? match : String(value);
    });
  };
}

export function messagesFor(locale: AppLocale): Messages {
  return CATALOG[locale];
}
