import { describe, expect, it } from 'vitest';

import {
  createTranslator,
  isAppLocale,
  LOCALES,
  localeDirection,
  messagesFor,
  parseAcceptLanguage,
  resolveLocale,
} from './index.js';

describe('catalog', () => {
  it('translates every key in every locale', () => {
    const keys = Object.keys(messagesFor('en'));
    for (const locale of LOCALES) {
      const messages = messagesFor(locale);
      expect(Object.keys(messages).sort()).toEqual([...keys].sort());
      for (const value of Object.values(messages)) expect(value.trim()).not.toBe('');
    }
  });

  it('keeps the same placeholders across locales', () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    const en = messagesFor('en');
    const ru = messagesFor('ru');
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(ru[key]), key).toEqual(placeholders(en[key]));
    }
  });
});

describe('createTranslator', () => {
  it('interpolates variables and leaves unknown ones visible', () => {
    const t = createTranslator('ru');
    expect(t('home.greeting', { name: 'Аня' })).toBe('Привет, Аня');
    expect(t('validation.passwordLength', { min: 10, max: 128 })).toBe('От 10 до 128 символов.');
    expect(t('home.greeting')).toBe('Привет, {name}');
  });
});

describe('locale detection', () => {
  it('prefers the explicit cookie', () => {
    expect(resolveLocale('ru', 'en-US,en;q=0.9')).toBe('ru');
  });

  it('picks the best supported browser language by quality', () => {
    expect(parseAcceptLanguage('ru-RU,ru;q=0.9,en-US;q=0.8')).toBe('ru');
    expect(parseAcceptLanguage('uk-UA,uk;q=0.9,ru;q=0.5,en;q=0.4')).toBe('ru');
    expect(parseAcceptLanguage('en;q=0.3, ru;q=0.8')).toBe('ru');
    expect(parseAcceptLanguage('ru;q=0, en')).toBe('en');
  });

  it('falls back to English', () => {
    expect(resolveLocale(undefined, 'de-DE,de;q=0.9')).toBe('en');
    expect(resolveLocale('xx', null)).toBe('en');
    expect(parseAcceptLanguage('')).toBeNull();
  });

  it('knows text direction and validates locales', () => {
    expect(localeDirection('ru')).toBe('ltr');
    expect(localeDirection('ar-EG')).toBe('rtl');
    expect(isAppLocale('en')).toBe(true);
    expect(isAppLocale('EN')).toBe(false);
  });
});
