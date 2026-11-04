'use client';

import { PASSWORD_MIN_LENGTH, RegisterRequest } from '@mp/contracts';
import { Alert, Button, PasswordField, TextField } from '@mp/ui';
import Link from 'next/link';
import { type SubmitEvent, useState } from 'react';

import { AuthCard, linkClasses } from '../../../components/auth-card';
import { GuestOnly } from '../../../components/guards';
import { useAuth } from '../../../lib/auth-context';
import { describeDevice } from '../../../lib/device';
import { apiErrorMessage, type FieldErrors, validationErrors } from '../../../lib/form-errors';
import { useI18n } from '../../../lib/i18n-context';

export function RegisterForm() {
  const { t, locale } = useI18n();
  const { client } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = RegisterRequest.safeParse({
      displayName,
      email,
      password,
      locale,
      deviceName: describeDevice(navigator.userAgent),
    });
    if (!parsed.success) {
      setErrors(validationErrors(parsed.error, t));
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await client.register(parsed.data);
    } catch (error) {
      setFormError(apiErrorMessage(error, t, 'register'));
      setPending(false);
    }
  }

  return (
    <GuestOnly>
      <AuthCard
        title={t('auth.register.title')}
        subtitle={t('auth.register.subtitle')}
        footer={
          <>
            {t('auth.register.hasAccount')}{' '}
            <Link href="/login" className={linkClasses}>
              {t('auth.register.toLogin')}
            </Link>
          </>
        }
      >
        <form noValidate className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          {formError !== null ? <Alert tone="error">{formError}</Alert> : null}
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
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            error={errors.password}
            hint={t('auth.passwordHint', { min: PASSWORD_MIN_LENGTH })}
            showLabel={t('auth.showPassword')}
            hideLabel={t('auth.hidePassword')}
          />
          <Button type="submit" size="lg" fullWidth loading={pending} className="mt-2">
            {t('auth.register.submit')}
          </Button>
        </form>
      </AuthCard>
    </GuestOnly>
  );
}
