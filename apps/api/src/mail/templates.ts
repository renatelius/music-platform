import type { MailMessage } from './mail.service.js';

type Kind = 'verify_email' | 'reset_password';

interface Copy {
  subject: string;
  intro: string;
  action: string;
  outro: string;
}

const COPY: Record<'en' | 'ru', Record<Kind, Copy>> = {
  en: {
    verify_email: {
      subject: 'Confirm your email',
      intro: 'Welcome! Please confirm your email address to finish setting up your account.',
      action: 'Confirm email',
      outro: 'The link is valid for 24 hours. If you did not create an account, ignore this email.',
    },
    reset_password: {
      subject: 'Reset your password',
      intro: 'We received a request to reset the password for your account.',
      action: 'Choose a new password',
      outro:
        'The link is valid for 1 hour. If you did not request a reset, ignore this email: your password stays the same.',
    },
  },
  ru: {
    verify_email: {
      subject: 'Подтвердите email',
      intro: 'Добро пожаловать! Подтвердите адрес почты, чтобы завершить регистрацию.',
      action: 'Подтвердить email',
      outro: 'Ссылка действует 24 часа. Если вы не регистрировались, просто проигнорируйте письмо.',
    },
    reset_password: {
      subject: 'Сброс пароля',
      intro: 'Мы получили запрос на сброс пароля для вашего аккаунта.',
      action: 'Задать новый пароль',
      outro:
        'Ссылка действует 1 час. Если вы не запрашивали сброс, проигнорируйте письмо — пароль не изменится.',
    },
  },
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => `&#${String(ch.charCodeAt(0))};`);

export function renderAuthEmail(kind: Kind, locale: string, to: string, link: string): MailMessage {
  const copy = COPY[locale.startsWith('ru') ? 'ru' : 'en'][kind];
  const text = `${copy.intro}\n\n${copy.action}: ${link}\n\n${copy.outro}\n`;
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<p>${escapeHtml(copy.intro)}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:8px;text-decoration:none">${escapeHtml(copy.action)}</a></p>
<p style="color:#666;font-size:13px">${escapeHtml(copy.outro)}</p>
</body></html>`;
  return { to, subject: copy.subject, text, html };
}
