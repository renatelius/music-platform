import type { Metadata } from 'next';

import { getServerTranslator } from '../../../lib/server-i18n';
import { AccountView } from './account-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerTranslator();
  return { title: t('account.title') };
}

export default function AccountPage() {
  return <AccountView />;
}
