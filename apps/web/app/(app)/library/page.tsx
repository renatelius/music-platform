import type { Metadata } from 'next';

import { getServerTranslator } from '../../../lib/server-i18n';
import { LibraryView, type LibraryTab } from './library-view';

const TABS: readonly LibraryTab[] = ['tracks', 'playlists', 'releases', 'artists'];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerTranslator();
  return { title: t('library.page') };
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;
  const initial = TABS.find((value) => value === tab) ?? 'tracks';
  return <LibraryView initialTab={initial} />;
}
