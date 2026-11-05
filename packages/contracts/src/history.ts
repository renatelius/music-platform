import { z } from 'zod';

import { Id, IsoDateTime } from './common.js';
import { LibraryTrack } from './library.js';

// Listening history (I7b, docs/I7_PLAN.md §4). Reports are sent in batches through the offline
// queue; `clientEventId` makes a repeated report harmless.

export const HISTORY_BATCH_MAX = 50;
export const PLAY_COUNT_MS = 30_000;
export const RECENT_LIMIT_MAX = 50;

/** A play counts from 30 s or half of the track, whichever is less. Earlier — a skip. */
export function countsAsPlay(playedMs: number, durationMs: number): boolean {
  return playedMs >= Math.min(PLAY_COUNT_MS, Math.max(durationMs, 1) / 2);
}

/** Where the track was started from. */
export const PlayContext = z.object({
  type: z.enum(['release', 'artist', 'playlist', 'library', 'search', 'queue']),
  id: Id.nullable().default(null),
});
export type PlayContext = z.infer<typeof PlayContext>;

export const PlayEvent = z.object({
  clientEventId: Id,
  trackId: Id,
  startedAt: IsoDateTime,
  playedMs: z.number().int().min(0).max(86_400_000),
  completed: z.boolean(),
  skipped: z.boolean(),
  context: PlayContext.nullable().default(null),
});
export type PlayEvent = z.infer<typeof PlayEvent>;

export const RecordPlaysRequest = z.object({
  events: z.array(PlayEvent).min(1).max(HISTORY_BATCH_MAX),
});
export type RecordPlaysRequest = z.infer<typeof RecordPlaysRequest>;

/** `recorded: 0` when history is off or the events were already recorded. */
export const RecordPlaysResult = z.object({ recorded: z.number().int().nonnegative() });
export type RecordPlaysResult = z.infer<typeof RecordPlaysResult>;

export const RecentQuery = z.object({
  limit: z.coerce.number().int().min(1).max(RECENT_LIMIT_MAX).default(20),
});
export type RecentQuery = z.infer<typeof RecentQuery>;

export const RecentPlay = z.object({ playedAt: IsoDateTime, track: LibraryTrack });
export type RecentPlay = z.infer<typeof RecentPlay>;

/** Newest first, the same track twice in a row shown once. */
export const RecentPlays = z.object({ items: z.array(RecentPlay) });
export type RecentPlays = z.infer<typeof RecentPlays>;

export const ClearHistoryResult = z.object({ deleted: z.number().int().nonnegative() });
export type ClearHistoryResult = z.infer<typeof ClearHistoryResult>;
