'use client';

import { ForgotPasswordRequest } from '@mp/contracts';
import { Alert, Button, IconMail, TextField } from '@mp/ui';
import Link from 'next/link';
import { type SubmitEvent, useState } from 'react';

import { AuthCard, linkClasses } from '../../../components/auth-card';
import { useAuth } from '../../../lib/auth-context';
import { apiErrorMessage, type FieldErrors, validationErrors } from '../../../lib/form-errors';
import { useI18n } from '../../../lib/i18n-context';

export function ForgotPasswordForm() {
  const { t } = useI18n();
  const { client } = useAuth();
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = ForgotPasswordRequest.safeParse({ email });
    if (!parsed.success) {
      setErrors(validationErrors(parsed.error, t));
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await client.forgotPassword(parsed.data.email);
      setSentTo(parsed.data.email);
    } catch (error) {
      setFormError(apiErrorMessage(error, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title={t('auth.forgot.title')}
      subtitle={sentTo === null ? t('auth.forgot.subtitle') : undefined}
      footer={
        <Link href="/login" className={linkClasses}>
          {t('common.backToSignIn')}
        </Link>
      }
    >
      {sentTo !== null ? (
        <Alert tone="success" icon={<IconMail className="size-[18px]" />}>
          {t('auth.forgot.sent', { email: sentTo })}
        </Alert>
      ) : (
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
          <Button type="submit" size="lg" fullWidth loading={pending}>
            {t('auth.forgot.submit')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
