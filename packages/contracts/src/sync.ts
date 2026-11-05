import { z } from 'zod';

import { Id, IsoDateTime } from './common.js';

// Synchronization (I7b, docs/I7_PLAN.md §5, ADR-020). The change log is the only data path:
// the live channel just says «something changed, version N», clients fetch the changes by REST.

export const SYNC_CHANGES_LIMIT_MAX = 500;
/** How long changes are kept. A client further behind gets 410 GONE and reloads everything. */
export const CHANGE_LOG_RETENTION_DAYS = 90;

/** Live channel: `GET /ws?ticket=…` (through the web proxy: `/api/ws`). */
export const WS_PATH = '/ws';
export const WS_TICKET_TTL_SEC = 30;
export const WS_PING_INTERVAL_MS = 25_000;
export const WS_CLOSE = {
  /** The session ended (sign-out, revoked): get a new access token and a new ticket. */
  unauthenticated: 4401,
  /** The server restarts: reconnect after a pause. */
  shutdown: 1001,
} as const;

export const ChangeEntity = z.enum([
  'track_like',
  'release_save',
  'artist_follow',
  'playlist',
  'playlist_item',
  'settings',
]);
export type ChangeEntity = z.infer<typeof ChangeEntity>;

export const SyncChange = z.object({
  seq: z.number().int().positive(),
  entity: ChangeEntity,
  entityId: Id,
  op: z.enum(['upsert', 'delete']),
  payload: z.record(z.string(), z.unknown()).nullable(),
  /** Idempotency-Key of the request that made it: a client skips its own changes. */
  mutationId: Id.nullable(),
  at: IsoDateTime,
});
export type SyncChange = z.infer<typeof SyncChange>;

export const SyncChangesQuery = z.object({
  since: z.coerce.number().int().min(0),
  limit: z.coerce.number().int().min(1).max(SYNC_CHANGES_LIMIT_MAX).default(SYNC_CHANGES_LIMIT_MAX),
});
export type SyncChangesQuery = z.infer<typeof SyncChangesQuery>;

/** `seq`: the version the client has after applying `changes`; ask again while `hasMore`. */
export const SyncChangesPage = z.object({
  changes: z.array(SyncChange),
  seq: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type SyncChangesPage = z.infer<typeof SyncChangesPage>;

/** One-time pass for the live channel: the access token never goes into a URL. */
export const WsTicket = z.object({
  ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: IsoDateTime,
});
export type WsTicket = z.infer<typeof WsTicket>;

/** `hello` right after connecting, `changed` after every change of the user's library. */
export const WsServerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), seq: z.number().int().nonnegative() }),
  z.object({ type: z.literal('changed'), seq: z.number().int().nonnegative() }),
]);
export type WsServerMessage = z.infer<typeof WsServerMessage>;
