import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  type AddPlaylistItemsRequest,
  AddPlaylistItemsResult,
  type CreatePlaylistRequest,
  type FieldError,
  FollowedArtist,
  type FollowedArtistsPage,
  LIBRARY_LIMITS,
  LibraryChange,
  LibraryContains,
  type LibraryContainsRequest,
  LikedTrack,
  type LikedTracksPage,
  PlaylistItem,
  type PlaylistItemsPage,
  PlaylistList,
  PlaylistMutation,
  PlaylistSummary,
  SavedRelease,
  type SavedReleasesPage,
  type UpdatePlaylistRequest,
} from '@mp/contracts';
import { type SQL, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import { catalogSql, type CatalogTx, withCountry } from '../catalog/queries.js';
import { ApiError } from '../common/api-error.js';
import type { Database } from '../db/client.js';
import { playlistItems } from '../db/schema.js';
import { DB, REDIS } from '../infra/tokens.js';
import { isValidOrderKey, keysBetween } from './fractional.js';

const {
  visible,
  releaseVisible,
  artistVisible,
  artistsOf,
  trackJson,
  releaseJson,
  artistJson,
  raw,
} = catalogSql;

// ---------------------------------------------------------------- SQL building blocks

/** Timestamps as ISO-8601 UTC with milliseconds (IsoDateTime). */
export const ISO = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
/** Full precision for cursors: microseconds, so two rows never share a cursor. */
const EXACT = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** LibraryTrack: the catalog track when playable now, otherwise a stub marked unavailable. */
export const LIBRARY_TRACK = (t: string) =>
  `CASE WHEN ${visible(t)} THEN (${trackJson(t)}::jsonb || '{"available": true}'::jsonb)` +
  ` ELSE jsonb_build_object('available', false, 'id', ${t}.id, 'title', ${t}.title,` +
  ` 'durationMs', coalesce(${t}.duration_ms, 0),` +
  ` 'artists', ${artistsOf('track_artists', 'track_id', t)},` +
  ` 'release', (SELECT json_build_object('id', sr.id, 'title', sr.title) FROM releases sr WHERE sr.id = ${t}.release_id)) END`;

const PLAYLIST_JSON = (p: string) =>
  `json_build_object('id', ${p}.id, 'name', ${p}.name, 'description', ${p}.description,` +
  ` 'trackCount', (SELECT count(*) FROM playlist_items pc WHERE pc.playlist_id = ${p}.id),` +
  ` 'durationMs', (SELECT coalesce(sum(pt.duration_ms), 0) FROM playlist_items pd` +
  ` JOIN tracks pt ON pt.id = pd.track_id WHERE pd.playlist_id = ${p}.id),` +
  ` 'createdAt', ${ISO(`${p}.created_at`)}, 'updatedAt', ${ISO(`${p}.updated_at`)})`;

const ITEM_JSON = (i: string, t: string) =>
  `jsonb_build_object('itemId', ${i}.id, 'addedAt', ${ISO(`${i}.added_at`)}, 'track', ${LIBRARY_TRACK(t)})`;

/** A JSON array of ids as a set of uuids: no array parameters, no string-built lists. */
const idSet = (ids: readonly string[]): SQL =>
  sql`(SELECT (jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))::uuid)`;

// ---------------------------------------------------------------- cursors

const TimeCursor = z.tuple([z.iso.datetime(), z.uuid()]);

function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function badCursor(): ApiError {
  return new ApiError('VALIDATION_FAILED', {
    errors: [{ path: 'cursor', message: 'Invalid cursor' }],
  });
}

function decodeCursor<T extends z.ZodType>(schema: T, cursor: string): z.output<T> {
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw badCursor();
  }
}

async function page<T extends z.ZodType>(
  tx: CatalogTx,
  schema: T,
  limit: number,
  query: SQL,
  cursorOf: (cursor: unknown) => string,
): Promise<{ items: z.output<T>[]; nextCursor: string | null }> {
  const result = await tx.execute<{ data: unknown; cursor: unknown }>(query);
  const rows = result.rows.slice(0, limit);
  const last = rows.at(-1);
  return {
    items: rows.map((row) => schema.parse(row.data)),
    nextCursor: result.rows.length > limit && last !== undefined ? cursorOf(last.cursor) : null,
  };
}

