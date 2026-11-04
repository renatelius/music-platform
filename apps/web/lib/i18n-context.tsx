'use client';

import {
  type AppLocale,
  createTranslator,
  LOCALE_COOKIE,
  localeDirection,
  type Translator,
} from '@mp/i18n';
import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

interface I18nContextValue {
  locale: AppLocale;
  t: Translator;
  setLocale: (locale: AppLocale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);
const ONE_YEAR_SEC = 365 * 24 * 60 * 60;

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: AppLocale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState(initialLocale);
  const router = useRouter();

  const setLocale = useCallback(
    (next: AppLocale) => {
      document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${String(ONE_YEAR_SEC)}; SameSite=Lax`;
      document.documentElement.lang = next;
      document.documentElement.dir = localeDirection(next);
      setLocaleState(next);
      // Server components (page titles, layouts) re-render in the new language.
      router.refresh();
    },
    [router],
  );

  const value = useMemo(
    () => ({ locale, t: createTranslator(locale), setLocale }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (value === null) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
