import { describe, expect, it } from 'vitest';

import { renderAuthEmail } from './templates.js';

describe('renderAuthEmail', () => {
  it('localizes by user locale with English fallback', () => {
    expect(renderAuthEmail('verify_email', 'ru', 'a@b.co', 'http://x').subject).toBe(
      'Подтвердите email · ReMusic',
    );
    expect(renderAuthEmail('reset_password', 'de', 'a@b.co', 'http://x').subject).toBe(
      'Reset your password · ReMusic',
    );
  });

  it('puts the link in text and escapes it in HTML', () => {
    const link = 'http://app.test/reset?token=a"b<c';
    const mail = renderAuthEmail('reset_password', 'en', 'a@b.co', link);
    expect(mail.text).toContain(link);
    expect(mail.html).toContain('a&#34;b&#60;c');
    expect(mail.html).not.toContain('a"b<c');
  });
});