const timeCursorOf = (cursor: unknown) => encodeCursor(cursor);

// ---------------------------------------------------------------- the three "saved" kinds

interface SavedKind {
  readonly table: string;
  readonly column: string;
  readonly at: string;
  readonly entity: 'track_like' | 'release_save' | 'artist_follow';
  /** SQL condition: the catalog row `x` is visible now (only visible things can be added). */
  readonly visibleSql: (x: string) => string;
  readonly catalogTable: string;
  readonly what: string;
}

const KINDS = {
  track: {
    table: 'library_tracks',
    column: 'track_id',
    at: 'liked_at',
    entity: 'track_like',
    visibleSql: visible,
    catalogTable: 'tracks',
    what: 'Track',
  },
  release: {
    table: 'library_releases',
    column: 'release_id',
    at: 'saved_at',
    entity: 'release_save',
    visibleSql: releaseVisible,
    catalogTable: 'releases',
    what: 'Release',
  },
  artist: {
    table: 'library_artists',
    column: 'artist_id',
    at: 'followed_at',
    entity: 'artist_follow',
    visibleSql: artistVisible,
    catalogTable: 'artists',
    what: 'Artist',
  },
} as const satisfies Record<string, SavedKind>;

export type SavedKindName = keyof typeof KINDS;

// ---------------------------------------------------------------- mutations

export interface Mutation {
  readonly tx: CatalogTx;
  readonly userId: string;
  /** Version of the library now (after the changes made so far in this request). */
  seq(): number;
  /** Records one change: +1 version, one row in the change log. */
  change(
    entity:
      'track_like' | 'release_save' | 'artist_follow' | 'playlist' | 'playlist_item' | 'settings',
    entityId: string,
    op: 'upsert' | 'delete',
    payload?: Record<string, unknown>,
  ): Promise<number>;
}

export interface MutationOptions {
  readonly userId: string;
  readonly country: string | null;
  /** Idempotency-Key header (lower-case uuid) or null. */
  readonly key: string | null;
  /** Method and path: a key reused for another request is refused. */
  readonly route: string;
}

const UserSeqRow = z.object({ change_seq: z.coerce.number() });
const StoredResponseRow = z.object({ route: z.string(), response: z.unknown() });

const notFound = (what: string) => new ApiError('NOT_FOUND', { detail: `${what} not found.` });

/**
 * Personal library and playlists (I7a, ADR-020). Every mutation is one transaction:
 * lock the user row (orders the user's changes) → change the data → +1 version and a change
 * log row per change → store the answer under the Idempotency-Key. After commit the version is
 * published on Redis (`user:<id>`) for the live channel of I7b.
 */
