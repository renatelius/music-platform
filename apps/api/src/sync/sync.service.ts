import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  CHANGE_LOG_RETENTION_DAYS,
  SyncChange,
  type SyncChangesPage,
  WS_TICKET_TTL_SEC,
  type WsTicket,
} from '@mp/contracts';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import { ApiError } from '../common/api-error.js';
import type { Database } from '../db/client.js';
import { DB, REDIS } from '../infra/tokens.js';
import { ISO } from '../library/library.service.js';

const TICKET_PREFIX = 'ws-ticket:';
const TICKET_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** Who a live connection belongs to: the user and the sign-in (session family). */
export const TicketOwner = z.object({ userId: z.uuid(), familyId: z.uuid() });
export type TicketOwner = z.infer<typeof TicketOwner>;

const SeqRow = z.object({ change_seq: z.coerce.number() });
const ChangeRow = z.object({
  seq: z.coerce.number(),
  entity: z.string(),
  entity_id: z.string(),
  op: z.string(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  mutation_id: z.string().nullable(),
  at: z.string(),
});

const gone = () =>
  new ApiError('GONE', {
    detail: 'This version is unknown or too old: reload the library and sync from its version.',
  });

/** Change log reads and live channel tickets (I7b, ADR-020). */
@Injectable()
export class SyncService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async currentSeq(userId: string): Promise<number> {
    const result = await this.db.execute(sql`SELECT change_seq FROM users WHERE id = ${userId}`);
    const row = result.rows[0];
    if (row === undefined) throw new ApiError('UNAUTHENTICATED');
    return SeqRow.parse(row).change_seq;
  }

  /** Changes after `since`, oldest first. A gap means the log was cleaned up: 410. */
  async changes(userId: string, since: number, limit: number): Promise<SyncChangesPage> {
    const current = await this.currentSeq(userId);
    if (since > current) throw gone();
    if (since === current) return { changes: [], seq: current, hasMore: false };
    const result = await this.db.execute(
      sql`SELECT seq, entity, entity_id, op, payload, mutation_id, ${sql.raw(ISO('created_at'))} AS at
        FROM user_change_log WHERE user_id = ${userId} AND seq > ${since}
        ORDER BY seq LIMIT ${limit + 1}`,
    );
    const rows = result.rows.map((row) => ChangeRow.parse(row));
    if (rows[0]?.seq !== since + 1) throw gone();
    const changes = rows.slice(0, limit).map((row) =>
      SyncChange.parse({
        seq: row.seq,
        entity: row.entity,
        entityId: row.entity_id,
        op: row.op,
        payload: row.payload,
        mutationId: row.mutation_id,
        at: row.at,
      }),
    );
    return { changes, seq: changes.at(-1)?.seq ?? since, hasMore: rows.length > limit };
  }

  /** A one-time pass for the live channel, valid for 30 s. Also cleans the user's old log. */
  async issueTicket(owner: TicketOwner): Promise<WsTicket> {
    await this.db.execute(
      sql`DELETE FROM user_change_log WHERE user_id = ${owner.userId}
        AND created_at < now() - ${sql.raw(`interval '${String(CHANGE_LOG_RETENTION_DAYS)} days'`)}`,
    );
    const ticket = randomBytes(32).toString('base64url');
    await this.redis.set(
      `${TICKET_PREFIX}${ticket}`,
      JSON.stringify(owner),
      'EX',
      WS_TICKET_TTL_SEC,
    );
    return { ticket, expiresAt: new Date(Date.now() + WS_TICKET_TTL_SEC * 1000).toISOString() };
  }

  /** The owner of a ticket, once: a second use (or an expired ticket) is null. */
  async redeemTicket(ticket: string): Promise<TicketOwner | null> {
    if (!TICKET_FORMAT.test(ticket)) return null;
    const stored = await this.redis.getdel(`${TICKET_PREFIX}${ticket}`);
    if (stored === null) return null;
    try {
      const parsed = TicketOwner.safeParse(JSON.parse(stored));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** The sign-in is still valid (refresh rotation keeps the family, a sign-out ends it). */
  async sessionActive(owner: TicketOwner): Promise<boolean> {
    const result = await this.db.execute(
      sql`SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.family_id = ${owner.familyId} AND s.user_id = ${owner.userId}
          AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'
        LIMIT 1`,
    );
    return result.rows.length > 0;
  }
}
