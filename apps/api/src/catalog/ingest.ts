// Writes imported catalog entries (ADR-017). Source adapters (tools/catalog-import) map their
// data to CatalogEntry; every database write of an import lives here, so imports stay
// idempotent: rows are found again by source + external id and updated, never duplicated.
import { isOpenLicense, type OpenLicense } from '@mp/contracts';
import { and, eq, sql } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import {
  artists,
  releaseArtists,
  releases,
  sources,
  trackArtists,
  trackAssets,
  trackRights,
  tracks,
} from '../db/schema.js';

export type SourceKind = (typeof sources.$inferInsert)['kind'];
export type ReleaseType = NonNullable<(typeof releases.$inferInsert)['type']>;
export type TrackStatus = (typeof tracks.$inferSelect)['status'];

export interface SourceInfo {
  readonly kind: SourceKind;
  /** Stable name: a re-import finds its earlier rows through it. */
  readonly name: string;
  readonly url: string | null;
}

export interface CatalogEntry {
  /** Id of the track at the source (for FMA: the path of the track page). */
  readonly externalId: string;
  readonly title: string;
  readonly explicit: boolean;
  readonly instrumental: boolean | null;
  readonly artist: {
    readonly externalId: string;
    readonly name: string;
    readonly url: string | null;
  };
  readonly release: {
    readonly externalId: string;
    readonly title: string;
    readonly type: ReleaseType;
    /** YYYY-MM-DD */
    readonly releaseDate: string | null;
    readonly url: string | null;
  };
  readonly rights: {
    readonly license: OpenLicense;
    readonly licenseUrl: string;
    readonly attribution: string;
    readonly sourceUrl: string;
    readonly allowOffline: boolean;
  };
}

export interface StoredTrack {
  readonly id: string;
  readonly status: TrackStatus;
  readonly failureReason: string | null;
  readonly masterKey: string | null;
  readonly releaseExternalId: string;
}

export interface UpsertedTrack extends StoredTrack {
  /** False when the track already existed and was only updated. */
  readonly created: boolean;
}

export async function ensureSource(db: Database, info: SourceInfo): Promise<string> {
  const [row] = await db
    .insert(sources)
    .values({ kind: info.kind, name: info.name, url: info.url })
    .onConflictDoUpdate({ target: [sources.kind, sources.name], set: { url: info.url } })
    .returning({ id: sources.id });
  if (row === undefined) throw new Error('Source upsert returned no row');
  return row.id;
}

/** Every track of a source by external id, with the external id of its release. */
export async function loadSourceTracks(
  db: Database,
  sourceId: string,
): Promise<Map<string, StoredTrack>> {
  const rows = await db
    .select({
      externalId: tracks.externalId,
      id: tracks.id,
      status: tracks.status,
      failureReason: tracks.failureReason,
      masterKey: tracks.masterKey,
      releaseExternalId: releases.externalId,
    })
    .from(tracks)
    .innerJoin(releases, eq(releases.id, tracks.releaseId))
    .where(eq(tracks.sourceId, sourceId));
  return new Map<string, StoredTrack>(rows.map(({ externalId, ...track }) => [externalId, track]));
}

/**
 * Creates or updates artist, release, track and their links in one transaction.
 * The rights of the track from this source are replaced: the source is the authority on them.
 * Status, master and renditions of an existing track are left alone.
 */
export async function upsertCatalogTrack(
  db: Database,
  sourceId: string,
  entry: CatalogEntry,
): Promise<UpsertedTrack> {
  return db.transaction(async (tx) => {
    const artistValues = { name: entry.artist.name, url: entry.artist.url };
    const [artist] = await tx
      .insert(artists)
      .values({ ...artistValues, sourceId, externalId: entry.artist.externalId })
      .onConflictDoUpdate({ target: [artists.sourceId, artists.externalId], set: artistValues })
      .returning({ id: artists.id });
    if (artist === undefined) throw new Error('Artist upsert returned no row');

    const releaseValues = {
      title: entry.release.title,
      type: entry.release.type,
      releaseDate: entry.release.releaseDate,
      url: entry.release.url,
    };
    const [release] = await tx
      .insert(releases)
      .values({ ...releaseValues, sourceId, externalId: entry.release.externalId })
      .onConflictDoUpdate({ target: [releases.sourceId, releases.externalId], set: releaseValues })
      .returning({ id: releases.id });
    if (release === undefined) throw new Error('Release upsert returned no row');
    await tx
      .insert(releaseArtists)
      .values({ releaseId: release.id, artistId: artist.id })
      .onConflictDoNothing();

    const trackValues = {
      releaseId: release.id,
      title: entry.title,
      explicit: entry.explicit,
      instrumental: entry.instrumental,
    };
    const [track] = await tx
      .insert(tracks)
      .values({ ...trackValues, sourceId, externalId: entry.externalId })
      .onConflictDoUpdate({ target: [tracks.sourceId, tracks.externalId], set: trackValues })
      .returning({
        id: tracks.id,
        status: tracks.status,
        failureReason: tracks.failureReason,
        masterKey: tracks.masterKey,
        // xmax is 0 only for a freshly inserted row version.
        created: sql<boolean>`(xmax = 0)`,
      });
    if (track === undefined) throw new Error('Track upsert returned no row');
    await tx
      .insert(trackArtists)
      .values({ trackId: track.id, artistId: artist.id })
      .onConflictDoNothing();

    await tx
      .delete(trackRights)
      .where(and(eq(trackRights.trackId, track.id), eq(trackRights.sourceId, sourceId)));
    await tx.insert(trackRights).values({
      trackId: track.id,
      sourceId,
      license: entry.rights.license,
      licenseUrl: entry.rights.licenseUrl,
      attribution: entry.rights.attribution,
      sourceUrl: entry.rights.sourceUrl,
      allowOffline: entry.rights.allowOffline,
    });

    return { ...track, releaseExternalId: entry.release.externalId };
  });
}

