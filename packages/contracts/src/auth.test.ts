import { describe, expect, it } from 'vitest';

import { LoginRequest, RegisterRequest } from './auth.js';

const valid = {
  email: '  User@Example.COM ',
  password: 'correct horse battery',
  displayName: ' Ann ',
};

describe('RegisterRequest', () => {
  it('normalizes email and display name and defaults locale', () => {
    expect(RegisterRequest.parse(valid)).toEqual({
      email: 'user@example.com',
      password: 'correct horse battery',
      displayName: 'Ann',
      locale: 'en',
    });
  });

  it('enforces password length', () => {
    const result = RegisterRequest.safeParse({ ...valid, password: 'short' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['password']);
  });

  it('rejects a password equal to the email', () => {
    const result = RegisterRequest.safeParse({ ...valid, password: 'User@Example.com' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['password']);
  });

  it('validates locale tags', () => {
    expect(RegisterRequest.safeParse({ ...valid, locale: 'pt-BR' }).success).toBe(true);
    expect(RegisterRequest.safeParse({ ...valid, locale: 'Russian' }).success).toBe(false);
  });
});

describe('LoginRequest', () => {
  it('does not apply the registration password policy', () => {
    expect(LoginRequest.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });
});
