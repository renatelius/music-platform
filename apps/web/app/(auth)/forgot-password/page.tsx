import type { Metadata } from 'next';

import { getServerTranslator } from '../../../lib/server-i18n';
import { ForgotPasswordForm } from './forgot-password-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerTranslator();
  return { title: t('auth.forgot.title') };
}

export default function Page() {
  return <ForgotPasswordForm />;
}
