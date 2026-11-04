import { z } from 'zod';

import { Id, IsoDateTime } from './common.js';

/** Refresh token cookie for browser clients (HttpOnly, path /auth). */
export const REFRESH_COOKIE = 'mp_refresh';
/** `X-Client-Type: native` -> refresh token is returned in the body instead of a cookie. */
export const CLIENT_TYPE_HEADER = 'x-client-type';
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Trimmed, lower-cased email. */
export const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const Password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const DisplayName = z.string().trim().min(1).max(64);

/** BCP 47 language tag subset: `en`, `ru`, `pt-BR`. */
export const Locale = z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Invalid locale');

const DeviceName = z.string().trim().min(1).max(100);

const OpaqueToken = z.string().min(20).max(256);

export const RegisterRequest = z
  .object({
    email: Email,
    password: Password,
    displayName: DisplayName,
    locale: Locale.default('en'),
    deviceName: DeviceName.optional(),
  })
  .refine((data) => data.password.trim().toLowerCase() !== data.email, {
    path: ['password'],
    message: 'Password must not be the same as the email',
  });
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z.object({
  email: Email,
  // No length policy on login: existing passwords must keep working if the policy changes.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  deviceName: DeviceName.optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/** Native clients send the token in the body; browsers rely on the cookie. */
export const RefreshRequest = z.object({ refreshToken: OpaqueToken.optional() });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const EmailTokenRequest = z.object({ token: OpaqueToken });
export type EmailTokenRequest = z.infer<typeof EmailTokenRequest>;

export const ForgotPasswordRequest = z.object({ email: Email });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;

export const ResetPasswordRequest = z.object({ token: OpaqueToken, password: Password });
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>;

export const UserDto = z.object({
  id: Id,
  email: z.string(),
  displayName: z.string(),
  locale: z.string(),
  emailVerified: z.boolean(),
  createdAt: IsoDateTime,
});
export type UserDto = z.infer<typeof UserDto>;

export const AuthResponse = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: IsoDateTime,
  /** Present only for native clients. */
  refreshToken: z.string().optional(),
  refreshTokenExpiresAt: IsoDateTime,
  user: UserDto,
});
export type AuthResponse = z.infer<typeof AuthResponse>;

export const SessionDto = z.object({
  id: Id,
  deviceName: z.string().nullable(),
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: IsoDateTime,
  lastUsedAt: IsoDateTime,
  current: z.boolean(),
});
export type SessionDto = z.infer<typeof SessionDto>;

export const SessionList = z.object({ items: z.array(SessionDto) });
export type SessionList = z.infer<typeof SessionList>;
