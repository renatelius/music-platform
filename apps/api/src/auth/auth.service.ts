import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
  SessionDto,
  UserDto,
} from '@mp/contracts';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { AuditService, type AuditContext } from '../audit/audit.service.js';
import { ApiError } from '../common/api-error.js';
import { isUniqueViolation } from '../common/pg-errors.js';
import type { AppConfig } from '../config/env.js';
import type { Database } from '../db/client.js';
import { emailTokens, sessions, users } from '../db/schema.js';
import { APP_CONFIG, DB } from '../infra/tokens.js';
import { MailService } from '../mail/mail.service.js';
import { renderAuthEmail } from '../mail/templates.js';
import { hashPassword, needsRehash, verifyAgainstDummy, verifyPassword } from './password.js';
import { AccessTokens, generateOpaqueToken, hashToken } from './tokens.js';

export type UserRow = typeof users.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;
type EmailTokenPurpose = (typeof emailTokens.$inferSelect)['purpose'];

export interface RequestMeta extends AuditContext {
  deviceName?: string | undefined;
}

export interface AuthContext {
  userId: string;
  sessionId: string;
  familyId: string;
}

export interface IssuedAuth {
  user: UserRow;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

const INVALID_CREDENTIALS = 'Invalid email or password.';
const INVALID_LINK = 'The link is invalid or has expired.';
const unauthenticated = (detail?: string) =>
  new ApiError('UNAUTHENTICATED', {
    ...(detail !== undefined ? { detail } : {}),
    headers: { 'www-authenticate': 'Bearer' },
  });

export function toUserDto(user: UserRow): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    locale: user.locale,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AccessTokens) private readonly accessTokens: AccessTokens,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  // ---------------------------------------------------------------- sign-up / sign-in

  async register(input: RegisterRequest, meta: RequestMeta): Promise<IssuedAuth> {
    const passwordHash = await hashPassword(input.password);
    let user: UserRow | undefined;
    try {
      [user] = await this.db
        .insert(users)
        .values({
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          locale: input.locale,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError('CONFLICT', { detail: 'An account with this email already exists.' });
      }
      throw error;
    }
    if (user === undefined) throw new Error('User insert returned no row');
    const issued = await this.startSession(user, meta);
    await this.audit.record('auth.register', meta, user.id);
    await this.sendEmailLink(user, 'verify_email');
    return issued;
  }

  async login(input: LoginRequest, meta: RequestMeta): Promise<IssuedAuth> {
    const [user] = await this.db.select().from(users).where(eq(users.email, input.email)).limit(1);
    let valid = false;
    if (user?.passwordHash != null) {
      valid = await verifyPassword(user.passwordHash, input.password);
    } else {
      await verifyAgainstDummy(input.password);
    }
    if (user === undefined || !valid || user.status !== 'active') {
      await this.audit.record('auth.login_failed', meta, user?.id ?? null, {
        reason: user === undefined ? 'unknown_email' : valid ? 'inactive' : 'bad_password',
      });
      throw unauthenticated(INVALID_CREDENTIALS);
    }
    if (user.passwordHash !== null && needsRehash(user.passwordHash)) {
      const upgraded = await hashPassword(input.password);
      await this.db.update(users).set({ passwordHash: upgraded }).where(eq(users.id, user.id));
    }
    const issued = await this.startSession(user, meta);
    await this.audit.record('auth.login', meta, user.id);
    return issued;
  }

  // ---------------------------------------------------------------- tokens

  /**
   * Refresh-token rotation. Every refresh issues a new token in the same family and revokes the old
   * one. Presenting an already-rotated token means it was copied: the whole family is revoked.
   */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<IssuedAuth> {
    const now = new Date();
    const outcome = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, hashToken(refreshToken)))
        .for('update');
      if (current === undefined) return { kind: 'invalid' as const };
      if (current.revokedAt !== null) {
        await tx
          .update(sessions)
          .set({ revokedAt: now })
          .where(and(eq(sessions.familyId, current.familyId), isNull(sessions.revokedAt)));
        return { kind: 'reuse' as const, session: current };
      }
      if (current.expiresAt <= now) return { kind: 'invalid' as const };
      const [user] = await tx.select().from(users).where(eq(users.id, current.userId)).limit(1);
      if (user?.status !== 'active') return { kind: 'invalid' as const };

      const next = await this.insertSession(tx, user.id, current.familyId, {
        ...meta,
        deviceName: current.deviceName ?? undefined,
      });
      await tx
        .update(sessions)
        .set({ revokedAt: now, replacedById: next.row.id })
        .where(eq(sessions.id, current.id));
      return { kind: 'ok' as const, user, next };
    });

    if (outcome.kind === 'reuse') {
      await this.audit.record('auth.refresh_reuse_detected', meta, outcome.session.userId, {
        familyId: outcome.session.familyId,
      });
      this.logger.warn(`Refresh token reuse detected, session family revoked`);
      throw unauthenticated('Session has been revoked. Please sign in again.');
    }
    if (outcome.kind === 'invalid') throw unauthenticated('Session is invalid or expired.');
    return this.withAccessToken(outcome.user, outcome.next.row, outcome.next.refreshToken);
  }

  /** Resolves a bearer token to an active session, or null. */
  async authenticate(accessToken: string): Promise<AuthContext | null> {
    const claims = await this.accessTokens.verify(accessToken);
    if (claims === null) return null;
    const [row] = await this.db
      .select({ familyId: sessions.familyId })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.id, claims.sessionId),
          eq(sessions.userId, claims.userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          eq(users.status, 'active'),
        ),
      )
      .limit(1);
    return row === undefined ? null : { ...claims, familyId: row.familyId };
  }

  // ---------------------------------------------------------------- sessions

  /** Sign out using whatever the client still has: a refresh token or a valid access token. */
  async logout(
    refreshToken: string | undefined,
    accessToken: string | undefined,
    meta: RequestMeta,
  ): Promise<void> {
    let target: { userId: string; familyId: string } | undefined;
    if (refreshToken !== undefined) {
      const [row] = await this.db
        .select({ userId: sessions.userId, familyId: sessions.familyId })
        .from(sessions)
        .where(eq(sessions.tokenHash, hashToken(refreshToken)))
        .limit(1);
      target = row;
    }
    if (target === undefined && accessToken !== undefined) {
      target = (await this.authenticate(accessToken)) ?? undefined;
    }
    if (target === undefined) return;
    await this.revokeFamily(target.familyId);
    await this.audit.record('auth.logout', meta, target.userId);
  }

  async logoutAll(auth: AuthContext, meta: RequestMeta): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, auth.userId), isNull(sessions.revokedAt)));
    await this.audit.record('auth.logout_all', meta, auth.userId);
  }

  async listSessions(auth: AuthContext): Promise<SessionDto[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, auth.userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .orderBy(sessions.lastUsedAt);
    return rows.reverse().map((row) => ({
      id: row.id,
      deviceName: row.deviceName,
      userAgent: row.userAgent,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      current: row.familyId === auth.familyId,
    }));
  }

  async revokeSession(auth: AuthContext, sessionId: string, meta: RequestMeta): Promise<void> {
    const [row] = await this.db
      .select({ familyId: sessions.familyId })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(sessions.userId, auth.userId),
          isNull(sessions.revokedAt),
        ),
      )
      .limit(1);
    if (row === undefined) throw new ApiError('NOT_FOUND', { detail: 'Session not found.' });
    await this.revokeFamily(row.familyId);
    await this.audit.record('auth.session_revoked', meta, auth.userId, { sessionId });
  }

  // ---------------------------------------------------------------- email & password

  async getUser(userId: string): Promise<UserRow> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (user === undefined) throw unauthenticated();
    return user;
  }

  async resendVerification(auth: AuthContext): Promise<void> {
    const user = await this.getUser(auth.userId);
    if (user.emailVerifiedAt === null) await this.sendEmailLink(user, 'verify_email');
  }

  async verifyEmail(token: string, meta: RequestMeta): Promise<UserRow> {
    const userId = await this.consumeEmailToken(token, 'verify_email');
    const [user] = await this.db
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (user === undefined) throw new ApiError('BAD_REQUEST', { detail: INVALID_LINK });
    await this.audit.record('auth.email_verified', meta, user.id);
    return user;
  }

  /** Same response whether or not the email exists (no account enumeration). */
  async forgotPassword(input: ForgotPasswordRequest, meta: RequestMeta): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (user?.status !== 'active') return;
    await this.sendEmailLink(user, 'reset_password');
    await this.audit.record('auth.password_reset_requested', meta, user.id);
  }

  /** Sets a new password, confirms the email (the link proved ownership) and signs out everywhere. */
  async resetPassword(input: ResetPasswordRequest, meta: RequestMeta): Promise<void> {
    const userId = await this.consumeEmailToken(input.token, 'reset_password');
    const passwordHash = await hashPassword(input.password);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
      if (user === undefined) throw new ApiError('BAD_REQUEST', { detail: INVALID_LINK });
      await tx
        .update(users)
        .set({ passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? now })
        .where(eq(users.id, userId));
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    });
    await this.audit.record('auth.password_reset', meta, userId);
  }

  // ---------------------------------------------------------------- internals

  private async startSession(user: UserRow, meta: RequestMeta): Promise<IssuedAuth> {
    const { row, refreshToken } = await this.insertSession(this.db, user.id, randomUUID(), meta);
    return this.withAccessToken(user, row, refreshToken);
  }

  private async insertSession(
    executor: Pick<Database, 'insert'>,
    userId: string,
    familyId: string,
    meta: RequestMeta,
  ): Promise<{ row: SessionRow; refreshToken: string }> {
    const refreshToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + this.config.auth.refreshTtlDays * 86_400_000);
    const [row] = await executor
      .insert(sessions)
      .values({
        userId,
        familyId,
        tokenHash: hashToken(refreshToken),
        deviceName: meta.deviceName ?? null,
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt,
      })
      .returning();
    if (row === undefined) throw new Error('Session insert returned no row');
    return { row, refreshToken };
  }

  private async withAccessToken(
    user: UserRow,
    session: SessionRow,
    refreshToken: string,
  ): Promise<IssuedAuth> {
    const access = await this.accessTokens.sign({ userId: user.id, sessionId: session.id });
    return {
      user,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      refreshTokenExpiresAt: session.expiresAt,
    };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
  }

  /** Creates a one-time link (older unused links of the same kind stop working) and emails it. */
  private async sendEmailLink(user: UserRow, purpose: EmailTokenPurpose): Promise<void> {
    const token = generateOpaqueToken();
    const ttlMs =
      purpose === 'verify_email'
        ? this.config.auth.emailVerifyTtlHours * 3_600_000
        : this.config.auth.passwordResetTtlMin * 60_000;
    const now = new Date();
    await this.db
      .update(emailTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailTokens.userId, user.id),
          eq(emailTokens.purpose, purpose),
          isNull(emailTokens.usedAt),
        ),
      );
    await this.db.insert(emailTokens).values({
      userId: user.id,
      purpose,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + ttlMs),
    });
    const path = purpose === 'verify_email' ? '/verify-email' : '/reset-password';
    const link = `${this.config.webAppUrl}${path}?token=${token}`;
    try {
      await this.mail.send(renderAuthEmail(purpose, user.locale, user.email, link));
    } catch (error) {
      // The account action already succeeded; the user can request the email again.
      this.logger.error(
        `Failed to send ${purpose} email: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  private async consumeEmailToken(token: string, purpose: EmailTokenPurpose): Promise<string> {
    const now = new Date();
    const userId = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(emailTokens)
        .where(and(eq(emailTokens.tokenHash, hashToken(token)), eq(emailTokens.purpose, purpose)))
        .for('update');
      if (row === undefined || row.usedAt !== null || row.expiresAt <= now) return null;
      await tx.update(emailTokens).set({ usedAt: now }).where(eq(emailTokens.id, row.id));
      return row.userId;
    });
    if (userId === null) throw new ApiError('BAD_REQUEST', { detail: INVALID_LINK });
    return userId;
  }
}
