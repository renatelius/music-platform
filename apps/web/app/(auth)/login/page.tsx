import type { Metadata } from 'next';

import { getServerTranslator } from '../../../lib/server-i18n';
import { LoginForm } from './login-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerTranslator();
  return { title: t('auth.login.submit') };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const value = params.next;
  return <LoginForm next={typeof value === 'string' ? value : null} />;
}
