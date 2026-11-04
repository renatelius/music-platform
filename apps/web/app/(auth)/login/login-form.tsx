'use client';

import { LoginRequest } from '@mp/contracts';
import { Alert, Button, PasswordField, TextField } from '@mp/ui';
import Link from 'next/link';
import { type SubmitEvent, useState } from 'react';

import { AuthCard, linkClasses } from '../../../components/auth-card';
import { GuestOnly } from '../../../components/guards';
import { useAuth } from '../../../lib/auth-context';
import { describeDevice } from '../../../lib/device';
import { apiErrorMessage, type FieldErrors, validationErrors } from '../../../lib/form-errors';
import { useI18n } from '../../../lib/i18n-context';

export function LoginForm({ next }: { next: string | null }) {
  const { t } = useI18n();
  const { client } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = LoginRequest.safeParse({
      email,
      password,
      deviceName: describeDevice(navigator.userAgent),
    });
    if (!parsed.success) {
      setErrors(validationErrors(parsed.error, t));
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await client.login(parsed.data);
      // GuestOnly redirects once the session is set.
    } catch (error) {
      setFormError(apiErrorMessage(error, t, 'login'));
      setPending(false);
    }
  }

  return (
    <GuestOnly next={next}>
      <AuthCard
        title={t('auth.login.title')}
        subtitle={t('auth.login.subtitle')}
        footer={
          <>
            {t('auth.login.noAccount')}{' '}
            <Link href="/register" className={linkClasses}>
              {t('auth.login.toRegister')}
            </Link>
          </>
        }
      >
        <form noValidate className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          {formError !== null ? <Alert tone="error">{formError}</Alert> : null}
          <TextField
            label={t('auth.email')}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            error={errors.email}
          />
          <PasswordField
            label={t('auth.password')}
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            error={errors.password}
            showLabel={t('auth.showPassword')}
            hideLabel={t('auth.hidePassword')}
          />
          <div className="-mt-1 flex justify-end">
            <Link
              href="/forgot-password"
              className="text-sm text-fg-muted transition-colors hover:text-fg"
            >
              {t('auth.login.forgot')}
            </Link>
          </div>
          <Button type="submit" size="lg" fullWidth loading={pending}>
            {t('auth.login.submit')}
          </Button>
        </form>
      </AuthCard>
    </GuestOnly>
  );
}
