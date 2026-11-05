import { randomUUID } from 'node:crypto';

import { AuthResponse, ProblemDetails, SessionList, UserDto } from '@mp/contracts';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../dist/db/client.js';
import { hashToken } from '../dist/auth/tokens.js';
import { auditEvents, sessions, users } from '../dist/db/schema.js';
import { DB } from '../dist/infra/tokens.js';
import { startTestApp, type TestApp } from './helpers.js';
import { countEmails, tokenFromEmail, waitForEmail } from './mailpit.js';

interface CallOptions {
  body?: unknown;
  token?: string;
  native?: boolean;
  cookie?: string;
  headers?: Record<string, string>;
}

interface CallResult {
  status: number;
  headers: Headers;
  body: unknown;
}

const PASSWORD = 'correct horse battery staple';
const newEmail = () => `u-${randomUUID()}@example.test`;

describe('auth', () => {
  let t: TestApp;
  let db: Database;

  async function call(
    method: string,
    path: string,
    options: CallOptions = {},
  ): Promise<CallResult> {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
    if (options.native === true) headers['x-client-type'] = 'native';
    if (options.cookie !== undefined) headers.cookie = options.cookie;
    Object.assign(headers, options.headers);
    const res = await fetch(`${t.url}${path}`, {
      method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      body: text === '' ? undefined : (JSON.parse(text) as unknown),
    };
  }

  const refreshCookie = (r: CallResult) =>
    r.headers.getSetCookie().find((c) => c.startsWith('mp_refresh='));
  const cookiePair = (setCookie: string | undefined) => (setCookie ?? '').split(';')[0] ?? '';

  async function register(email = newEmail(), native = false) {
    const r = await call('POST', '/auth/register', {
      body: { email, password: PASSWORD, displayName: 'Tester', deviceName: 'Test device' },
      native,
    });
    expect(r.status).toBe(201);
    return { email, response: r, auth: AuthResponse.parse(r.body) };
  }

  beforeAll(async () => {
    t = await startTestApp();
    db = t.app.get<Database>(DB);
  });

  afterAll(async () => {
    await t.close();
  });

  it('registers, signs in immediately and returns the profile', async () => {
    const { email, response, auth } = await register();
    expect(auth.user).toMatchObject({
      email,
      displayName: 'Tester',
      locale: 'en',
      emailVerified: false,
    });
    expect(auth.refreshToken).toBeUndefined();
    expect(refreshCookie(response)).toMatch(/HttpOnly; SameSite=Strict/);
    expect(refreshCookie(response)).toContain(`Path=${t.config.auth.cookiePath};`);

    const me = await call('GET', '/me', { token: auth.accessToken });
    expect(me.status).toBe(200);
    expect(UserDto.parse(me.body).id).toBe(auth.user.id);

    const [user] = await db.select().from(users).where(eq(users.id, auth.user.id));
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('confirms the email with the emailed one-time link', async () => {
    const { email, auth } = await register();
    const token = tokenFromEmail(await waitForEmail(email, 'Confirm your email'));

    const verified = await call('POST', '/auth/email/verify', { body: { token } });
    expect(verified.status).toBe(200);
    expect(UserDto.parse(verified.body).emailVerified).toBe(true);

    const again = await call('POST', '/auth/email/verify', { body: { token } });
    expect(again.status).toBe(400);
    expect(ProblemDetails.parse(again.body).code).toBe('BAD_REQUEST');

    const me = UserDto.parse((await call('GET', '/me', { token: auth.accessToken })).body);
    expect(me.emailVerified).toBe(true);
  });

  it('rejects duplicate emails regardless of case', async () => {
    const { email } = await register();
    const dup = await call('POST', '/auth/register', {
      body: { email: email.toUpperCase(), password: PASSWORD, displayName: 'Dup' },
    });
    expect(dup.status).toBe(409);
    expect(ProblemDetails.parse(dup.body).code).toBe('CONFLICT');
  });

  it('validates input with field errors', async () => {
    const r = await call('POST', '/auth/register', {
      body: { email: 'not-an-email', password: 'short', displayName: '' },
    });
    expect(r.status).toBe(422);
    const problem = ProblemDetails.parse(r.body);
    expect(problem.errors?.map((e) => e.path).sort()).toEqual(['displayName', 'email', 'password']);
  });

  it('logs in with valid credentials and gives the same error for wrong password and unknown email', async () => {
    const { email } = await register();
    const wrong = await call('POST', '/auth/login', {
      body: { email, password: 'wrong password!' },
    });
    const unknown = await call('POST', '/auth/login', {
      body: { email: newEmail(), password: PASSWORD },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(ProblemDetails.parse(wrong.body).detail).toBe(ProblemDetails.parse(unknown.body).detail);
    expect(wrong.headers.get('www-authenticate')).toBe('Bearer');

    const ok = await call('POST', '/auth/login', {
      body: { email: `  ${email.toUpperCase()} `, password: PASSWORD },
    });
    expect(ok.status).toBe(200);
    const auth = AuthResponse.parse(ok.body);

    const events = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.userId, auth.user.id));
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining(['auth.register', 'auth.login_failed', 'auth.login']),
    );
  });

  it('rotates refresh tokens for native clients and revokes the family on reuse', async () => {
    const { auth } = await register(newEmail(), true);
    const first = auth.refreshToken;
    expect(first).toBeDefined();

    const r1 = await call('POST', '/auth/refresh', { body: { refreshToken: first }, native: true });
    expect(r1.status).toBe(200);
    const rotated = AuthResponse.parse(r1.body);
    expect(rotated.refreshToken).toBeDefined();
    expect(rotated.refreshToken).not.toBe(first);
    expect(refreshCookie(r1)).toBeUndefined();
    expect((await call('GET', '/me', { token: rotated.accessToken })).status).toBe(200);

    // Replayed right away (two tabs racing): 409, nothing is revoked.
    const race = await call('POST', '/auth/refresh', {
      body: { refreshToken: first },
      native: true,
    });
    expect(race.status).toBe(409);
    expect(ProblemDetails.parse(race.body).code).toBe('CONFLICT');
    expect((await call('GET', '/me', { token: rotated.accessToken })).status).toBe(200);

    // Replayed later (the token was copied): both it and the new one stop working.
    await db
      .update(sessions)
      .set({ revokedAt: new Date(Date.now() - 60_000) })
      .where(eq(sessions.tokenHash, hashToken(first ?? '')));
    const replay = await call('POST', '/auth/refresh', {
      body: { refreshToken: first },
      native: true,
    });
    expect(replay.status).toBe(401);
    const afterReplay = await call('POST', '/auth/refresh', {
      body: { refreshToken: rotated.refreshToken },
      native: true,
    });
    expect(afterReplay.status).toBe(401);
    expect((await call('GET', '/me', { token: rotated.accessToken })).status).toBe(401);

    const [reuse] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.userId, auth.user.id),
          eq(auditEvents.action, 'auth.refresh_reuse_detected'),
        ),
      );
    expect(reuse).toBeDefined();
  });

  it('refreshes browser sessions through the HttpOnly cookie', async () => {
    const { response } = await register();
    const cookie = cookiePair(refreshCookie(response));
    const r = await call('POST', '/auth/refresh', { cookie });
    expect(r.status).toBe(200);
    expect(AuthResponse.parse(r.body).refreshToken).toBeUndefined();
    const next = cookiePair(refreshCookie(r));
    expect(next).toMatch(/^mp_refresh=.+/);
    expect(next).not.toBe(cookie);

    expect((await call('POST', '/auth/refresh')).status).toBe(401);
  });

  it('refuses the refresh cookie in cross-site requests (CSRF)', async () => {
    const { response } = await register();
    const cookie = cookiePair(refreshCookie(response));
    const foreign = { origin: 'https://evil.example' };
    expect((await call('POST', '/auth/refresh', { cookie, headers: foreign })).status).toBe(403);
    const crossSite = { 'sec-fetch-site': 'cross-site' };
    expect((await call('POST', '/auth/logout', { cookie, headers: crossSite })).status).toBe(403);
    const own = { origin: new URL(t.config.webAppUrl).origin };
    expect((await call('POST', '/auth/refresh', { cookie, headers: own })).status).toBe(200);
  });

  it('lists sessions, revokes one and signs out everywhere', async () => {
    const { email, auth: a } = await register();
    const login = await call('POST', '/auth/login', {
      body: { email, password: PASSWORD, deviceName: 'Phone' },
    });
    const b = AuthResponse.parse(login.body);

    const list = SessionList.parse(
      (await call('GET', '/auth/sessions', { token: a.accessToken })).body,
    );
    expect(list.items).toHaveLength(2);
    expect(list.items.filter((s) => s.current)).toHaveLength(1);
    const phone = list.items.find((s) => s.deviceName === 'Phone');
    if (phone === undefined) throw new Error('Phone session not listed');

    expect(
      (await call('DELETE', `/auth/sessions/${phone.id}`, { token: a.accessToken })).status,
    ).toBe(204);
    expect((await call('GET', '/me', { token: b.accessToken })).status).toBe(401);
    expect(
      (await call('DELETE', `/auth/sessions/${phone.id}`, { token: a.accessToken })).status,
    ).toBe(404);

    expect((await call('POST', '/auth/logout-all', { token: a.accessToken })).status).toBe(204);
    expect((await call('GET', '/me', { token: a.accessToken })).status).toBe(401);
  });

  it('logs out the current session with the refresh cookie', async () => {
    const { response, auth } = await register();
    const out = await call('POST', '/auth/logout', { cookie: cookiePair(refreshCookie(response)) });
    expect(out.status).toBe(204);
    expect(refreshCookie(out)).toMatch(/Max-Age=0/);
    expect((await call('GET', '/me', { token: auth.accessToken })).status).toBe(401);
  });

  it('resets a forgotten password and signs out all sessions', async () => {
    const { email, auth } = await register();

    const unknown = await call('POST', '/auth/password/forgot', { body: { email: newEmail() } });
    expect(unknown.status).toBe(202);

    const forgot = await call('POST', '/auth/password/forgot', { body: { email } });
    expect(forgot.status).toBe(202);
    const token = tokenFromEmail(await waitForEmail(email, 'Reset your password'));

    const newPassword = 'a brand new passphrase';
    expect(
      (await call('POST', '/auth/password/reset', { body: { token, password: newPassword } }))
        .status,
    ).toBe(204);
    expect(
      (await call('POST', '/auth/password/reset', { body: { token, password: newPassword } }))
        .status,
    ).toBe(400);
    expect((await call('GET', '/me', { token: auth.accessToken })).status).toBe(401);

    expect(
      (await call('POST', '/auth/login', { body: { email, password: PASSWORD } })).status,
    ).toBe(401);
    const ok = await call('POST', '/auth/login', { body: { email, password: newPassword } });
    expect(ok.status).toBe(200);
    expect(AuthResponse.parse(ok.body).user.emailVerified).toBe(true);
  });

  it('updates the profile', async () => {
    const { auth } = await register();
    const updated = await call('PATCH', '/me', {
      token: auth.accessToken,
      body: { displayName: ' New Name ', locale: 'ru' },
    });
    expect(updated.status).toBe(200);
    expect(UserDto.parse(updated.body)).toMatchObject({ displayName: 'New Name', locale: 'ru' });
    const me = await call('GET', '/me', { token: auth.accessToken });
    expect(UserDto.parse(me.body).locale).toBe('ru');

    expect((await call('PATCH', '/me', { token: auth.accessToken, body: {} })).status).toBe(422);
    const badLocale = await call('PATCH', '/me', {
      token: auth.accessToken,
      body: { locale: 'Russian' },
    });
    expect(badLocale.status).toBe(422);
    expect((await call('PATCH', '/me', { body: { displayName: 'X' } })).status).toBe(401);
  });

  it('protects endpoints that need a session', async () => {
    expect((await call('GET', '/me')).status).toBe(401);
    expect((await call('GET', '/me', { token: 'garbage' })).status).toBe(401);
    expect((await call('GET', '/auth/sessions')).status).toBe(401);
    expect((await call('POST', '/auth/logout-all')).status).toBe(401);
  });

  it('limits verification resends', async () => {
    const { email, auth } = await register();
    await waitForEmail(email, 'Confirm your email');
    for (let i = 0; i < 3; i++) {
      expect((await call('POST', '/auth/email/resend', { token: auth.accessToken })).status).toBe(
        202,
      );
    }
    expect((await call('POST', '/auth/email/resend', { token: auth.accessToken })).status).toBe(
      429,
    );
    expect(await countEmails(email)).toBe(4);
  });
});

describe('auth brute-force protection', () => {
  it('locks an email after 10 failed sign-in attempts', async () => {
    const t = await startTestApp();
    try {
      const email = newEmail();
      const attempt = () =>
        fetch(`${t.url}/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: 'wrong password' }),
        });
      for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(ProblemDetails.parse(await blocked.json()).code).toBe('RATE_LIMITED');
    } finally {
      await t.close();
    }
  });
});
