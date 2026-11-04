import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it } from 'vitest';

import { clearRefreshCookie, readCookie, setRefreshCookie } from './cookies.js';

const req = (cookie?: string) => ({ headers: { cookie } }) as unknown as IncomingMessage;

function fakeRes() {
  const headers = new Map<string, unknown>();
  const res = {
    setHeader: (k: string, v: unknown) => headers.set(k, v),
  } as unknown as ServerResponse;
  return { res, headers };
}

describe('cookies', () => {
  it('reads a named cookie among others', () => {
    expect(readCookie(req('a=1; mp_refresh=tok%2Den; b=2'), 'mp_refresh')).toBe('tok-en');
    expect(readCookie(req('a=1'), 'mp_refresh')).toBeUndefined();
    expect(readCookie(req(undefined), 'mp_refresh')).toBeUndefined();
    expect(readCookie(req('mp_refresh=%E0%A4%A'), 'mp_refresh')).toBeUndefined();
  });

  it('sets an HttpOnly, SameSite=Strict cookie scoped to /auth', () => {
    const { res, headers } = fakeRes();
    setRefreshCookie(res, 'abc', new Date(Date.now() + 60_000), { secure: true, path: '/auth' });
    const value = String(headers.get('set-cookie'));
    expect(value).toMatch(
      /^mp_refresh=abc; Path=\/auth; Max-Age=(59|60); HttpOnly; SameSite=Strict; Secure$/,
    );
  });

  it('clears the cookie', () => {
    const { res, headers } = fakeRes();
    clearRefreshCookie(res, { secure: false, path: '/api/auth' });
    expect(String(headers.get('set-cookie'))).toBe(
      'mp_refresh=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Strict',
    );
  });
});
