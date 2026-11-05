import { Inject, Injectable } from '@nestjs/common';

import {
  PlaybackSettings,
  type UpdateUserSettingsRequest,
  type UserSettings,
  UserSettingsMutation,
} from '@mp/contracts';
import { sql } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { DB } from '../infra/tokens.js';
import { ISO, LibraryService, type MutationOptions } from '../library/library.service.js';

const DEFAULTS: UserSettings = { playback: null, historyEnabled: true, updatedAt: null };

/**
 * Settings that follow the user (I7b): playback preferences and «record history». A change is
 * one more version of the library (entity `settings`), so other devices hear about it.
 */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(LibraryService) private readonly library: LibraryService,
  ) {}

  get(userId: string): Promise<UserSettings> {
    return this.read(this.db, userId);
  }

  private async read(db: Pick<Database, 'execute'>, userId: string): Promise<UserSettings> {
    const result = await db.execute(
      sql`SELECT playback, history_enabled, ${sql.raw(ISO('updated_at'))} AS updated_at
        FROM user_settings WHERE user_id = ${userId}`,
    );
    const row = result.rows[0];
    if (row === undefined) return DEFAULTS;
    // Saved by an older client version with other fields: treated as not saved yet.
    const playback = PlaybackSettings.safeParse(row.playback);
    return {
      playback: playback.success ? playback.data : null,
      historyEnabled: row.history_enabled !== false,
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    };
  }

  /** Saving the same values again changes nothing and keeps the version. */
  update(options: MutationOptions, body: UpdateUserSettingsRequest): Promise<UserSettingsMutation> {
    return this.library.mutate(options, UserSettingsMutation, async (m) => {
      const before = await this.read(m.tx, m.userId);
      const playback = body.playback ?? before.playback;
      const historyEnabled = body.historyEnabled ?? before.historyEnabled;
      const same =
        historyEnabled === before.historyEnabled &&
        JSON.stringify(playback) === JSON.stringify(before.playback);
      if (same) return { ...before, seq: m.seq() };
      await m.tx.execute(
        sql`INSERT INTO user_settings (user_id, playback, history_enabled, updated_at)
          VALUES (${m.userId}, ${playback === null ? null : JSON.stringify(playback)}::jsonb,
            ${historyEnabled}, now())
          ON CONFLICT (user_id) DO UPDATE SET playback = EXCLUDED.playback,
            history_enabled = EXCLUDED.history_enabled, updated_at = now()`,
      );
      const seq = await m.change('settings', m.userId, 'upsert', { historyEnabled });
      return { ...(await this.read(m.tx, m.userId)), seq };
    });
  }
}
