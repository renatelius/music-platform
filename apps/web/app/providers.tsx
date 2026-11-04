'use client';

import type { AppLocale } from '@mp/i18n';
import type { ReactNode } from 'react';

import { AuthProvider } from '../lib/auth-context';
import { I18nProvider } from '../lib/i18n-context';
import { ThemeProvider } from '../lib/theme-context';

export function Providers({
  initialLocale,
  children,
}: {
  initialLocale: AppLocale;
  children: ReactNode;
}) {
  return (
    <I18nProvider initialLocale={initialLocale}>
      <ThemeProvider>
        <AuthProvider>{children}</AuthProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
