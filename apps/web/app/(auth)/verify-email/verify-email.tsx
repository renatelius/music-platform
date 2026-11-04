'use client';

import type { ApiClient } from '@mp/api-client';
import type { UserDto } from '@mp/contracts';
import { Alert, buttonClasses, IconCheck, Spinner } from '@mp/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { AuthCard } from '../../../components/auth-card';
import { useAuth } from '../../../lib/auth-context';
import { apiErrorMessage } from '../../../lib/form-errors';
import { useI18n } from '../../../lib/i18n-context';

// One request per token, even when React runs effects twice in development.
const attempts = new Map<string, Promise<UserDto>>();
function verifyOnce(client: ApiClient, token: string): Promise<UserDto> {
  let attempt = attempts.get(token);
  if (attempt === undefined) {
    attempt = client.verifyEmail(token);
    attempts.set(token, attempt);
  }
  return attempt;
}

type Status = { kind: 'pending' } | { kind: 'done' } | { kind: 'error'; message: string };

export function VerifyEmail({ token }: { token: string | null }) {
  const { t } = useI18n();
  const { client, state } = useAuth();
  const [status, setStatus] = useState<Status>(
    token === null ? { kind: 'error', message: t('errors.invalidLink') } : { kind: 'pending' },
  );

  useEffect(() => {
    if (token === null) return;
    let active = true;
    verifyOnce(client, token).then(
      () => {
        if (active) setStatus({ kind: 'done' });
      },
      (error: unknown) => {
        if (active) setStatus({ kind: 'error', message: apiErrorMessage(error, t, 'link') });
      },
    );
    return () => {
      active = false;
    };
  }, [client, token, t]);

  const continueHref = state.status === 'signedIn' ? '/' : '/login';

  return (
    <AuthCard title={t('auth.verify.title')}>
      {status.kind === 'pending' ? (
        <div className="flex items-center gap-3 text-fg-muted" role="status">
          <Spinner className="size-5" />
          {t('auth.verify.pending')}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {status.kind === 'done' ? (
            <Alert tone="success" icon={<IconCheck className="size-[18px]" />}>
              {t('auth.verify.done')}
            </Alert>
          ) : (
            <Alert tone="error">{status.message}</Alert>
          )}
          <Link href={continueHref} className={buttonClasses('primary', 'lg', 'w-full')}>
            {t('auth.verify.continue')}
          </Link>
        </div>
      )}
    </AuthCard>
  );
}
