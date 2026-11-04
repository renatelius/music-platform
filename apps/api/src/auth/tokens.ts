import { createHash, randomBytes } from 'node:crypto';

import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

/** 256-bit random token, URL-safe. Used for refresh and email tokens. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this hash is stored in the database. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface AccessTokenOptions {
  secret: string;
  issuer: string;
  audience: string;
  ttlSec: number;
}

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

const Claims = z.object({ sub: z.uuid(), sid: z.uuid() });

/** Short-lived HS256 JWT. The session it names is still checked on every request. */
export class AccessTokens {
  private readonly key: Uint8Array;

  constructor(private readonly options: AccessTokenOptions) {
    this.key = new TextEncoder().encode(options.secret);
  }

  async sign(claims: AccessClaims, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + this.options.ttlSec;
    const token = await new SignJWT({ sid: claims.sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.key);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  /** Returns null for any invalid, expired, foreign or tampered token. */
  async verify(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ['HS256'],
      });
      const claims = Claims.safeParse(payload);
      return claims.success ? { userId: claims.data.sub, sessionId: claims.data.sid } : null;
    } catch {
      return null;
    }
  }
}
