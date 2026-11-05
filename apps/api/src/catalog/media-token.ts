import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

/** What a signed media link grants: one object in the media bucket until it expires. */
export interface MediaGrant {
  readonly key: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly expiresAt: Date;
}

/** `<payload>.<mac>`, both base64url; the MAC is a SHA-256 HMAC (43 characters). */
export const MEDIA_TOKEN = /^[A-Za-z0-9_-]{16,2048}\.[A-Za-z0-9_-]{43}$/;

const Payload = z.object({
  k: z.string().min(1).max(1024),
  s: z.number().int().nonnegative(),
  t: z.string().min(1).max(100),
  e: z.number().int().positive(),
});

/**
 * Signed, expiring links to media files (ADR-019). The browser's <audio> cannot send an
 * Authorization header, so the link itself is the permission: it is issued only to a signed-in
 * user for a playable track and names exactly one object. The key is derived from the JWT secret
 * (HKDF with its own label), so no extra secret is needed and the two keys never coincide.
 */
export class MediaTokens {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(hkdfSync('sha256', secret, 'remusic', 'media-url-v1', 32));
  }

  sign(grant: MediaGrant): string {
    const payload = Buffer.from(
      JSON.stringify({
        k: grant.key,
        s: grant.sizeBytes,
        t: grant.contentType,
        e: Math.floor(grant.expiresAt.getTime() / 1000),
      }),
    ).toString('base64url');
    return `${payload}.${this.mac(payload)}`;
  }

  /** Null for a malformed, tampered or expired token. */
  verify(token: string, now = new Date()): MediaGrant | null {
    if (!MEDIA_TOKEN.test(token)) return null;
    const [payload = '', mac = ''] = token.split('.');
    const expected = Buffer.from(this.mac(payload));
    const actual = Buffer.from(mac);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    const parsed = Payload.safeParse(raw);
    if (!parsed.success) return null;
    const expiresAt = new Date(parsed.data.e * 1000);
    if (expiresAt.getTime() <= now.getTime()) return null;
    return {
      key: parsed.data.k,
      sizeBytes: parsed.data.s,
      contentType: parsed.data.t,
      expiresAt,
    };
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}

/** Inclusive byte range. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/**
 * RFC 9110 single byte range. `null`: serve the whole file (no header, another unit, several
 * ranges or an invalid one, which the RFC says to ignore); `'unsatisfiable'`: answer 416.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | 'unsatisfiable' | null {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return null;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return null;
  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return 'unsatisfiable';
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (end < start) return null;
  return { start, end };
}
