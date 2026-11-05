// Catalog writes used by the importer (tools/catalog-import) on the real test database.
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  attachMaster,
  type CatalogEntry,
  checkCatalog,
  deleteSourceCatalog,
  ensureSource,
  loadSourceTracks,
  upsertCatalogTrack,
} from '../dist/catalog/ingest.js';
import { loadConfig } from '../dist/config/env.js';
import { createDb, createPool, type Database } from '../dist/db/client.js';
import {
  artists,
  releaseArtists,
  releases,
  sources,
  trackArtists,
  trackAssets,
  trackRights,
  tracks,
} from '../dist/db/schema.js';

function entry(externalId: string, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    externalId,
    title: 'Song',
    explicit: false,
    instrumental: true,
    artist: { externalId: '/music/Artist', name: 'Artist', url: 'https://example.org/artist' },
    release: {
      externalId: '/music/Artist/Album',
      title: 'Album',
      type: 'album',
      releaseDate: '2015-03-01',
      url: 'https://example.org/album',
    },
    rights: {
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      attribution: '"Song" by Artist, licensed under CC BY 4.0',
      sourceUrl: `https://example.org${externalId}`,
      allowOffline: true,
    },
    ...overrides,
  };
}

describe('catalog ingest', () => {
  let pool: ReturnType<typeof createPool>;
  let db: Database;
  let sourceId: string;
  const info = { kind: 'synthetic' as const, name: `ingest-test-${randomUUID()}`, url: null };

  beforeAll(async () => {
    pool = createPool(loadConfig(process.env).db.url, 4);
    db = createDb(pool);
    sourceId = await ensureSource(db, info);
  });

  afterAll(async () => {
    await deleteSourceCatalog(db, sourceId).catch(() => []);
    await pool.end();
  });

  it('finds the same source again by kind and name', async () => {
    expect(await ensureSource(db, info)).toBe(sourceId);
  });

  it('creates artist, release, track, links and rights, and updates them on re-import', async () => {
    const first = await upsertCatalogTrack(db, sourceId, entry('/music/Artist/Album/Song'));
    expect(first).toMatchObject({ created: true, status: 'pending', masterKey: null });

    const again = await upsertCatalogTrack(
      db,
      sourceId,
      entry('/music/Artist/Album/Song', {
        title: 'Song (Remastered)',
        rights: {
          ...entry('/music/Artist/Album/Song').rights,
          license: 'CC BY-SA 4.0',
          attribution: 'updated',
        },
      }),
    );
    expect(again.id).toBe(first.id);
    expect(again.created).toBe(false);

    const [track] = await db.select().from(tracks).where(eq(tracks.id, first.id));
    expect(track?.title).toBe('Song (Remastered)');
    expect(await db.select().from(artists).where(eq(artists.sourceId, sourceId))).toHaveLength(1);
    const [release] = await db.select().from(releases).where(eq(releases.sourceId, sourceId));
    expect(release).toMatchObject({ title: 'Album', type: 'album', releaseDate: '2015-03-01' });
    expect(
      await db
        .select()
        .from(releaseArtists)
        .where(eq(releaseArtists.releaseId, release?.id ?? '')),
    ).toHaveLength(1);
    expect(
      await db.select().from(trackArtists).where(eq(trackArtists.trackId, first.id)),
    ).toHaveLength(1);

    const rights = await db.select().from(trackRights).where(eq(trackRights.trackId, first.id));
    expect(rights).toHaveLength(1);
    expect(rights[0]).toMatchObject({
      license: 'CC BY-SA 4.0',
      attribution: 'updated',
      allowStream: true,
      allowOffline: true,
      sourceUrl: 'https://example.org/music/Artist/Album/Song',
    });
  });

  it('lists the tracks of a source and attaches a master', async () => {
    const created = await upsertCatalogTrack(db, sourceId, entry('/music/Artist/Album/Second'));
    await attachMaster(db, created.id, `tracks/${created.id}/original.mp3`);
    const stored = await loadSourceTracks(db, sourceId);
    expect(stored.get('/music/Artist/Album/Second')).toEqual({
      id: created.id,
      status: 'pending',
      failureReason: null,
      masterKey: `tracks/${created.id}/original.mp3`,
      releaseExternalId: '/music/Artist/Album',
    });
  });

  it('counts tracks that break the catalog rules', async () => {
    const closed = await upsertCatalogTrack(db, sourceId, entry('/music/Artist/Album/Closed'));
    await db
      .update(trackRights)
      .set({ license: 'CC BY-NC 4.0' })
      .where(eq(trackRights.trackId, closed.id));

    const bare = await upsertCatalogTrack(db, sourceId, entry('/music/Artist/Album/Bare'));
    await db.delete(trackRights).where(eq(trackRights.trackId, bare.id));
    await db.update(tracks).set({ status: 'ready' }).where(eq(tracks.id, bare.id));

    const good = await upsertCatalogTrack(db, sourceId, entry('/music/Artist/Album/Good'));
    await db.update(tracks).set({ status: 'ready' }).where(eq(tracks.id, good.id));
    await db.insert(trackAssets).values({
      trackId: good.id,
      codec: 'aac',
      container: 'm4a',
      bitrateKbps: 96,
      sampleRateHz: 44_100,
      channels: 2,
      quality: 'lossy',
      s3Key: `tracks/${good.id}/aac-96.m4a`,
      sizeBytes: 1234,
    });

    const failed = await upsertCatalogTrack(db, sourceId, entry('/music/Artist/Album/Failed'));
    await db
      .update(tracks)
      .set({ status: 'failed', failureReason: 'silence' })
      .where(eq(tracks.id, failed.id));

    const check = await checkCatalog(db, sourceId);
    expect(check.violations).toEqual({
      disallowedLicense: 1,
      readyWithoutRights: 1,
      missingLicenseUrl: 0,
      missingAttribution: 0,
      missingSourceUrl: 0,
      readyWithoutRenditions: 1,
    });
    expect(check.byStatus.ready).toBe(2);
    expect(check.failures).toEqual({ silence: 1 });
    expect(check.readyByLicense).toEqual({ 'CC BY 4.0': 1 });
    expect(check.assets).toEqual([
      { trackId: good.id, s3Key: `tracks/${good.id}/aac-96.m4a`, sizeBytes: 1234 },
    ]);
  });

  it('deletes a whole source with its catalog', async () => {
    const other = await ensureSource(db, { ...info, name: `${info.name}-delete` });
    const { id } = await upsertCatalogTrack(db, other, entry('/music/Artist/Album/Gone'));
    expect(await deleteSourceCatalog(db, other)).toEqual([id]);
    expect(await db.select().from(tracks).where(eq(tracks.id, id))).toEqual([]);
    expect(await db.select().from(sources).where(eq(sources.id, other))).toEqual([]);
  });
});