/** Points the track at its uploaded original and queues it for (re)processing. */
export async function attachMaster(
  db: Database,
  trackId: string,
  masterKey: string,
): Promise<void> {
  await db
    .update(tracks)
    .set({ masterKey, status: 'pending', failureReason: null })
    .where(eq(tracks.id, trackId));
}

export interface CatalogViolations {
  /** Rights rows (any track status) with a license outside the open-license allow list. */
  readonly disallowedLicense: number;
  readonly readyWithoutRights: number;
  readonly missingLicenseUrl: number;
  readonly missingAttribution: number;
  readonly missingSourceUrl: number;
  readonly readyWithoutRenditions: number;
}

export interface CatalogCheck {
  readonly tracks: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly failures: Readonly<Record<string, number>>;
  readonly readyByLicense: Readonly<Record<string, number>>;
  readonly violations: CatalogViolations;
  /** Renditions of ready tracks: the caller checks that each object exists in S3. */
  readonly assets: readonly { trackId: string; s3Key: string; sizeBytes: number }[];
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Status, rights and renditions of every track of a source, with rule violations counted. */
export async function checkCatalog(db: Database, sourceId: string): Promise<CatalogCheck> {
  const rows = await db
    .select({
      id: tracks.id,
      status: tracks.status,
      failureReason: tracks.failureReason,
      license: trackRights.license,
      licenseUrl: trackRights.licenseUrl,
      attribution: trackRights.attribution,
      sourceUrl: trackRights.sourceUrl,
    })
    .from(tracks)
    .leftJoin(trackRights, eq(trackRights.trackId, tracks.id))
    .where(eq(tracks.sourceId, sourceId));
  const assets = await db
    .select({
      trackId: trackAssets.trackId,
      s3Key: trackAssets.s3Key,
      sizeBytes: trackAssets.sizeBytes,
    })
    .from(trackAssets)
    .innerJoin(tracks, eq(tracks.id, trackAssets.trackId))
    .where(and(eq(tracks.sourceId, sourceId), eq(tracks.status, 'ready')));

  const statusById = new Map<string, TrackStatus>();
  const failures: Record<string, number> = {};
  const readyByLicense: Record<string, number> = {};
  const withRights = new Set<string>();
  let disallowedLicense = 0;
  let missingLicenseUrl = 0;
  let missingAttribution = 0;
  let missingSourceUrl = 0;

  for (const row of rows) {
    if (!statusById.has(row.id)) {
      statusById.set(row.id, row.status);
      if (row.status === 'failed') increment(failures, row.failureReason ?? 'unknown');
    }
    if (row.license === null) continue;
    withRights.add(row.id);
    if (!isOpenLicense(row.license)) disallowedLicense += 1;
    if (row.status !== 'ready') continue;
    increment(readyByLicense, row.license);
    if (row.licenseUrl === null || row.licenseUrl === '') missingLicenseUrl += 1;
    if (row.attribution === null || row.attribution.trim() === '') missingAttribution += 1;
    if (row.sourceUrl === null || row.sourceUrl === '') missingSourceUrl += 1;
  }

  const byStatus: Record<string, number> = {};
  const withRenditions = new Set(assets.map((asset) => asset.trackId));
  let readyWithoutRights = 0;
  let readyWithoutRenditions = 0;
  for (const [id, status] of statusById) {
    increment(byStatus, status);
    if (status !== 'ready') continue;
    if (!withRights.has(id)) readyWithoutRights += 1;
    if (!withRenditions.has(id)) readyWithoutRenditions += 1;
  }

  return {
    tracks: statusById.size,
    byStatus,
    failures,
    readyByLicense,
    violations: {
      disallowedLicense,
      readyWithoutRights,
      missingLicenseUrl,
      missingAttribution,
      missingSourceUrl,
      readyWithoutRenditions,
    },
    assets,
  };
}

/**
 * Removes a source with all its releases, tracks, artists and rights (tests, a botched import).
 * Returns the ids of the removed tracks so the caller can delete their S3 objects.
 */
export async function deleteSourceCatalog(db: Database, sourceId: string): Promise<string[]> {
  const rows = await db.select({ id: tracks.id }).from(tracks).where(eq(tracks.sourceId, sourceId));
  await db.transaction(async (tx) => {
    await tx.delete(releases).where(eq(releases.sourceId, sourceId));
    await tx.delete(tracks).where(eq(tracks.sourceId, sourceId));
    await tx.delete(artists).where(eq(artists.sourceId, sourceId));
    await tx.delete(sources).where(eq(sources.id, sourceId));
  });
  return rows.map((row) => row.id);
}
