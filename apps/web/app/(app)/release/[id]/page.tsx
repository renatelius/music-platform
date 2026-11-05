import type { Metadata } from 'next';

import { getServerTranslator } from '../../../../lib/server-i18n';
import { ReleaseView } from './release-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerTranslator();
  return { title: t('catalog.page.release') };
}

export default async function ReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReleaseView id={id} />;
}
