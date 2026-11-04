/**
 * Database schema — source of truth for migrations (`pnpm db:generate`).
 * Keep this file free of relative imports: drizzle-kit loads it directly.
 *
 * Conventions: UUID v7 primary keys (PostgreSQL 18 `uuidv7()`), timestamptz everywhere,
 * snake_case columns, secrets stored only as hashes.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
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
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

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

// ---------------------------------------------------------------------------
// Catalog and rights (I4, ARCHITECTURE.md §5, ADR-017).
// Every catalog row remembers where it came from (`source_id` + `external_id`), so an
// import can run again without creating duplicates.
// ---------------------------------------------------------------------------

export const sourceKind = pgEnum('source_kind', [
  'fma',
  'jamendo',
  'label',
  'artist_upload',
  'user_upload',
  'synthetic',
]);

/** Where catalog content comes from: one row per provider (e.g. FMA via Hugging Face). */
export const sources = pgTable(
  'sources',
  {
    id: id(),
    kind: sourceKind('kind').notNull(),
    name: text('name').notNull(),
    url: text('url'),
    createdAt: createdAt(),
  },
  (t) => [unique('sources_kind_name_unique').on(t.kind, t.name)],
);

export const artists = pgTable(
  'artists',
  {
    id: id(),
    name: text('name').notNull(),
    /** Profile page at the source (FMA artist page), shown in attribution. */
    url: text('url'),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'restrict' }),
    externalId: text('external_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('artists_source_external_unique').on(t.sourceId, t.externalId)],
);

export const releaseType = pgEnum('release_type', ['album', 'single', 'ep', 'compilation', 'live']);

export const releases = pgTable(
  'releases',
  {
    id: id(),
    title: text('title').notNull(),
    type: releaseType('type').notNull().default('album'),
    releaseDate: date('release_date', { mode: 'string' }),
    url: text('url'),
    /** S3 key prefix of the cover in `mp-media` (sizes are added by the worker). */
    coverKey: text('cover_key'),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'restrict' }),
    externalId: text('external_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('releases_source_external_unique').on(t.sourceId, t.externalId)],
);

export const artistRole = pgEnum('artist_role', [
  'main',
  'featured',
  'remixer',
  'composer',
  'lyricist',
  'producer',
]);

export const releaseArtists = pgTable(
  'release_artists',
  {
    releaseId: uuid('release_id')
      .notNull()
      .references(() => releases.id, { onDelete: 'cascade' }),
    artistId: uuid('artist_id')
      .notNull()
      .references(() => artists.id, { onDelete: 'restrict' }),
    role: artistRole('role').notNull().default('main'),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.releaseId, t.artistId, t.role] }),
    index('release_artists_artist_id_idx').on(t.artistId),
  ],
);

export const trackStatus = pgEnum('track_status', ['pending', 'processing', 'ready', 'failed']);

/** Same values as `AudioCodec` in @mp/contracts. */
export const audioCodec = pgEnum('audio_codec', [
  'mp3',
  'aac',
  'opus',
  'vorbis',
  'flac',
  'alac',
  'pcm',
]);

/** Same values as `QualityTier` in @mp/contracts. */
export const qualityTier = pgEnum('quality_tier', ['lossy', 'lossless', 'hires']);

