import type { Metadata } from 'next';

import { getServerTranslator } from '../../../lib/server-i18n';
import { ResetPasswordForm } from './reset-password-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerTranslator();
  return { title: t('auth.reset.title') };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const value = params.token;
  return <ResetPasswordForm token={typeof value === 'string' ? value : null} />;
}
