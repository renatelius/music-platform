'use client';

import type { CatalogHome } from '@mp/contracts';
import { Alert, Button, Card, IconDisc, IconMail } from '@mp/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  ArtistGrid,
  LoadState,
  ReleaseGrid,
  SectionTitle,
  TrackList,
} from '../../components/catalog-ui';
import { SearchBox } from '../../components/search-box';
import { useAuth, useSession } from '../../lib/auth-context';
import { countLabel, searchHref } from '../../lib/catalog';
import { apiErrorMessage } from '../../lib/form-errors';
import { useI18n } from '../../lib/i18n-context';
import { useApi } from '../../lib/use-api';

function VerifyEmailBanner({ email }: { email: string }) {
  const { t } = useI18n();
  const { client } = useAuth();
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setStatus('sending');
    setError(null);
    try {
      await client.resendVerification();
      setStatus('sent');
    } catch (e) {
      setError(apiErrorMessage(e, t));
      setStatus('idle');
    }
  }

  return (
    <Alert
      tone="warning"
      icon={<IconMail className="size-[18px]" />}
      title={t('home.verify.title')}
      className="mt-6"
      action={
        status === 'sent' ? (
          <span className="text-sm font-medium">{t('home.verify.sent')}</span>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            loading={status === 'sending'}
            onClick={() => void resend()}
          >
            {t('home.verify.resend')}
          </Button>
        )
      }
    >
      {error ?? t('home.verify.text', { email })}
    </Alert>
  );
}

function CatalogSections({ home }: { home: CatalogHome }) {
  const { t } = useI18n();
  if (home.stats.tracks === 0) {
    return (
      <Card className="mt-10 flex flex-col items-center gap-3 py-12 text-center">
        <IconDisc className="size-8 text-fg-muted" />
        <h2 className="text-lg font-semibold tracking-tight text-fg">{t('home.empty.title')}</h2>
        <p className="max-w-md text-sm text-fg-muted">{t('home.empty.text')}</p>
      </Card>
    );
  }
  return (
    <>
      <section className="mt-12">
        <SectionTitle title={t('home.recent.title')} />
        <ReleaseGrid releases={home.recentReleases} />
      </section>
      <section className="mt-12">
        <SectionTitle title={t('home.daily.title')} subtitle={t('home.daily.subtitle')} />
        <TrackList tracks={home.dailyTracks} showRelease />
      </section>
      <section className="mt-12">
        <SectionTitle title={t('home.artists.title')} />
        <ArtistGrid artists={home.artists} />
      </section>
    </>
  );
}

export function HomeView() {
  const { t, locale } = useI18n();
  const { user } = useSession();
  const { client } = useAuth();
  const router = useRouter();
  const home = useApi('home', () => client.catalogHome());
  const stats = home.status === 'ready' ? home.data.stats : null;

  return (
    <div className="animate-rise">
      <section className="relative overflow-hidden rounded-3xl bg-(--mp-brand-ink) px-7 py-10 text-white sm:px-10 sm:py-14">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="animate-float absolute -top-24 -right-16 size-80 rounded-full bg-(--mp-brand-violet) opacity-50 blur-[90px]" />
          <div className="animate-float-slow absolute -bottom-28 left-10 size-72 rounded-full bg-(--mp-brand-coral) opacity-35 blur-[90px]" />
        </div>
        <div className="relative">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            {t('home.greeting', { name: user.displayName })}
          </h1>
          <p className="mt-3 max-w-xl text-white/70 sm:text-lg">{t('home.subtitle')}</p>
          {stats !== null && stats.tracks > 0 ? (
            <p className="mt-4 text-sm font-medium text-white/80">
              {[
                countLabel(t, locale, 'tracks', stats.tracks),
                countLabel(t, locale, 'releases', stats.releases),
                countLabel(t, locale, 'artists', stats.artists),
              ].join(' · ')}
            </p>
          ) : null}
        </div>
      </section>

      {user.emailVerified ? null : <VerifyEmailBanner email={user.email} />}

      <div className="mt-6">
        <SearchBox
          onSubmit={(query) => {
            router.push(searchHref(query));
          }}
        />
      </div>

      <LoadState state={home}>{(data) => <CatalogSections home={data} />}</LoadState>
    </div>
  );
}