@Injectable()
export class LibraryService {
  private readonly logger = new Logger('Library');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** One change of the user's data, as described above. Also used by settings (I7b). */
  async mutate<T extends z.ZodType>(
    options: MutationOptions,
    schema: T,
    work: (m: Mutation) => Promise<z.output<T>>,
  ): Promise<z.output<T>> {
    const { userId, key, route } = options;
    // Set inside the transaction callback; an object keeps TypeScript from narrowing it to null.
    const changed: { seq: number | null } = { seq: null };
    const answer = await withCountry(this.db, options.country, async (tx) => {
      const locked = await tx.execute(
        sql`SELECT change_seq FROM users WHERE id = ${userId} FOR UPDATE`,
      );
      const row = locked.rows[0];
      if (row === undefined) throw new ApiError('UNAUTHENTICATED');
      let seq = UserSeqRow.parse(row).change_seq;

      if (key !== null) {
        await tx.execute(
          sql`DELETE FROM idempotency_keys
            WHERE user_id = ${userId} AND created_at < now() - interval '24 hours'`,
        );
        const stored = await tx.execute(
          sql`SELECT route, response FROM idempotency_keys WHERE user_id = ${userId} AND key = ${key}`,
        );
        const previous = stored.rows[0];
        if (previous !== undefined) {
          const { route: usedFor, response } = StoredResponseRow.parse(previous);
          if (usedFor !== route) {
            throw new ApiError('CONFLICT', {
              detail: 'This Idempotency-Key was already used for another request.',
            });
          }
          return schema.parse(response);
        }
      }

      const mutation: Mutation = {
        tx,
        userId,
        seq: () => seq,
        change: async (entity, entityId, op, payload) => {
          const bumped = await tx.execute(
            sql`UPDATE users SET change_seq = change_seq + 1 WHERE id = ${userId}
              RETURNING change_seq`,
          );
          seq = UserSeqRow.parse(bumped.rows[0]).change_seq;
          await tx.execute(
            sql`INSERT INTO user_change_log (user_id, seq, entity, entity_id, op, payload, mutation_id)
              VALUES (${userId}, ${seq}, ${entity}, ${entityId}, ${op},
                ${payload === undefined ? null : JSON.stringify(payload)}::jsonb, ${key})`,
          );
          changed.seq = seq;
          return seq;
        },
      };
      const value = schema.parse(await work(mutation));
      if (key !== null) {
        await tx.execute(
          sql`INSERT INTO idempotency_keys (user_id, key, route, response)
            VALUES (${userId}, ${key}, ${route}, ${JSON.stringify(value)}::jsonb)`,
        );
      }
      return value;
    });
    if (changed.seq !== null) this.publish(userId, changed.seq);
    return answer;
  }

  private publish(userId: string, seq: number): void {
    this.redis
      .publish(`user:${userId}`, JSON.stringify({ type: 'changed', seq }))
      .catch((error: unknown) => {
        // The live channel is a hint only: clients also catch up on their own (ADR-020).
        this.logger.warn(`Publish failed: ${error instanceof Error ? error.message : 'unknown'}`);
      });
  }

  // ---------------------------------------------------------------- liked / saved / followed

  likedTracks(
    userId: string,
    country: string | null,
    limit: number,
    cursor?: string,
  ): Promise<LikedTracksPage> {
    return this.savedPage(
      'track',
      LikedTrack,
      userId,
      country,
      limit,
      cursor,
      (x) => `jsonb_build_object('likedAt', ${ISO('s.liked_at')}, 'track', ${LIBRARY_TRACK(x)})`,
    );
  }

  savedReleases(
    userId: string,
    country: string | null,
    limit: number,
    cursor?: string,
  ): Promise<SavedReleasesPage> {
    return this.savedPage(
      'release',
      SavedRelease,
      userId,
      country,
      limit,
      cursor,
      (x) =>
        `jsonb_build_object('savedAt', ${ISO('s.saved_at')}, 'release',` +
        ` (${releaseJson(x)}::jsonb || jsonb_build_object('available', ${releaseVisible(x)})))`,
    );
  }

  followedArtists(
    userId: string,
    country: string | null,
    limit: number,
    cursor?: string,
  ): Promise<FollowedArtistsPage> {
    return this.savedPage(
      'artist',
      FollowedArtist,
      userId,
      country,
      limit,
      cursor,
      (x) =>
        `jsonb_build_object('followedAt', ${ISO('s.followed_at')}, 'artist',` +
        ` (${artistJson(x)}::jsonb || jsonb_build_object('available', ${artistVisible(x)})))`,
    );
  }

