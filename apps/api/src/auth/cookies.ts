import type { IncomingMessage, ServerResponse } from 'node:http';

import { REFRESH_COOKIE } from '@mp/contracts';

export function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface CookieOptions {
  secure: boolean;
  /** Path as the browser sees it, e.g. `/auth`, or `/api/auth` behind the web app proxy. */
  path: string;
}

function serialize(value: string, maxAgeSec: number, options: CookieOptions): string {
  const parts = [
    `${REFRESH_COOKIE}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${String(Math.max(0, Math.floor(maxAgeSec)))}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function setRefreshCookie(
  res: ServerResponse,
  token: string,
  expiresAt: Date,
  options: CookieOptions,
): void {
  res.setHeader('set-cookie', serialize(token, (expiresAt.getTime() - Date.now()) / 1000, options));
}

export function clearRefreshCookie(res: ServerResponse, options: CookieOptions): void {
  res.setHeader('set-cookie', serialize('', 0, options));
}
