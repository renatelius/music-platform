'use client';

import type { ReleaseDetail } from '@mp/contracts';

import {
  ArtistLinks,
  Cover,
  Credits,
  ExternalLink,
  LoadState,
  TrackList,
} from '../../../../components/catalog-ui';
import { useAuth } from '../../../../lib/auth-context';
import { countLabel, formatTotalDuration, releaseYear } from '../../../../lib/catalog';
import { useI18n } from '../../../../lib/i18n-context';
import { useApi, useDocumentTitle } from '../../../../lib/use-api';

function Release({ release }: { release: ReleaseDetail }) {
  const { t, locale } = useI18n();
  useDocumentTitle(release.title);
  const year = releaseYear(release.releaseDate);
  const meta = [
    year,
    countLabel(t, locale, 'tracks', release.trackCount),
    formatTotalDuration(release.durationMs, t),
  ].filter((part): part is string => part !== null);

  return (
    <div className="animate-rise">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <Cover
          id={release.id}
          title={release.title}
          className="size-44 sm:size-52"
          letterClassName="text-6xl"
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wider text-fg-muted uppercase">
            {t(`catalog.type.${release.type}`)}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight break-words text-fg sm:text-5xl">
            {release.title}
          </h1>
          <p className="mt-3 font-medium text-fg">
            <ArtistLinks artists={release.artists} />
          </p>
          <p className="mt-1 text-sm text-fg-muted">{meta.join(' · ')}</p>
          {release.url !== null ? (
            <p className="mt-2 text-sm text-fg-muted">
              <ExternalLink href={release.url}>{t('catalog.sourcePage')}</ExternalLink>
            </p>
          ) : null}
        </div>
      </header>

      <section className="mt-10">
        <TrackList tracks={release.tracks} numbered />
      </section>

      <Credits tracks={release.tracks} />
    </div>
  );
}

export function ReleaseView({ id }: { id: string }) {
  const { client } = useAuth();
  const release = useApi(`release:${id}`, () => client.release(id));
  return <LoadState state={release}>{(data) => <Release release={data} />}</LoadState>;
}
