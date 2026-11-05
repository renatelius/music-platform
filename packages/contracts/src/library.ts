import { z } from 'zod';

import { ArtistSummary, ReleaseSummary, TrackDto } from './catalog.js';
import { Id, IsoDateTime, PAGE_LIMIT_DEFAULT, pageOf } from './common.js';

// Personal library and playlists (I7a, docs/I7_PLAN.md, ADR-020). Every mutation answers with
// `seq`: the version of the user's library after it (the base of synchronization in I7b).

export const LIBRARY_LIMITS = {
  likes: 100_000,
  playlists: 1000,
  playlistItems: 10_000,
  /** Ids per request in `contains` and `addItems`. */
  batch: 100,
} as const;

/** Header that makes a POST safe to retry: the same key returns the stored answer (24 h). */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IdempotencyKey = Id;

/** Library version after a mutation. A repeated like/unlike returns the same, unchanged `seq`. */
export const LibraryChange = z.object({ seq: z.number().int().nonnegative() });
export type LibraryChange = z.infer<typeof LibraryChange>;

/** What a list can show about a track that is no longer playable (rights ended, removed). */
export const TrackStub = TrackDto.pick({
  id: true,
  title: true,
  durationMs: true,
  artists: true,
  release: true,
});
export type TrackStub = z.infer<typeof TrackStub>;

/**
 * A track in the user's lists. It stays there when it stops being playable: then it is a stub
 * marked `available: false` ("Unavailable", no play button) — ADR-018 for user lists.
 */
export const LibraryTrack = z.discriminatedUnion('available', [
  TrackDto.extend({ available: z.literal(true) }),
  TrackStub.extend({ available: z.literal(false) }),
]);
export type LibraryTrack = z.infer<typeof LibraryTrack>;

/** Counts cover playable tracks only; `available: false` when none is playable now. */
export const LibraryRelease = ReleaseSummary.extend({ available: z.boolean() });
export type LibraryRelease = z.infer<typeof LibraryRelease>;

export const LibraryArtist = ArtistSummary.extend({ available: z.boolean() });
export type LibraryArtist = z.infer<typeof LibraryArtist>;

export const LikedTrack = z.object({ likedAt: IsoDateTime, track: LibraryTrack });
export type LikedTrack = z.infer<typeof LikedTrack>;
export const LikedTracksPage = pageOf(LikedTrack);
export type LikedTracksPage = z.infer<typeof LikedTracksPage>;

export const SavedRelease = z.object({ savedAt: IsoDateTime, release: LibraryRelease });
export type SavedRelease = z.infer<typeof SavedRelease>;
export const SavedReleasesPage = pageOf(SavedRelease);
export type SavedReleasesPage = z.infer<typeof SavedReleasesPage>;

export const FollowedArtist = z.object({ followedAt: IsoDateTime, artist: LibraryArtist });
export type FollowedArtist = z.infer<typeof FollowedArtist>;
export const FollowedArtistsPage = pageOf(FollowedArtist);
export type FollowedArtistsPage = z.infer<typeof FollowedArtistsPage>;

const IdBatch = z.array(Id).max(LIBRARY_LIMITS.batch).default([]);

/** Which of these are in my library: hearts, "Saved" and "Following" for a screen at once. */
export const LibraryContainsRequest = z.object({
  tracks: IdBatch,
  releases: IdBatch,
  artists: IdBatch,
});
export type LibraryContainsRequest = z.infer<typeof LibraryContainsRequest>;

/** The subset of the requested ids that are in the library. */
export const LibraryContains = z.object({
  tracks: z.array(Id),
  releases: z.array(Id),
  artists: z.array(Id),
});
export type LibraryContains = z.infer<typeof LibraryContains>;

// ---------------------------------------------------------------- playlists

export const PLAYLIST_NAME_MAX = 100;
export const PLAYLIST_DESCRIPTION_MAX = 300;
export const PLAYLIST_ITEMS_LIMIT_DEFAULT = PAGE_LIMIT_DEFAULT * 5;
export const PLAYLIST_ITEMS_LIMIT_MAX = 500;

/** Whitespace collapsed and trimmed; control characters rejected (like search text). */
const PlainText = (max: number, min: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, ' ').trim())
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .regex(/^\P{Cc}*$/u, 'Must not contain control characters'),
    );

export const PlaylistName = PlainText(PLAYLIST_NAME_MAX, 1);
/** Empty description is stored as null. */
export const PlaylistDescription = PlainText(PLAYLIST_DESCRIPTION_MAX, 0).transform((value) =>
  value === '' ? null : value,
);

export const CreatePlaylistRequest = z.object({
  name: PlaylistName,
  description: PlaylistDescription.nullable().default(null),
});
export type CreatePlaylistRequest = z.infer<typeof CreatePlaylistRequest>;

export const UpdatePlaylistRequest = z
  .object({
    name: PlaylistName.optional(),
    description: PlaylistDescription.nullable().optional(),
  })
  .refine((body) => body.name !== undefined || body.description !== undefined, {
    message: 'Nothing to change',
  });
export type UpdatePlaylistRequest = z.infer<typeof UpdatePlaylistRequest>;

export const PlaylistSummary = z.object({
  id: Id,
  name: z.string(),
  description: z.string().nullable(),
  /** Every item, also unavailable ones. */
  trackCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PlaylistSummary = z.infer<typeof PlaylistSummary>;

/** Newest changed first. */
export const PlaylistList = z.object({ items: z.array(PlaylistSummary) });
export type PlaylistList = z.infer<typeof PlaylistList>;

export const PlaylistMutation = LibraryChange.extend({ playlist: PlaylistSummary });
export type PlaylistMutation = z.infer<typeof PlaylistMutation>;

/** One entry of a playlist; the same track may appear twice, `itemId` tells them apart. */
export const PlaylistItem = z.object({ itemId: Id, addedAt: IsoDateTime, track: LibraryTrack });
export type PlaylistItem = z.infer<typeof PlaylistItem>;

export const PlaylistItemsQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PLAYLIST_ITEMS_LIMIT_MAX)
    .default(PLAYLIST_ITEMS_LIMIT_DEFAULT),
});
export type PlaylistItemsQuery = z.infer<typeof PlaylistItemsQuery>;

/** In playlist order. */
export const PlaylistItemsPage = pageOf(PlaylistItem);
export type PlaylistItemsPage = z.infer<typeof PlaylistItemsPage>;

/**
 * `after`: item to insert after; null = at the start; omitted = at the end.
 * A track already in the playlist is refused with 409 DUPLICATE_TRACKS (the `errors` name the
 * `trackIds.<index>`), unless `allowDuplicates` — the client asks "Add it again?" first.
 */
export const AddPlaylistItemsRequest = z.object({
  trackIds: z.array(Id).min(1).max(LIBRARY_LIMITS.batch),
  after: Id.nullable().optional(),
  allowDuplicates: z.boolean().default(false),
});
export type AddPlaylistItemsRequest = z.infer<typeof AddPlaylistItemsRequest>;

export const AddPlaylistItemsResult = LibraryChange.extend({
  playlist: PlaylistSummary,
  items: z.array(PlaylistItem),
});
export type AddPlaylistItemsResult = z.infer<typeof AddPlaylistItemsResult>;

/** `after`: item to put this one after; null = to the start. */
export const MovePlaylistItemRequest = z.object({ after: Id.nullable() });
export type MovePlaylistItemRequest = z.infer<typeof MovePlaylistItemRequest>;