  /** Newest first, cursor on (time, id). */
  private savedPage<T extends z.ZodType>(
    kind: SavedKindName,
    schema: T,
    userId: string,
    country: string | null,
    limit: number,
    cursor: string | undefined,
    json: (x: string) => string,
  ) {
    const k = KINDS[kind];
    const after =
      cursor === undefined
        ? sql``
        : (() => {
            const [at, id] = decodeCursor(TimeCursor, cursor);
            return sql`AND (s.${raw(k.at)}, s.${raw(k.column)}) < (${at}::timestamptz, ${id}::uuid)`;
          })();
    return withCountry(this.db, country, (tx) =>
      page(
        tx,
        schema,
        limit,
        sql`SELECT ${raw(json('x'))} AS data,
            json_build_array(${raw(EXACT(`s.${k.at}`))}, s.${raw(k.column)}) AS cursor
          FROM ${raw(k.table)} s JOIN ${raw(k.catalogTable)} x ON x.id = s.${raw(k.column)}
          WHERE s.user_id = ${userId} ${after}
          ORDER BY s.${raw(k.at)} DESC, s.${raw(k.column)} DESC
          LIMIT ${limit + 1}`,
        timeCursorOf,
      ),
    );
  }

  /** Like / save / follow. Repeating it changes nothing and keeps the version. */
  add(kind: SavedKindName, options: MutationOptions, id: string): Promise<LibraryChange> {
    const k = KINDS[kind];
    return this.mutate(options, LibraryChange, async (m) => {
      const existing = await m.tx.execute(
        sql`SELECT 1 FROM ${raw(k.table)} WHERE user_id = ${m.userId} AND ${raw(k.column)} = ${id}`,
      );
      if (existing.rows.length > 0) return { seq: m.seq() };
      const shown = await m.tx.execute(
        sql`SELECT 1 FROM ${raw(k.catalogTable)} x WHERE x.id = ${id} AND ${raw(k.visibleSql('x'))}`,
      );
      if (shown.rows.length === 0) throw notFound(k.what);
      if (kind === 'track') await this.checkLikeLimit(m);
      const inserted = await m.tx.execute(
        sql`INSERT INTO ${raw(k.table)} (user_id, ${raw(k.column)}) VALUES (${m.userId}, ${id})
          ON CONFLICT DO NOTHING RETURNING ${raw(ISO(k.at))} AS at`,
      );
      const at = inserted.rows[0]?.at;
      if (at === undefined) return { seq: m.seq() };
      return { seq: await m.change(k.entity, id, 'upsert', { at }) };
    });
  }

  private async checkLikeLimit(m: Mutation): Promise<void> {
    const counted = await m.tx.execute(
      sql`SELECT count(*)::int AS n FROM library_tracks WHERE user_id = ${m.userId}`,
    );
    const n = z.coerce.number().parse(counted.rows[0]?.n ?? 0);
    if (n >= LIBRARY_LIMITS.likes) {
      throw new ApiError('LIMIT_EXCEEDED', {
        detail: `At most ${String(LIBRARY_LIMITS.likes)} liked tracks.`,
      });
    }
  }

  /** Unlike / unsave / unfollow. Also allowed when the item is no longer in the catalog. */
  remove(kind: SavedKindName, options: MutationOptions, id: string): Promise<LibraryChange> {
    const k = KINDS[kind];
    return this.mutate(options, LibraryChange, async (m) => {
      const deleted = await m.tx.execute(
        sql`DELETE FROM ${raw(k.table)} WHERE user_id = ${m.userId} AND ${raw(k.column)} = ${id}
          RETURNING 1`,
      );
      if (deleted.rows.length === 0) return { seq: m.seq() };
      return { seq: await m.change(k.entity, id, 'delete') };
    });
  }

  async contains(userId: string, body: LibraryContainsRequest): Promise<LibraryContains> {
    const found = (table: string, column: string, ids: readonly string[]) =>
      ids.length === 0
        ? sql`'[]'::json`
        : sql`coalesce((SELECT json_agg(${raw(column)}) FROM ${raw(table)}
            WHERE user_id = ${userId} AND ${raw(column)} IN ${idSet(ids)}), '[]'::json)`;
    const result = await this.db.execute<{ data: unknown }>(
      sql`SELECT json_build_object(
        'tracks', ${found('library_tracks', 'track_id', body.tracks)},
        'releases', ${found('library_releases', 'release_id', body.releases)},
        'artists', ${found('library_artists', 'artist_id', body.artists)}) AS data`,
    );
    return LibraryContains.parse(result.rows[0]?.data);
  }

