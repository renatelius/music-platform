import type { Metadata } from 'next';

import { getServerTranslator } from '../../../../lib/server-i18n';
import { ArtistView } from './artist-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerTranslator();
  return { title: t('catalog.page.artist') };
}

export default async function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ArtistView id={id} />;
}
