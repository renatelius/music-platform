/**
 * Database schema — source of truth for migrations (`pnpm db:generate`).
 * Keep this file free of relative imports: drizzle-kit loads it directly.
 *
 * Conventions: UUID v7 primary keys (PostgreSQL 18 `uuidv7()`), timestamptz everywhere,
 * snake_case columns, secrets stored only as hashes.
 */
import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  inet,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const userStatus = pgEnum('user_status', ['active', 'disabled', 'deleted']);

export const users = pgTable('users', {
  id: id(),
  email: citext('email').notNull().unique(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  /** argon2id hash; null for accounts that only use external sign-in. */
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  locale: text('locale').notNull().default('en'),
  status: userStatus('status').notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Refresh-token sessions, one per device sign-in. Rotation keeps the same family id. */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    /** SHA-256 of the refresh token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    deviceName: text('device_name'),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedById: uuid('replaced_by_id'),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_family_id_idx').on(t.familyId),
  ],
);

export const emailTokenPurpose = pgEnum('email_token_purpose', ['verify_email', 'reset_password']);

/** One-time email tokens (verification, password reset). Stored as SHA-256 hashes. */
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: emailTokenPurpose('purpose').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('email_tokens_user_id_idx').on(t.userId)],
);

/** Append-only log of security-relevant actions (sign-in, password change, admin actions). */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_events_user_id_idx').on(t.userId),
    index('audit_events_created_at_idx').on(t.createdAt),
  ],
);
