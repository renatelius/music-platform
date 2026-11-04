import { Inject, Injectable, Logger } from '@nestjs/common';

import type { Database } from '../db/client.js';
import { auditEvents } from '../db/schema.js';
import { DB } from '../infra/tokens.js';

export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.refresh_reuse_detected'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.session_revoked'
  | 'auth.email_verified'
  | 'auth.password_reset_requested'
  | 'auth.password_reset';

export interface AuditContext {
  ip: string | null;
  userAgent: string | null;
  requestId: string | undefined;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(@Inject(DB) private readonly db: Database) {}

  /** Never throws: a failed audit write must not break the user action, but it is logged. */
  async record(
    action: AuditAction,
    context: AuditContext,
    userId: string | null,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.db.insert(auditEvents).values({
        action,
        userId,
        ip: context.ip,
        userAgent: context.userAgent,
        requestId: context.requestId ?? null,
        meta: meta ?? null,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record ${action}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
