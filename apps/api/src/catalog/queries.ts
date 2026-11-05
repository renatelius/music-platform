// Read side of the catalog (ADR-018): home, release, artist, track, search, suggestions.
// Plain functions over the database, used by the API controller and the setup smoke test.
// Every query builds its JSON in PostgreSQL and the result is parsed with the contract schema,
// so a response can never drift from @mp/contracts unnoticed.
import {
  ARTIST_TRACKS_LIMIT,
  ArtistDetail,
  ArtistSummary,
  CatalogHome,
  CatalogStats,
  ReleaseDetail,
  ReleaseSummary,
  type SearchResults,
  StreamSource,
  TrackLoudnessInfo,
  type Suggestion,
  type SuggestResults,
  TrackDto,
} from '@mp/contracts';
import { type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../db/client.js';

// ---------------------------------------------------------------- SQL building blocks
// Table aliases below are constants of this file, never user input, so sql.raw is safe.

/** A right that allows streaming now, worldwide (no territory detection yet). */
const CURRENT_STREAM_RIGHT = (r: string) =>
  `${r}.allow_stream AND ${r}.territories IS NULL` +
  ` AND (${r}.valid_from IS NULL OR ${r}.valid_from <= now())` +
  ` AND (${r}.valid_to IS NULL OR ${r}.valid_to > now())`;

/**
 * Visible = processed, has renditions and a current stream right. Tracks that fail any of
 * these never appear anywhere: not in lists, counts, search or detail pages.
 */
const VISIBLE = (t: string) =>
  `(${t}.status = 'ready' AND ${t}.duration_ms IS NOT NULL` +
  ` AND EXISTS (SELECT 1 FROM track_assets va WHERE va.track_id = ${t}.id)` +
  ` AND EXISTS (SELECT 1 FROM track_rights vr WHERE vr.track_id = ${t}.id AND ${CURRENT_STREAM_RIGHT('vr')}))`;

const RELEASE_VISIBLE = (rl: string) =>
  `EXISTS (SELECT 1 FROM tracks rv WHERE rv.release_id = ${rl}.id AND ${VISIBLE('rv')})`;

const ARTIST_VISIBLE = (a: string) =>
  `EXISTS (SELECT 1 FROM track_artists avta JOIN tracks avt ON avt.id = avta.track_id` +
  ` WHERE avta.artist_id = ${a}.id AND ${VISIBLE('avt')})`;

const ARTISTS_OF = (link: string, column: string, owner: string) =>
  `(SELECT coalesce(json_agg(json_build_object('id', x_ar.id, 'name', x_ar.name)` +
  ` ORDER BY x_l.position, x_ar.name), '[]'::json)` +
  ` FROM ${link} x_l JOIN artists x_ar ON x_ar.id = x_l.artist_id` +
  ` WHERE x_l.${column} = ${owner}.id AND x_l.role = 'main')`;

/** Best rendition first: Hi-Res, lossless, then the highest bitrate. */
const QUALITY_OF = (t: string) =>
  `(SELECT json_build_object('tier', q.quality, 'format', json_build_object(` +
  `'codec', q.codec, 'sampleRateHz', q.sample_rate_hz, 'bitDepth', q.bit_depth,` +
  ` 'bitrateKbps', q.bitrate_kbps, 'channels', q.channels))` +
  ` FROM track_assets q WHERE q.track_id = ${t}.id` +
  ` ORDER BY CASE q.quality WHEN 'hires' THEN 3 WHEN 'lossless' THEN 2 ELSE 1 END DESC,` +
  ` q.bit_depth DESC NULLS LAST, q.sample_rate_hz DESC, q.bitrate_kbps DESC NULLS LAST, q.codec` +
  ` LIMIT 1)`;

const LICENSE_OF = (t: string) =>
  `(SELECT json_build_object('name', lr.license, 'url', lr.license_url,` +
  ` 'attribution', lr.attribution, 'sourceUrl', lr.source_url)` +
  ` FROM track_rights lr WHERE lr.track_id = ${t}.id AND ${CURRENT_STREAM_RIGHT('lr')}` +
  ` ORDER BY lr.created_at DESC, lr.id DESC LIMIT 1)`;

const TRACK_JSON = (t: string) =>
  `json_build_object('id', ${t}.id, 'title', ${t}.title, 'durationMs', ${t}.duration_ms,` +
  ` 'discNumber', ${t}.disc_number, 'trackNumber', ${t}.track_number, 'explicit', ${t}.explicit,` +
  ` 'artists', ${ARTISTS_OF('track_artists', 'track_id', t)},` +
  ` 'release', (SELECT json_build_object('id', tr.id, 'title', tr.title) FROM releases tr WHERE tr.id = ${t}.release_id),` +
  ` 'quality', ${QUALITY_OF(t)}, 'license', ${LICENSE_OF(t)})`;

const RELEASE_JSON = (rl: string) =>
  `json_build_object('id', ${rl}.id, 'title', ${rl}.title, 'type', ${rl}.type,` +
  ` 'releaseDate', ${rl}.release_date, 'artists', ${ARTISTS_OF('release_artists', 'release_id', rl)},` +
  ` 'trackCount', (SELECT count(*) FROM tracks rc WHERE rc.release_id = ${rl}.id AND ${VISIBLE('rc')}),` +
  ` 'durationMs', (SELECT coalesce(sum(rd.duration_ms), 0) FROM tracks rd WHERE rd.release_id = ${rl}.id AND ${VISIBLE('rd')}))`;

const ARTIST_JSON = (a: string) =>
  `json_build_object('id', ${a}.id, 'name', ${a}.name,` +
  ` 'trackCount', (SELECT count(DISTINCT act.id) FROM track_artists acta JOIN tracks act ON act.id = acta.track_id` +
  ` WHERE acta.artist_id = ${a}.id AND ${VISIBLE('act')}),` +
  ` 'releaseCount', (SELECT count(DISTINCT arct.release_id) FROM track_artists arcta JOIN tracks arct ON arct.id = arcta.track_id` +
  ` WHERE arcta.artist_id = ${a}.id AND ${VISIBLE('arct')}))`;

const raw = (text: string): SQL => sql.raw(text);

async function rows<T extends z.ZodType>(
  db: Database,
  schema: T,
  query: SQL,
): Promise<z.output<T>[]> {
  const result = await db.execute<{ data: unknown }>(query);
  return result.rows.map((row) => schema.parse(row.data));
}

async function one<T extends z.ZodType>(
  db: Database,
  schema: T,
  query: SQL,
): Promise<z.output<T> | null> {
  return (await rows(db, schema, query))[0] ?? null;
}

// ---------------------------------------------------------------- pages

export const HOME_LIMITS = { recentReleases: 12, dailyTracks: 10, artists: 12 } as const;

export async function getStats(db: Database): Promise<CatalogStats> {
  const stats = await one(
    db,
    CatalogStats,
    sql`SELECT json_build_object(
      'tracks', (SELECT count(*) FROM tracks t WHERE ${raw(VISIBLE('t'))}),
      'releases', (SELECT count(*) FROM releases rl WHERE ${raw(RELEASE_VISIBLE('rl'))}),
      'artists', (SELECT count(*) FROM artists a WHERE ${raw(ARTIST_VISIBLE('a'))})
    ) AS data`,
  );
  return stats ?? { tracks: 0, releases: 0, artists: 0 };
}

export async function getHome(db: Database): Promise<CatalogHome> {
  const [stats, recentReleases, dailyTracks, artists] = await Promise.all([
    getStats(db),
    rows(
      db,
      ReleaseSummary,
      sql`SELECT ${raw(RELEASE_JSON('rl'))} AS data FROM releases rl
        WHERE ${raw(RELEASE_VISIBLE('rl'))}
        ORDER BY rl.created_at DESC, rl.id DESC LIMIT ${HOME_LIMITS.recentReleases}`,
    ),
    // Changes once a day, the same for everyone: an honest "random pick", not a recommendation.
    rows(
      db,
      TrackDto,
      sql`SELECT ${raw(TRACK_JSON('t'))} AS data FROM tracks t
        WHERE ${raw(VISIBLE('t'))}
        ORDER BY md5(t.id::text || to_char(current_date, 'YYYY-MM-DD')), t.id
        LIMIT ${HOME_LIMITS.dailyTracks}`,
    ),
    rows(
      db,
      ArtistSummary,
      sql`SELECT ${raw(ARTIST_JSON('a'))} AS data FROM artists a
        WHERE ${raw(ARTIST_VISIBLE('a'))}
        ORDER BY (SELECT count(*) FROM track_artists hta JOIN tracks ht ON ht.id = hta.track_id
          WHERE hta.artist_id = a.id AND ${raw(VISIBLE('ht'))}) DESC, a.name, a.id
        LIMIT ${HOME_LIMITS.artists}`,
    ),
  ]);
  return { stats, recentReleases, dailyTracks, artists };
}

const ReleaseRow = ReleaseSummary.extend({ url: ReleaseDetail.shape.url });
const ArtistRow = ArtistSummary.extend({ url: ArtistDetail.shape.url });

/** Null when the release does not exist or has no playable track. */
export async function getRelease(db: Database, id: string): Promise<ReleaseDetail | null> {
  const release = await one(
    db,
    ReleaseRow,
    sql`SELECT (${raw(RELEASE_JSON('rl'))}::jsonb || jsonb_build_object('url', rl.url)) AS data
      FROM releases rl WHERE rl.id = ${id} AND ${raw(RELEASE_VISIBLE('rl'))}`,
  );
  if (release === null) return null;
  const tracks = await rows(
    db,
    TrackDto,
    sql`SELECT ${raw(TRACK_JSON('t'))} AS data FROM tracks t
      WHERE t.release_id = ${id} AND ${raw(VISIBLE('t'))}
      ORDER BY t.disc_number, t.track_number NULLS LAST, t.title, t.id`,
  );
  return { ...release, tracks };
}

/** Null when the artist does not exist or has no playable track. */
export async function getArtist(db: Database, id: string): Promise<ArtistDetail | null> {
  const artist = await one(
    db,
    ArtistRow,
    sql`SELECT (${raw(ARTIST_JSON('a'))}::jsonb || jsonb_build_object('url', a.url)) AS data
      FROM artists a WHERE a.id = ${id} AND ${raw(ARTIST_VISIBLE('a'))}`,
  );
  if (artist === null) return null;
  const [releases, tracks] = await Promise.all([
    rows(
      db,
      ReleaseSummary,
      sql`SELECT ${raw(RELEASE_JSON('rl'))} AS data FROM releases rl
        WHERE EXISTS (SELECT 1 FROM tracks at JOIN track_artists ata ON ata.track_id = at.id
          WHERE at.release_id = rl.id AND ata.artist_id = ${id} AND ${raw(VISIBLE('at'))})
        ORDER BY rl.release_date DESC NULLS LAST, rl.title, rl.id`,
    ),
    rows(
      db,
      TrackDto,
      sql`SELECT ${raw(TRACK_JSON('t'))} AS data FROM tracks t
        JOIN releases trl ON trl.id = t.release_id
        WHERE EXISTS (SELECT 1 FROM track_artists tta WHERE tta.track_id = t.id AND tta.artist_id = ${id})
          AND ${raw(VISIBLE('t'))}
        ORDER BY trl.release_date DESC NULLS LAST, trl.title, t.disc_number,
          t.track_number NULLS LAST, t.title, t.id
        LIMIT ${ARTIST_TRACKS_LIMIT}`,
    ),
  ]);
  return { ...artist, releases, tracks };
}

/** Null when the track does not exist or is not playable. */
export async function getTrack(db: Database, id: string): Promise<TrackDto | null> {
  return one(
    db,
    TrackDto,
    sql`SELECT ${raw(TRACK_JSON('t'))} AS data FROM tracks t WHERE t.id = ${id} AND ${raw(VISIBLE('t'))}`,
  );
}

/** A rendition as stored: the controller turns it into a signed source. */
export const StoredRendition = StreamSource.omit({ mimeType: true, url: true }).extend({
  s3Key: z.string().min(1),
});
export type StoredRendition = z.infer<typeof StoredRendition>;

const TrackStreamRow = z.object({
  durationMs: z.number().int().positive(),
  loudness: TrackLoudnessInfo.nullable(),
  renditions: z.array(StoredRendition),
});
export type TrackStreamData = z.infer<typeof TrackStreamRow>;

/** Renditions and loudness of a playable track, best rendition first; null when not playable. */
export async function getTrackStreamData(
  db: Database,
  id: string,
): Promise<TrackStreamData | null> {
  return one(
    db,
    TrackStreamRow,
    sql`SELECT json_build_object(
      'durationMs', t.duration_ms,
      'loudness', (SELECT json_build_object('integratedLufs', l.integrated_lufs,
          'truePeakDbtp', l.true_peak_dbtp, 'replayGainDb', l.replay_gain_db)
        FROM track_loudness l WHERE l.track_id = t.id),
      'renditions', (SELECT coalesce(json_agg(json_build_object('codec', a.codec,
          'container', a.container, 'bitrateKbps', a.bitrate_kbps, 'sampleRateHz', a.sample_rate_hz,
          'bitDepth', a.bit_depth, 'channels', a.channels, 'quality', a.quality,
          'sizeBytes', a.size_bytes, 's3Key', a.s3_key)
        ORDER BY CASE a.quality WHEN 'hires' THEN 3 WHEN 'lossless' THEN 2 ELSE 1 END DESC,
          a.bit_depth DESC NULLS LAST, a.bitrate_kbps DESC NULLS LAST, a.codec), '[]'::json)
        FROM track_assets a WHERE a.track_id = t.id)
    ) AS data FROM tracks t WHERE t.id = ${id} AND ${raw(VISIBLE('t'))}`,
  );
}

// ---------------------------------------------------------------- search

/** Below this length trigrams say nothing: only word prefixes match. */
const SHORT_QUERY = 3;
/** A track or release found through its artist ranks below a direct title match. */
const VIA_ARTIST = 0.8;

const NORM = (column: string) => `mp_search_norm(${column})`;

/**
 * Word similarity needed for a fuzzy match. pg_trgm's default 0.6 misses one wrong letter in the
 * middle of a word (one typo changes up to three trigrams): 0.4 still finds "zyqwrton" for
 * "Zyqwerton" and "radiohed" for "Radiohead"; weaker matches rank below exact and prefix ones.
 */
const FUZZY_THRESHOLD = 0.4;

/**
 * Match: substring or fuzzy word match (pg_trgm `<%`), both served by the GIN trigram indexes of
 * migration 0003. Short queries match word prefixes only.
 */
const MATCH = (x: string, short: boolean) =>
  short
    ? `((' ' || ${x}) LIKE ('% ' || p.esc || '%'))`
    : `(${x} LIKE ('%' || p.esc || '%') OR p.n <% ${x})`;

/** Exact > prefix > word prefix > substring, plus trigram word similarity. */
const SCORE = (x: string) =>
  `(word_similarity(p.n, ${x}) + CASE WHEN ${x} = p.n THEN 2 WHEN ${x} LIKE (p.esc || '%') THEN 1` +
  ` WHEN (' ' || ${x}) LIKE ('% ' || p.esc || '%') THEN 0.6` +
  ` WHEN ${x} LIKE ('%' || p.esc || '%') THEN 0.3 ELSE 0 END)::float8`;

/** Normalized query and its LIKE-escaped form (user input never becomes a pattern). */
const QUERY_CTE = (q: string): SQL =>
  // chr(92) is the backslash, LIKE's escape character.
  sql`p AS (SELECT n,
      replace(replace(replace(n, chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_') AS esc
    FROM (SELECT mp_search_norm(${q}) AS n) qn)`;

interface Scored<T> {
  readonly score: number;
  readonly item: T;
}

type Executor = Pick<Database, 'execute'>;

/** Runs search queries in a transaction with the fuzzy threshold set for it only. */
function fuzzy<T>(db: Database, run: (tx: Executor) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(FUZZY_THRESHOLD)}, true)`,
    );
    return run(tx);
  });
}

async function scored<T extends z.ZodType>(
  db: Executor,
  schema: T,
  query: SQL,
): Promise<Scored<z.output<T>>[]> {
  const result = await db.execute<{ data: unknown; score: unknown }>(query);
  return result.rows.map((row) => ({
    score: z.number().parse(row.score),
    item: schema.parse(row.data),
  }));
}

function searchArtists(db: Executor, q: string, limit: number, short: boolean) {
  const name = NORM('a.name');
  return scored(
    db,
    ArtistSummary,
    sql`WITH ${QUERY_CTE(q)}
      SELECT ${raw(ARTIST_JSON('a'))} AS data, ${raw(SCORE(name))} AS score
      FROM artists a, p
      WHERE ${raw(MATCH(name, short))} AND ${raw(ARTIST_VISIBLE('a'))}
      ORDER BY score DESC, a.name, a.id LIMIT ${limit}`,
  );
}

function matchedArtists(short: boolean): string {
  const name = NORM('ma_a.name');
  return `ma AS (SELECT ma_a.id, ${SCORE(name)} AS s FROM artists ma_a, p WHERE ${MATCH(name, short)})`;
}

function searchReleases(db: Executor, q: string, limit: number, short: boolean) {
  const title = NORM('h_rl.title');
  return scored(
    db,
    ReleaseSummary,
    sql`WITH ${QUERY_CTE(q)}, ${raw(matchedArtists(short))},
      hits AS (
        SELECT h_rl.id, ${raw(SCORE(title))} AS s FROM releases h_rl, p WHERE ${raw(MATCH(title, short))}
        UNION ALL
        SELECT h_ra.release_id, ma.s * ${raw(String(VIA_ARTIST))} FROM release_artists h_ra JOIN ma ON ma.id = h_ra.artist_id
      ),
      best AS (SELECT id, max(s) AS s FROM hits GROUP BY id)
      SELECT ${raw(RELEASE_JSON('rl'))} AS data, best.s AS score
      FROM best JOIN releases rl ON rl.id = best.id
      WHERE ${raw(RELEASE_VISIBLE('rl'))}
      ORDER BY best.s DESC, rl.title, rl.id LIMIT ${limit}`,
  );
}

function searchTracks(db: Executor, q: string, limit: number, short: boolean) {
  const title = NORM('h_t.title');
  return scored(
    db,
    TrackDto,
    sql`WITH ${QUERY_CTE(q)}, ${raw(matchedArtists(short))},
      hits AS (
        SELECT h_t.id, ${raw(SCORE(title))} AS s FROM tracks h_t, p WHERE ${raw(MATCH(title, short))}
        UNION ALL
        SELECT h_ta.track_id, ma.s * ${raw(String(VIA_ARTIST))} FROM track_artists h_ta JOIN ma ON ma.id = h_ta.artist_id
      ),
      best AS (SELECT id, max(s) AS s FROM hits GROUP BY id)
      SELECT ${raw(TRACK_JSON('t'))} AS data, best.s AS score
      FROM best JOIN tracks t ON t.id = best.id
      WHERE ${raw(VISIBLE('t'))}
      ORDER BY best.s DESC, t.title, t.id LIMIT ${limit}`,
  );
}

async function searchScored(db: Database, q: string, limit: number) {
  const short = q.length < SHORT_QUERY;
  const [artists, releases, tracks] = await Promise.all([
    fuzzy(db, (tx) => searchArtists(tx, q, limit, short)),
    fuzzy(db, (tx) => searchReleases(tx, q, limit, short)),
    fuzzy(db, (tx) => searchTracks(tx, q, limit, short)),
  ]);
  return { artists, releases, tracks };
}

/** `q` must already be normalized by the `SearchText` contract. */
export async function search(db: Database, q: string, limit: number): Promise<SearchResults> {
  const found = await searchScored(db, q, limit);
  return {
    query: q,
    artists: found.artists.map((hit) => hit.item),
    releases: found.releases.map((hit) => hit.item),
    tracks: found.tracks.map((hit) => hit.item),
  };
}

const KIND_ORDER: Readonly<Record<Suggestion['kind'], number>> = {
  artist: 0,
  release: 1,
  track: 2,
};
const names = (artists: readonly { name: string }[]): string | null =>
  artists.length === 0 ? null : artists.map((artist) => artist.name).join(', ');

/** Mixed artists, releases and tracks, best match first (for the search box). */
export async function suggest(db: Database, q: string, limit: number): Promise<SuggestResults> {
  const found = await searchScored(db, q, limit);
  const all: (Scored<Suggestion> & { order: number })[] = [
    ...found.artists.map((hit) => ({
      score: hit.score,
      order: KIND_ORDER.artist,
      item: {
        kind: 'artist' as const,
        id: hit.item.id,
        title: hit.item.name,
        subtitle: null,
        releaseId: null,
      },
    })),
    ...found.releases.map((hit) => ({
      score: hit.score,
      order: KIND_ORDER.release,
      item: {
        kind: 'release' as const,
        id: hit.item.id,
        title: hit.item.title,
        subtitle: names(hit.item.artists),
        releaseId: hit.item.id,
      },
    })),
    ...found.tracks.map((hit) => ({
      score: hit.score,
      order: KIND_ORDER.track,
      item: {
        kind: 'track' as const,
        id: hit.item.id,
        title: hit.item.title,
        subtitle: names(hit.item.artists),
        releaseId: hit.item.release.id,
      },
    })),
  ];
  all.sort(
    (a, b) => b.score - a.score || a.order - b.order || a.item.title.localeCompare(b.item.title),
  );
  return { query: q, items: all.slice(0, limit).map((entry) => entry.item) };
}
