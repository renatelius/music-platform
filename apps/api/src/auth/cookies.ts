import type { IncomingMessage, ServerResponse } from 'node:http';

import { REFRESH_COOKIE } from '@mp/contracts';

export const REFRESH_COOKIE_PATH = '/auth';

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

function serialize(value: string, maxAgeSec: number, secure: boolean): string {
  const parts = [
    `${REFRESH_COOKIE}=${encodeURIComponent(value)}`,
    `Path=${REFRESH_COOKIE_PATH}`,
    `Max-Age=${String(Math.max(0, Math.floor(maxAgeSec)))}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function setRefreshCookie(
  res: ServerResponse,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  res.setHeader('set-cookie', serialize(token, (expiresAt.getTime() - Date.now()) / 1000, secure));
}

export function clearRefreshCookie(res: ServerResponse, secure: boolean): void {
  res.setHeader('set-cookie', serialize('', 0, secure));
}
