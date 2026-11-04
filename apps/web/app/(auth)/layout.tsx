import { Logo } from '@mp/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PreferenceToggles } from '../../components/preference-toggles';
import { getServerTranslator } from '../../lib/server-i18n';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getServerTranslator();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Brand panel: always dark, cinematic. Decorative only. */}
      <aside className="relative hidden overflow-hidden bg-(--mp-brand-ink) p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="animate-float absolute -top-40 -left-32 size-[40rem] rounded-full bg-(--mp-brand-violet) opacity-45 blur-[130px]" />
          <div className="animate-float-slow absolute -right-48 -bottom-48 size-[36rem] rounded-full bg-(--mp-brand-coral) opacity-35 blur-[130px]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_40%,transparent_0%,var(--mp-brand-ink)_78%)]" />
          <svg
            className="absolute right-12 bottom-28 h-40 w-72 opacity-25"
            viewBox="0 0 288 160"
            fill="none"
          >
            {Array.from({ length: 24 }, (_, i) => {
              const h = 24 + Math.round(Math.abs(Math.sin(i * 1.7)) * 110);
              return (
                <rect key={i} x={i * 12} y={160 - h} width="6" height={h} rx="3" fill="white" />
              );
            })}
          </svg>
        </div>
        <Link href="/" className="relative w-fit">
          <Logo wordmarkClassName="text-white" />
        </Link>
        <div className="relative max-w-xl">
          <h2 className="text-5xl font-semibold leading-[1.05] tracking-tight xl:text-6xl">
            {t('app.tagline')}
          </h2>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-white/70">
            {t('app.taglineSub')}
          </p>
        </div>
        <p className="relative text-sm tracking-wide text-white/55">{t('app.platforms')}</p>
      </aside>

      <div className="flex min-h-dvh flex-col">
        <header className="flex items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" className="lg:invisible">
            <Logo />
          </Link>
          <PreferenceToggles />
        </header>
        <main className="flex flex-1 items-center justify-center px-5 pb-16 sm:px-8">
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>
    </div>
  );
}
