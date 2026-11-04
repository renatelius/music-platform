import '@mp/design-tokens/tokens.css';
import './globals.css';

import { brand, themes } from '@mp/design-tokens';
import { localeDirection } from '@mp/i18n';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';

import { getServerLocale, getServerTranslator } from '../lib/server-i18n';
import { themeInitScript } from '../lib/theme';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin', 'cyrillic'], variable: '--font-inter', display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerTranslator();
  return {
    title: { default: 'ReMusic', template: '%s · ReMusic' },
    description: t('meta.description'),
    applicationName: 'ReMusic',
  };
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: themes.light.bg },
    { media: '(prefers-color-scheme: dark)', color: brand.ink },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getServerLocale();
  return (
    <html
      lang={locale}
      dir={localeDirection(locale)}
      className={inter.variable}
      suppressHydrationWarning
    >
      <head>
        {/* Applies the saved theme before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers initialLocale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
