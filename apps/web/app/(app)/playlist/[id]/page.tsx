import type { Metadata } from 'next';

import { getServerTranslator } from '../../../../lib/server-i18n';
import { PlaylistView } from './playlist-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerTranslator();
  return { title: t('playlist.page') };
}

export default async function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlaylistView id={id} />;
}
