'use client';

import { PASSWORD_MIN_LENGTH, ResetPasswordRequest } from '@mp/contracts';
import { Alert, Button, buttonClasses, PasswordField } from '@mp/ui';
import Link from 'next/link';
import { type SubmitEvent, useState } from 'react';

import { AuthCard, linkClasses } from '../../../components/auth-card';
import { useAuth } from '../../../lib/auth-context';
import { apiErrorMessage, type FieldErrors, validationErrors } from '../../../lib/form-errors';
import { useI18n } from '../../../lib/i18n-context';

export function ResetPasswordForm({ token }: { token: string | null }) {
  const { t } = useI18n();
  const { client } = useAuth();
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  if (token === null) {
    return (
      <AuthCard title={t('auth.reset.title')}>
        <div className="flex flex-col gap-4">
          <Alert tone="error">{t('auth.reset.missingToken')}</Alert>
          <Link href="/forgot-password" className={buttonClasses('secondary', 'lg', 'w-full')}>
            {t('auth.reset.requestNew')}
          </Link>
        </div>
      </AuthCard>
    );
  }
  const resetToken = token;

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = ResetPasswordRequest.safeParse({ token: resetToken, password });
    if (!parsed.success) {
      setErrors(validationErrors(parsed.error, t));
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await client.resetPassword(parsed.data.token, parsed.data.password);
      setDone(true);
    } catch (error) {
      setFormError(apiErrorMessage(error, t, 'link'));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <AuthCard title={t('auth.reset.title')}>
        <div className="flex flex-col gap-4">
          <Alert tone="success">{t('auth.reset.done')}</Alert>
          <Link href="/login" className={buttonClasses('primary', 'lg', 'w-full')}>
            {t('auth.login.submit')}
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t('auth.reset.title')}
      subtitle={t('auth.reset.subtitle')}
      footer={
        <Link href="/forgot-password" className={linkClasses}>
          {t('auth.reset.requestNew')}
        </Link>
      }
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        {formError !== null ? <Alert tone="error">{formError}</Alert> : null}
        <PasswordField
          label={t('auth.newPassword')}
          name="new-password"
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
        <Button type="submit" size="lg" fullWidth loading={pending}>
          {t('auth.reset.submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
