'use client';

import { Alert, Badge, Button, Card, IconCheck, IconMail, IconSparkle } from '@mp/ui';
import { useState } from 'react';

import { useAuth, useSession } from '../../lib/auth-context';
import { apiErrorMessage } from '../../lib/form-errors';
import { useI18n } from '../../lib/i18n-context';

function VerifyEmailBanner({ email }: { email: string }) {
  const { t } = useI18n();
  const { client } = useAuth();
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setStatus('sending');
    setError(null);
    try {
      await client.resendVerification();
      setStatus('sent');
    } catch (e) {
      setError(apiErrorMessage(e, t));
      setStatus('idle');
    }
  }

  return (
    <Alert
      tone="warning"
      icon={<IconMail className="size-[18px]" />}
      title={t('home.verify.title')}
      className="mt-8"
      action={
        status === 'sent' ? (
          <span className="text-sm font-medium">{t('home.verify.sent')}</span>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            loading={status === 'sending'}
            onClick={() => void resend()}
          >
            {t('home.verify.resend')}
          </Button>
        )
      }
    >
      {error ?? t('home.verify.text', { email })}
    </Alert>
  );
}

export function HomeView() {
  const { t } = useI18n();
  const { user } = useSession();
  const ready = ['home.ready.account', 'home.ready.sessions', 'home.ready.security'] as const;
  const next = ['home.next.catalog', 'home.next.player', 'home.next.library'] as const;

  return (
    <div className="animate-rise">
      <section className="relative overflow-hidden rounded-3xl bg-(--mp-brand-ink) px-7 py-10 text-white sm:px-10 sm:py-14">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="animate-float absolute -top-24 -right-16 size-80 rounded-full bg-(--mp-brand-violet) opacity-50 blur-[90px]" />
          <div className="animate-float-slow absolute -bottom-28 left-10 size-72 rounded-full bg-(--mp-brand-coral) opacity-35 blur-[90px]" />
        </div>
        <div className="relative">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            {t('home.greeting', { name: user.displayName })}
          </h1>
          <p className="mt-3 max-w-xl text-white/70 sm:text-lg">{t('home.subtitle')}</p>
        </div>
      </section>

      {user.emailVerified ? null : <VerifyEmailBanner email={user.email} />}

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold tracking-tight text-fg">{t('home.ready.title')}</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {ready.map((key) => (
              <li key={key} className="flex items-start gap-3 text-sm text-fg">
                <span className="mt-0.5 inline-flex size-5 items-center justify-center rounded-full bg-success-soft text-success">
                  <IconCheck className="size-3.5" />
                </span>
                {t(key)}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-fg">{t('home.next.title')}</h2>
            <Badge tone="accent">{t('home.next.badge')}</Badge>
          </div>
          <ul className="mt-4 flex flex-col gap-3">
            {next.map((key) => (
              <li key={key} className="flex items-start gap-3 text-sm text-fg-muted">
                <span className="mt-0.5 inline-flex size-5 items-center justify-center rounded-full bg-surface text-accent">
                  <IconSparkle className="size-3.5" />
                </span>
                {t(key)}
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
