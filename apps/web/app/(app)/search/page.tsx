import type { Metadata } from 'next';
import { Suspense } from 'react';

import { getServerTranslator } from '../../../lib/server-i18n';
import { SearchView } from './search-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerTranslator();
  return { title: t('nav.search') };
}

export default function SearchPage() {
  // useSearchParams() needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <SearchView />
    </Suspense>
  );
}