  // ---------------------------------------------------------------- playlists

  async playlists(userId: string): Promise<PlaylistList> {
    const result = await this.db.execute<{ data: unknown }>(
      sql`SELECT ${raw(PLAYLIST_JSON('p'))} AS data FROM playlists p
        WHERE p.owner_id = ${userId} AND p.deleted_at IS NULL
        ORDER BY p.updated_at DESC, p.id DESC`,
    );
    return { items: result.rows.map((row) => PlaylistSummary.parse(row.data)) };
  }

  async playlist(userId: string, id: string): Promise<PlaylistSummary> {
    const found = await this.findPlaylist(this.db, userId, id);
    if (found === null) throw notFound('Playlist');
    return found;
  }

  /** Someone else's or a deleted playlist is "not found" (no hint that it exists). */
  private async findPlaylist(
    db: Pick<Database, 'execute'>,
    userId: string,
    id: string,
  ): Promise<PlaylistSummary | null> {
    const result = await db.execute<{ data: unknown }>(
      sql`SELECT ${raw(PLAYLIST_JSON('p'))} AS data FROM playlists p
        WHERE p.id = ${id} AND p.owner_id = ${userId} AND p.deleted_at IS NULL`,
    );
    const row = result.rows[0];
    return row === undefined ? null : PlaylistSummary.parse(row.data);
  }

  private async ownPlaylist(m: Mutation, id: string): Promise<PlaylistSummary> {
    const found = await this.findPlaylist(m.tx, m.userId, id);
    if (found === null) throw notFound('Playlist');
    return found;
  }

  async items(
    userId: string,
    country: string | null,
    playlistId: string,
    limit: number,
    cursor?: string,
  ): Promise<PlaylistItemsPage> {
    const after =
      cursor === undefined
        ? sql``
        : (() => {
            const position = decodeCursor(z.string(), cursor);
            if (!isValidOrderKey(position)) throw badCursor();
            return sql`AND i.position COLLATE "C" > ${position}::text COLLATE "C"`;
          })();
    return withCountry(this.db, country, async (tx) => {
      if ((await this.findPlaylist(tx, userId, playlistId)) === null) throw notFound('Playlist');
      return page(
        tx,
        PlaylistItem,
        limit,
        sql`SELECT ${raw(ITEM_JSON('i', 't'))} AS data, i.position AS cursor
          FROM playlist_items i JOIN tracks t ON t.id = i.track_id
          WHERE i.playlist_id = ${playlistId} ${after}
          ORDER BY i.position COLLATE "C"
          LIMIT ${limit + 1}`,
        (position) => encodeCursor(position),
      );
    });
  }

  createPlaylist(options: MutationOptions, body: CreatePlaylistRequest): Promise<PlaylistMutation> {
    return this.mutate(options, PlaylistMutation, async (m) => {
      const counted = await m.tx.execute(
        sql`SELECT count(*)::int AS n FROM playlists WHERE owner_id = ${m.userId} AND deleted_at IS NULL`,
      );
      if (z.coerce.number().parse(counted.rows[0]?.n ?? 0) >= LIBRARY_LIMITS.playlists) {
        throw new ApiError('LIMIT_EXCEEDED', {
          detail: `At most ${String(LIBRARY_LIMITS.playlists)} playlists.`,
        });
      }
      const created = await m.tx.execute(
        sql`INSERT INTO playlists (owner_id, name, description)
          VALUES (${m.userId}, ${body.name}, ${body.description}) RETURNING id`,
      );
      const id = z.uuid().parse(created.rows[0]?.id);
      const seq = await m.change('playlist', id, 'upsert', {
        name: body.name,
        description: body.description,
      });
      return { seq, playlist: await this.ownPlaylist(m, id) };
    });
  }

