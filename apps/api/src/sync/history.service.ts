import { Inject, Injectable } from '@nestjs/common';

import {
  type ClearHistoryResult,
  PLAY_COUNT_MS,
  type PlayEvent,
  RecentPlay,
  type RecentPlays,
  type RecordPlaysResult,
} from '@mp/contracts';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { withCountry } from '../catalog/queries.js';
import type { Database } from '../db/client.js';
import { DB } from '../infra/tokens.js';
import { ISO, LIBRARY_TRACK } from '../library/library.service.js';

/** Recent plays look at this many latest reports (enough to fill the list after merging). */
const RECENT_WINDOW = 500;

/**
 * Listening history (I7b). Reports come in batches, a repeated `clientEventId` is skipped.
 * With history off nothing is written, whatever the client sends (an old client, a queue sent
 * after switching it off).
 */
@Injectable()
export class HistoryService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async enabled(userId: string): Promise<boolean> {
    const result = await this.db.execute(
      sql`SELECT history_enabled FROM user_settings WHERE user_id = ${userId}`,
    );
    const row = result.rows[0];
    return row === undefined || row.history_enabled !== false;
  }

  async record(
    userId: string,
    sessionId: string,
    events: readonly PlayEvent[],
  ): Promise<RecordPlaysResult> {
    if (!(await this.enabled(userId))) return { recorded: 0 };
    const rows = JSON.stringify(
      events.map((event) => ({
        client_event_id: event.clientEventId,
        track_id: event.trackId,
        started_at: event.startedAt,
        played_ms: event.playedMs,
        completed: event.completed,
        skipped: event.skipped,
        context_type: event.context?.type ?? null,
        context_id: event.context?.id ?? null,
      })),
    );
    // Unknown tracks are dropped: a report must not fail because the catalog changed.
    const result = await this.db.execute(
      sql`INSERT INTO play_events (user_id, track_id, started_at, played_ms, completed, skipped,
          session_id, context_type, context_id, client_event_id)
        SELECT ${userId}, e.track_id, e.started_at, e.played_ms, e.completed, e.skipped,
          ${sessionId}, e.context_type, e.context_id, e.client_event_id
        FROM jsonb_to_recordset(${rows}::jsonb) AS e(client_event_id uuid, track_id uuid,
          started_at timestamptz, played_ms int, completed boolean, skipped boolean,
          context_type text, context_id uuid)
        JOIN tracks t ON t.id = e.track_id
        ON CONFLICT (user_id, client_event_id) DO NOTHING
        RETURNING 1`,
    );
    return { recorded: result.rows.length };
  }

  /** Newest first; plays shorter than the rule are not shown, a repeat in a row is merged. */
  recent(userId: string, country: string | null, limit: number): Promise<RecentPlays> {
    return withCountry(this.db, country, async (tx) => {
      const result = await tx.execute<{ data: unknown }>(
        sql`WITH latest AS (
            SELECT p.id, p.track_id, p.started_at FROM play_events p
            JOIN tracks lt ON lt.id = p.track_id
            WHERE p.user_id = ${userId}
              AND p.played_ms >= least(${PLAY_COUNT_MS}, greatest(coalesce(lt.duration_ms, 0), 1) / 2.0)
            ORDER BY p.started_at DESC, p.id DESC
            LIMIT ${RECENT_WINDOW}
          ), marked AS (
            SELECT l.*, lag(l.track_id) OVER (ORDER BY l.started_at DESC, l.id DESC) AS previous
            FROM latest l
          )
          SELECT jsonb_build_object('playedAt', ${sql.raw(ISO('m.started_at'))},
              'track', ${sql.raw(LIBRARY_TRACK('t'))}) AS data
          FROM marked m JOIN tracks t ON t.id = m.track_id
          WHERE m.previous IS DISTINCT FROM m.track_id
          ORDER BY m.started_at DESC, m.id DESC
          LIMIT ${limit}`,
      );
      return { items: result.rows.map((row) => RecentPlay.parse(row.data)) };
    });
  }

  async clear(userId: string): Promise<ClearHistoryResult> {
    const result = await this.db.execute(
      sql`WITH gone AS (DELETE FROM play_events WHERE user_id = ${userId} RETURNING 1)
        SELECT count(*)::int AS n FROM gone`,
    );
    return { deleted: z.coerce.number().parse(result.rows[0]?.n ?? 0) };
  }
}
