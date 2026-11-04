import {
  type AppLocale,
  createTranslator,
  LOCALE_COOKIE,
  resolveLocale,
  type Translator,
} from '@mp/i18n';
import { cookies, headers } from 'next/headers';

/** Locale for server components: saved choice, then browser languages, then English. */
export async function getServerLocale(): Promise<AppLocale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerStore.get('accept-language'));
}

export async function getServerTranslator(): Promise<Translator> {
  return createTranslator(await getServerLocale());
}
