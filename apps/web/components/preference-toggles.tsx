'use client';

import { type AppLocale, LOCALES } from '@mp/i18n';
import { Button, IconMonitor, IconMoon, IconSun } from '@mp/ui';

import { useI18n } from '../lib/i18n-context';
import { THEME_PREFERENCES, type ThemePreference } from '../lib/theme';
import { useTheme } from '../lib/theme-context';

const THEME_ICON = { system: IconMonitor, light: IconSun, dark: IconMoon } as const;

/** Compact theme and language switches for screens without the app sidebar. */
export function PreferenceToggles() {
  const { t, locale, setLocale } = useI18n();
  const { preference, setPreference } = useTheme();
  const current: ThemePreference = preference ?? 'system';
  const nextTheme =
    THEME_PREFERENCES[(THEME_PREFERENCES.indexOf(current) + 1) % THEME_PREFERENCES.length] ??
    'system';
  const nextLocale: AppLocale = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length] ?? 'en';
  const Icon = THEME_ICON[current];

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setLocale(nextLocale);
        }}
        aria-label={t('language.toggle')}
        className="font-semibold uppercase tracking-wide"
      >
        {locale}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          setPreference(nextTheme);
        }}
        aria-label={t('theme.toggle', { name: t(`theme.${current}`) })}
        title={t(`theme.${current}`)}
      >
        <Icon className="size-[18px]" />
      </Button>
    </div>
  );
}
