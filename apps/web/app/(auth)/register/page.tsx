import type { Metadata } from 'next';

import { getServerTranslator } from '../../../lib/server-i18n';
import { RegisterForm } from './register-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerTranslator();
  return { title: t('auth.register.submit') };
}

export default function Page() {
  return <RegisterForm />;
}
