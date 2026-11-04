'use client';

import { Alert, Button, Logo, Spinner } from '@mp/ui';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';

import { useAuth } from '../lib/auth-context';
import { useI18n } from '../lib/i18n-context';
import { safeNext } from '../lib/navigation';

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6">{children}</div>
  );
}

export function LoadingScreen() {
  const { t } = useI18n();
  return (
    <FullScreen>
      <Logo withWordmark={false} />
      <Spinner className="size-6 text-fg-muted" label={t('common.loading')} />
    </FullScreen>
  );
}

/** Renders children only for a signed-in user; otherwise sends them to sign in and back. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state, retry } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const signedOut = state.status === 'signedOut';

  useEffect(() => {
    if (signedOut)
      router.replace(pathname === '/' ? '/login' : `/login?next=${encodeURIComponent(pathname)}`);
  }, [signedOut, pathname, router]);

  if (state.status === 'signedIn') return <>{children}</>;
  if (state.status === 'unavailable') {
    return (
      <FullScreen>
        <Logo />
        <Alert tone="error" className="max-w-sm">
          {t('errors.unavailable')}
        </Alert>
        <Button variant="secondary" onClick={retry}>
          {t('common.retry')}
        </Button>
      </FullScreen>
    );
  }
  return <LoadingScreen />;
}

/** Sign-in and sign-up screens: a signed-in user goes straight to the app. */
export function GuestOnly({ children, next }: { children: ReactNode; next?: string | null }) {
  const { state } = useAuth();
  const router = useRouter();
  const signedIn = state.status === 'signedIn';

  useEffect(() => {
    if (signedIn) router.replace(safeNext(next));
  }, [signedIn, next, router]);

  if (state.status === 'loading' || signedIn) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-6 text-fg-muted" />
      </div>
    );
  }
  return <>{children}</>;
}