export const tracks = pgTable(
  'tracks',
  {
    id: id(),
    releaseId: uuid('release_id')
      .notNull()
      .references(() => releases.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    discNumber: integer('disc_number').notNull().default(1),
    trackNumber: integer('track_number'),
    /** Set by the worker from ffprobe; null until processed. */
    durationMs: integer('duration_ms'),
    explicit: boolean('explicit').notNull().default(false),
    instrumental: boolean('instrumental'),
    isrc: text('isrc'),
    status: trackStatus('status').notNull().default('pending'),
    /** Why processing failed (corrupt file, silence, too short…), for the import report. */
    failureReason: text('failure_reason'),
    /** Original file in `mp-masters`, never modified. */
    masterKey: text('master_key'),
    // Format of the original — the cap for every rendition and the input of classifyQuality.
    sourceCodec: audioCodec('source_codec'),
    sourceSampleRateHz: integer('source_sample_rate_hz'),
    sourceBitDepth: integer('source_bit_depth'),
    sourceBitrateKbps: integer('source_bitrate_kbps'),
    sourceChannels: integer('source_channels'),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'restrict' }),
    externalId: text('external_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('tracks_source_external_unique').on(t.sourceId, t.externalId),
    index('tracks_release_id_idx').on(t.releaseId),
    index('tracks_status_idx').on(t.status),
  ],
);

export const trackArtists = pgTable(
  'track_artists',
  {
    trackId: uuid('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    artistId: uuid('artist_id')
      .notNull()
      .references(() => artists.id, { onDelete: 'restrict' }),
    role: artistRole('role').notNull().default('main'),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.trackId, t.artistId, t.role] }),
    index('track_artists_artist_id_idx').on(t.artistId),
  ],
);

/** Transcoded renditions in `mp-media`. One row = one file in S3. */
export const trackAssets = pgTable(
  'track_assets',
  {
    id: id(),
    trackId: uuid('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    codec: audioCodec('codec').notNull(),
    /** m4a, webm, ogg, flac… */
    container: text('container').notNull(),
    /** Null for lossless codecs. */
    bitrateKbps: integer('bitrate_kbps'),
    sampleRateHz: integer('sample_rate_hz').notNull(),
    bitDepth: integer('bit_depth'),
    channels: integer('channels').notNull(),
    /** classifyQuality(rendition, source) — never claims more than the source has. */
    quality: qualityTier('quality').notNull(),
    s3Key: text('s3_key').notNull().unique(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('track_assets_track_format_unique')
      .on(t.trackId, t.codec, t.bitrateKbps)
      .nullsNotDistinct(),
  ],
);

/** EBU R128 measurement of the original, used for ReplayGain in the player. */
export const trackLoudness = pgTable('track_loudness', {
  trackId: uuid('track_id')
    .primaryKey()
    .references(() => tracks.id, { onDelete: 'cascade' }),
  integratedLufs: real('integrated_lufs').notNull(),
  truePeakDbtp: real('true_peak_dbtp').notNull(),
  loudnessRangeLu: real('loudness_range_lu'),
  /** Gain to reach the ReplayGain 2.0 reference (-18 LUFS). */
  replayGainDb: real('replay_gain_db').notNull(),
  measuredAt: timestamp('measured_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Permission to play a track. No row allowing a mode = the track is not played in that mode
 * (ARCHITECTURE.md §1.4). Attribution is mandatory: CC BY / BY-SA require it.
 */
export const trackRights = pgTable(
  'track_rights',
  {
    id: id(),
    trackId: uuid('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'restrict' }),
    /** Canonical name, e.g. "CC BY 4.0", "CC0 1.0". */
    license: text('license').notNull(),
    licenseUrl: text('license_url'),
    /** Ready-to-show credit line: «"Title" by Artist, licensed under CC BY 4.0». */
    attribution: text('attribution').notNull(),
    /** Page of the track at the source. */
    sourceUrl: text('source_url'),
    /** ISO 3166-1 alpha-2 codes; null = worldwide. */
    territories: text('territories').array(),
    allowStream: boolean('allow_stream').notNull().default(true),
    allowOffline: boolean('allow_offline').notNull().default(false),
    allowPreview: boolean('allow_preview').notNull().default(true),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validTo: timestamp('valid_to', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('track_rights_track_id_idx').on(t.trackId),
    check(
      'track_rights_valid_range',
      sql`${t.validTo} IS NULL OR ${t.validFrom} IS NULL OR ${t.validTo} > ${t.validFrom}`,
    ),
  ],
);
