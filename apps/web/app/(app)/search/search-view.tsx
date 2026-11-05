'use client';

import { SEARCH_LIMIT_MAX, type SearchResults } from '@mp/contracts';
import { useRouter, useSearchParams } from 'next/navigation';

import {
  ArtistGrid,
  LoadState,
  ReleaseGrid,
  SectionTitle,
  TrackList,
} from '../../../components/catalog-ui';
import { SearchBox } from '../../../components/search-box';
import { useAuth } from '../../../lib/auth-context';
import { normalizeQuery, searchHref } from '../../../lib/catalog';
import { useI18n } from '../../../lib/i18n-context';
import { useApi, useDocumentTitle } from '../../../lib/use-api';

function Results({ query, results }: { query: string; results: SearchResults }) {
  const { t } = useI18n();
  const empty =
    results.artists.length === 0 && results.releases.length === 0 && results.tracks.length === 0;
  if (empty) {
    return <p className="mt-10 text-center text-fg-muted">{t('search.noResults', { query })}</p>;
  }
  return (
    <>
      {results.artists.length > 0 ? (
        <section className="mt-10">
          <SectionTitle title={t('home.artists.title')} />
          <ArtistGrid artists={results.artists} />
        </section>
      ) : null}
      {results.releases.length > 0 ? (
        <section className="mt-10">
          <SectionTitle title={t('catalog.releases.title')} />
          <ReleaseGrid releases={results.releases} />
        </section>
      ) : null}
      {results.tracks.length > 0 ? (
        <section className="mt-10">
          <SectionTitle title={t('catalog.tracks.title')} />
          <TrackList tracks={results.tracks} showRelease />
        </section>
      ) : null}
    </>
  );
}

function SearchResultsView({ query }: { query: string }) {
  const { t } = useI18n();
  const { client } = useAuth();
  const results = useApi(`search:${query}`, () => client.search(query, SEARCH_LIMIT_MAX));
  useDocumentTitle(t('search.resultsFor', { query }));
  return (
    <>
      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-fg">
        {t('search.resultsFor', { query })}
      </h1>
      <LoadState state={results}>{(data) => <Results query={query} results={data} />}</LoadState>
    </>
  );
}

export function SearchView() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const query = normalizeQuery(params.get('q') ?? '');

  return (
    <div className="animate-rise">
      {query === '' ? (
        <h1 className="mb-6 text-3xl font-semibold tracking-tight text-fg">{t('nav.search')}</h1>
      ) : null}
      <SearchBox
        key={query}
        initialQuery={query}
        autoFocus={query === ''}
        onSubmit={(next) => {
          router.push(searchHref(next));
        }}
      />
      {query === '' ? (
        <p className="mt-6 text-fg-muted">{t('search.hint')}</p>
      ) : (
        <SearchResultsView query={query} />
      )}
    </div>
  );
}