  updatePlaylist(
    options: MutationOptions,
    id: string,
    body: UpdatePlaylistRequest,
  ): Promise<PlaylistMutation> {
    return this.mutate(options, PlaylistMutation, async (m) => {
      await this.ownPlaylist(m, id);
      const sets: SQL[] = [sql`updated_at = now()`];
      if (body.name !== undefined) sets.push(sql`name = ${body.name}`);
      if (body.description !== undefined) sets.push(sql`description = ${body.description}`);
      await m.tx.execute(sql`UPDATE playlists SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
      const playlist = await this.ownPlaylist(m, id);
      const seq = await m.change('playlist', id, 'upsert', {
        name: playlist.name,
        description: playlist.description,
      });
      return { seq, playlist };
    });
  }

  /** Leaves a tombstone, so clients that were offline learn about the deletion (I7b). */
  deletePlaylist(options: MutationOptions, id: string): Promise<LibraryChange> {
    return this.mutate(options, LibraryChange, async (m) => {
      await this.ownPlaylist(m, id);
      await m.tx.execute(
        sql`UPDATE playlists SET deleted_at = now(), updated_at = now() WHERE id = ${id}`,
      );
      return { seq: await m.change('playlist', id, 'delete') };
    });
  }

  addItems(
    options: MutationOptions,
    playlistId: string,
    body: AddPlaylistItemsRequest,
  ): Promise<AddPlaylistItemsResult> {
    return this.mutate(options, AddPlaylistItemsResult, async (m) => {
      const playlist = await this.ownPlaylist(m, playlistId);
      const { trackIds } = body;

      const playable = await m.tx.execute(
        sql`SELECT t.id FROM tracks t WHERE t.id IN ${idSet(trackIds)} AND ${raw(visible('t'))}`,
      );
      const playableIds = new Set(playable.rows.map((row) => String(row.id)));
      const missing: FieldError[] = [];
      trackIds.forEach((trackId, index) => {
        if (!playableIds.has(trackId)) {
          missing.push({ path: `trackIds.${String(index)}`, message: 'Track not found' });
        }
      });
      if (missing.length > 0) throw new ApiError('VALIDATION_FAILED', { errors: missing });

      if (!body.allowDuplicates) {
        const present = await m.tx.execute(
          sql`SELECT DISTINCT track_id FROM playlist_items
            WHERE playlist_id = ${playlistId} AND track_id IN ${idSet(trackIds)}`,
        );
        const seen = new Set(present.rows.map((row) => String(row.track_id)));
        const duplicates: FieldError[] = [];
        trackIds.forEach((trackId, index) => {
          if (seen.has(trackId)) {
            duplicates.push({
              path: `trackIds.${String(index)}`,
              message: 'Already in the playlist',
            });
          }
          seen.add(trackId);
        });
        if (duplicates.length > 0) {
          throw new ApiError('DUPLICATE_TRACKS', {
            detail: 'Some tracks are already in the playlist.',
            errors: duplicates,
          });
        }
      }

      if (playlist.trackCount + trackIds.length > LIBRARY_LIMITS.playlistItems) {
        throw new ApiError('LIMIT_EXCEEDED', {
          detail: `At most ${String(LIBRARY_LIMITS.playlistItems)} tracks in a playlist.`,
        });
      }

      const [lower, upper] = await this.gapFor(m, playlistId, body.after, null);
      const positions = keysBetween(lower, upper, trackIds.length);
      const inserted = await m.tx
        .insert(playlistItems)
        .values(
          trackIds.map((trackId, index) => ({
            playlistId,
            trackId,
            position: positions[index] ?? '',
          })),
        )
        .returning({
          id: playlistItems.id,
          trackId: playlistItems.trackId,
          position: playlistItems.position,
        });
      let seq = m.seq();
      for (const item of inserted) {
        seq = await m.change('playlist_item', item.id, 'upsert', {
          playlistId,
          trackId: item.trackId,
          position: item.position,
        });
      }
      await this.touch(m, playlistId);
      const items = await m.tx.execute<{ data: unknown }>(
        sql`SELECT ${raw(ITEM_JSON('i', 't'))} AS data
          FROM playlist_items i JOIN tracks t ON t.id = i.track_id
          WHERE i.id IN ${idSet(inserted.map((item) => item.id))}
          ORDER BY i.position COLLATE "C"`,
      );
      return {
        seq,
        playlist: await this.ownPlaylist(m, playlistId),
        items: items.rows.map((row) => PlaylistItem.parse(row.data)),
      };
    });
  }

  moveItem(
    options: MutationOptions,
    playlistId: string,
    itemId: string,
    after: string | null,
  ): Promise<LibraryChange> {
    return this.mutate(options, LibraryChange, async (m) => {
      await this.ownPlaylist(m, playlistId);
      const item = await m.tx.execute(
        sql`SELECT 1 FROM playlist_items WHERE id = ${itemId} AND playlist_id = ${playlistId}`,
      );
      if (item.rows.length === 0) throw notFound('Playlist item');
      if (after === itemId) {
        throw new ApiError('VALIDATION_FAILED', {
          errors: [{ path: 'after', message: 'An item cannot follow itself' }],
        });
      }
      const [lower, upper] = await this.gapFor(m, playlistId, after, itemId);
      const [position] = keysBetween(lower, upper, 1);
      if (position === undefined) throw new Error('No position');
      await m.tx.execute(
        sql`UPDATE playlist_items SET position = ${position} WHERE id = ${itemId}`,
      );
      await this.touch(m, playlistId);
      return {
        seq: await m.change('playlist_item', itemId, 'upsert', { playlistId, position }),
      };
    });
  }

  removeItem(options: MutationOptions, playlistId: string, itemId: string): Promise<LibraryChange> {
    return this.mutate(options, LibraryChange, async (m) => {
      await this.ownPlaylist(m, playlistId);
      const deleted = await m.tx.execute(
        sql`DELETE FROM playlist_items WHERE id = ${itemId} AND playlist_id = ${playlistId}
          RETURNING 1`,
      );
      if (deleted.rows.length === 0) throw notFound('Playlist item');
      await this.touch(m, playlistId);
      return { seq: await m.change('playlist_item', itemId, 'delete', { playlistId }) };
    });
  }

  private async touch(m: Mutation, playlistId: string): Promise<void> {
    await m.tx.execute(sql`UPDATE playlists SET updated_at = now() WHERE id = ${playlistId}`);
  }

  /**
   * Positions around the insertion point. `after`: undefined = end, null = start, otherwise the
   * item to follow. `exclude`: the item being moved (its old place does not count).
   */
  private async gapFor(
    m: Mutation,
    playlistId: string,
    after: string | null | undefined,
    exclude: string | null,
  ): Promise<[string | null, string | null]> {
    const notMoved = exclude === null ? sql`` : sql`AND id <> ${exclude}`;
    const position = async (query: SQL): Promise<string | null> => {
      const result = await m.tx.execute(query);
      const value = result.rows[0]?.position;
      return typeof value === 'string' ? value : null;
    };
    if (after === undefined) {
      const last = await position(
        sql`SELECT position FROM playlist_items WHERE playlist_id = ${playlistId} ${notMoved}
          ORDER BY position COLLATE "C" DESC LIMIT 1`,
      );
      return [last, null];
    }
    if (after === null) {
      const first = await position(
        sql`SELECT position FROM playlist_items WHERE playlist_id = ${playlistId} ${notMoved}
          ORDER BY position COLLATE "C" LIMIT 1`,
      );
      return [null, first];
    }
    const anchor = await position(
      sql`SELECT position FROM playlist_items WHERE id = ${after} AND playlist_id = ${playlistId}`,
    );
    if (anchor === null) {
      throw new ApiError('VALIDATION_FAILED', {
        errors: [{ path: 'after', message: 'Item not found in this playlist' }],
      });
    }
    const next = await position(
      sql`SELECT position FROM playlist_items
        WHERE playlist_id = ${playlistId} ${notMoved}
          AND position COLLATE "C" > ${anchor}::text COLLATE "C"
        ORDER BY position COLLATE "C" LIMIT 1`,
    );
    return [anchor, next];
  }
}
