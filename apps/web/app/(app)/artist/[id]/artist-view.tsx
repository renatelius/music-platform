'use client';

import type { ArtistDetail } from '@mp/contracts';

import {
  Cover,
  Credits,
  ExternalLink,
  LoadState,
  ReleaseGrid,
  SectionTitle,
  TrackList,
} from '../../../../components/catalog-ui';
import { useAuth } from '../../../../lib/auth-context';
import { countLabel } from '../../../../lib/catalog';
import { useI18n } from '../../../../lib/i18n-context';
import { useApi, useDocumentTitle } from '../../../../lib/use-api';

function Artist({ artist }: { artist: ArtistDetail }) {
  const { t, locale } = useI18n();
  useDocumentTitle(artist.name);
  return (
    <div className="animate-rise">
      <header className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-end sm:text-left">
        <Cover
          id={artist.id}
          title={artist.name}
          round
          className="size-40 sm:size-48"
          letterClassName="text-6xl"
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wider text-fg-muted uppercase">
            {t('catalog.artist.label')}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight break-words text-fg sm:text-5xl">
            {artist.name}
          </h1>
          <p className="mt-3 text-sm text-fg-muted">
            {countLabel(t, locale, 'releases', artist.releaseCount)} ·{' '}
            {countLabel(t, locale, 'tracks', artist.trackCount)}
          </p>
          {artist.url !== null ? (
            <p className="mt-2 text-sm text-fg-muted">
              <ExternalLink href={artist.url}>{t('catalog.sourcePage')}</ExternalLink>
            </p>
          ) : null}
        </div>
      </header>

      <section className="mt-12">
        <SectionTitle title={t('catalog.releases.title')} />
        <ReleaseGrid releases={artist.releases} />
      </section>

      <section className="mt-12">
        <SectionTitle title={t('catalog.tracks.title')} />
        <TrackList tracks={artist.tracks} showRelease />
      </section>

      <Credits tracks={artist.tracks} />
    </div>
  );
}

export function ArtistView({ id }: { id: string }) {
  const { client } = useAuth();
  const artist = useApi(`artist:${id}`, () => client.artist(id));
  return <LoadState state={artist}>{(data) => <Artist artist={data} />}</LoadState>;
}
