'use client';

import type { SessionDto } from '@mp/contracts';
import { UpdateProfileRequest } from '@mp/contracts';
import { type AppLocale, isAppLocale, LOCALES } from '@mp/i18n';
import {
  Alert,
  Badge,
  Button,
  IconLaptop,
  IconMonitor,
  IconMoon,
  IconPhone,
  IconSun,
  SectionCard,
  SegmentedControl,
  Spinner,
  TextField,
} from '@mp/ui';
import { type SubmitEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth, useSession } from '../../../lib/auth-context';
import { describeDevice, isMobileDevice } from '../../../lib/device';
import { apiErrorMessage, type FieldErrors, validationErrors } from '../../../lib/form-errors';
import { useI18n } from '../../../lib/i18n-context';
import type { ThemePreference } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

function ProfileCard() {
  const { t, locale, setLocale } = useI18n();
  const { client } = useAuth();
  const { user } = useSession();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [language, setLanguage] = useState<AppLocale>(
    isAppLocale(user.locale) ? user.locale : locale,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent'>('idle');

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const parsed = UpdateProfileRequest.safeParse({ displayName, locale: language });
    if (!parsed.success) {
      setErrors(validationErrors(parsed.error, t));
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await client.updateProfile(parsed.data);
      if (language !== locale) setLocale(language);
      setMessage({ tone: 'success', text: t('account.profile.saved') });
    } catch (error) {
      setMessage({ tone: 'error', text: apiErrorMessage(error, t) });
    } finally {
      setPending(false);
    }
  }

  async function resendConfirmation() {
    setResend('sending');
    try {
      await client.resendVerification();
      setResend('sent');
    } catch (error) {
      setMessage({ tone: 'error', text: apiErrorMessage(error, t) });
      setResend('idle');
    }
  }

  return (
    <SectionCard title={t('account.profile.title')}>
      <form noValidate className="flex flex-col gap-5" onSubmit={(e) => void save(e)}>
        {message !== null ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">{t('account.email.label')}</span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] text-fg">{user.email}</span>
            <Badge tone={user.emailVerified ? 'success' : 'warning'}>
              {user.emailVerified ? t('account.email.verified') : t('account.email.notVerified')}
            </Badge>
            {user.emailVerified ? null : resend === 'sent' ? (
              <span className="text-sm text-fg-muted">{t('account.email.sent')}</span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                loading={resend === 'sending'}
                onClick={() => void resendConfirmation()}
              >
                {t('account.email.resend')}
              </Button>
            )}
          </div>
        </div>
        <TextField
          label={t('auth.displayName')}
          name="name"
          autoComplete="name"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
          }}
          error={errors.displayName}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">{t('language.label')}</span>
          <SegmentedControl
            label={t('language.label')}
            value={language}
            onChange={setLanguage}
            options={LOCALES.map((value) => ({ value, label: t(`language.${value}`) }))}
          />
        </div>
        <div>
          <Button type="submit" loading={pending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function AppearanceCard() {
  const { t } = useI18n();
  const { preference, setPreference } = useTheme();
  const options = [
    { value: 'system', label: t('theme.system'), icon: <IconMonitor className="size-4" /> },
    { value: 'light', label: t('theme.light'), icon: <IconSun className="size-4" /> },
    { value: 'dark', label: t('theme.dark'), icon: <IconMoon className="size-4" /> },
  ] as const;
  return (
    <SectionCard title={t('account.appearance.title')}>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">{t('theme.label')}</span>
        <SegmentedControl<ThemePreference>
          label={t('theme.label')}
          value={preference ?? 'system'}
          onChange={setPreference}
          options={options}
        />
      </div>
    </SectionCard>
  );
}

function SessionsCard() {
  const { t, locale } = useI18n();
  const { client } = useAuth();
  const [sessions, setSessions] = useState<SessionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const format = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  const load = useCallback(async () => {
    try {
      setSessions(await client.sessions());
      setError(null);
    } catch (e) {
      setError(apiErrorMessage(e, t));
    }
  }, [client, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setBusy(id);
    try {
      await client.revokeSession(id);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  return (
    <SectionCard title={t('account.sessions.title')} description={t('account.sessions.subtitle')}>
      {error !== null ? (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      ) : null}
      {sessions === null ? (
        error === null ? (
          <Spinner className="size-5 text-fg-muted" label={t('common.loading')} />
        ) : null
      ) : (
        <ul className="divide-y divide-border">
          {sessions.map((s) => {
            const name =
              s.deviceName ?? describeDevice(s.userAgent) ?? t('account.sessions.unknownDevice');
            const Icon = isMobileDevice(name) ? IconPhone : IconLaptop;
            const details = [
              s.ip,
              t('account.sessions.lastActive', { time: format.format(new Date(s.lastUsedAt)) }),
            ]
              .filter((part): part is string => part !== null)
              .join(' · ');
            return (
              <li key={s.id} className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-fg-muted">
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                    <span className="truncate">{name}</span>
                    {s.current ? (
                      <Badge tone="accent">{t('account.sessions.current')}</Badge>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-fg-muted">{details}</p>
                </div>
                {s.current ? null : (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy === s.id}
                    onClick={() => void revoke(s.id)}
                  >
                    {t('account.sessions.revoke')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function SignOutEverywhereCard() {
  const { t } = useI18n();
  const { client } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOutEverywhere() {
    setPending(true);
    setError(null);
    try {
      await client.logoutAll();
    } catch (e) {
      setError(apiErrorMessage(e, t));
      setPending(false);
    }
  }

  return (
    <SectionCard title={t('account.danger.title')} description={t('account.danger.text')}>
      {error !== null ? (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      ) : null}
      <Button variant="danger" loading={pending} onClick={() => void signOutEverywhere()}>
        {t('account.danger.action')}
      </Button>
    </SectionCard>
  );
}

export function AccountView() {
  const { t } = useI18n();
  return (
    <div className="animate-rise">
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        {t('account.title')}
      </h1>
      <p className="mt-2 text-fg-muted">{t('account.subtitle')}</p>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <ProfileCard />
        <div className="flex flex-col gap-6">
          <AppearanceCard />
          <SignOutEverywhereCard />
        </div>
        <SessionsCard />
      </div>
    </div>
  );
}
