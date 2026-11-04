import { buttonClasses, Logo } from '@mp/ui';
import Link from 'next/link';

import { getServerTranslator } from '../lib/server-i18n';

export default async function NotFound() {
  const t = await getServerTranslator();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <p className="bg-linear-to-r from-(--mp-brand-violet-light) to-(--mp-brand-coral) bg-clip-text text-7xl font-semibold tracking-tight text-transparent">
        404
      </p>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{t('notFound.title')}</h1>
        <p className="mt-2 text-fg-muted">{t('notFound.text')}</p>
      </div>
      <Link href="/" className={buttonClasses('primary', 'md')}>
        {t('notFound.home')}
      </Link>
    </main>
  );
}
