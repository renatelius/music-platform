import type { Metadata } from 'next';

import { getServerTranslator } from '../../lib/server-i18n';
import { HomeView } from './home-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerTranslator();
  return { title: t('nav.home') };
}

export default function HomePage() {
  return <HomeView />;
}
