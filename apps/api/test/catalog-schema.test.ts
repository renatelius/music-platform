import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../dist/db/client.js';
import {
  artists,
  releaseArtists,
  releases,
  sources,
  trackArtists,
  trackAssets,
  trackLoudness,
  trackRights,
  tracks,
} from '../dist/db/schema.js';
import { DB } from '../dist/infra/tokens.js';
import { startTestApp, type TestApp } from './helpers.js';

function first<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error('insert returned no row');
  return row;
}

describe('catalog schema', () => {
  let t: TestApp;
  let db: Database;
  let sourceId: string;
  let artistId: string;

  beforeAll(async () => {
    t = await startTestApp();
    db = t.app.get<Database>(DB);
    sourceId = first(
      await db
        .insert(sources)
        .values({ kind: 'synthetic', name: `test-${randomUUID()}` })
        .returning(),
    ).id;
    artistId = first(
      await db
        .insert(artists)
        .values({ name: 'Test Artist', sourceId, externalId: 'artist-1' })
        .returning(),
    ).id;
  });

  afterAll(async () => {
    await db.delete(releases).where(eq(releases.sourceId, sourceId));
    await db.delete(artists).where(eq(artists.sourceId, sourceId));
    await db.delete(sources).where(eq(sources.id, sourceId));
    await t.close();
  });

  async function createTrack(externalId: string) {
    const release = first(
      await db
        .insert(releases)
        .values({ title: `Release ${externalId}`, sourceId, externalId })
        .returning(),
    );
    await db.insert(releaseArtists).values({ releaseId: release.id, artistId });
    const track = first(
      await db
        .insert(tracks)
        .values({ releaseId: release.id, title: 'Song', sourceId, externalId })
        .returning(),
    );
    await db.insert(trackArtists).values({ trackId: track.id, artistId });
    return { release, track };
  }

  it('creates a track with defaults and keeps imports idempotent by source + external id', async () => {
    const { release, track } = await createTrack(`dup-${randomUUID()}`);
    expect(track.status).toBe('pending');
    expect(track.discNumber).toBe(1);
    expect(track.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);

    await expect(
      db
        .insert(tracks)
        .values({ releaseId: release.id, title: 'Again', sourceId, externalId: track.externalId }),
    ).rejects.toThrow();
    await expect(
      db.insert(artists).values({ name: 'Same', sourceId, externalId: 'artist-1' }),
    ).rejects.toThrow();
  });

  it('allows one rendition per codec and bitrate, treating a null bitrate as a value', async () => {
    const { track } = await createTrack(`assets-${randomUUID()}`);
    const asset = {
      trackId: track.id,
      sampleRateHz: 44_100,
      channels: 2,
      quality: 'lossy' as const,
      sizeBytes: 1024,
    };
    await db.insert(trackAssets).values([
      { ...asset, codec: 'aac', container: 'm4a', bitrateKbps: 96, s3Key: `${track.id}/aac96` },
      { ...asset, codec: 'aac', container: 'm4a', bitrateKbps: 128, s3Key: `${track.id}/aac128` },
      { ...asset, codec: 'flac', container: 'flac', bitrateKbps: null, s3Key: `${track.id}/flac` },
    ]);
    await expect(
      db.insert(trackAssets).values({
        ...asset,
        codec: 'aac',
        container: 'm4a',
        bitrateKbps: 96,
        s3Key: `${track.id}/aac96-again`,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(trackAssets).values({
        ...asset,
        codec: 'flac',
        container: 'flac',
        bitrateKbps: null,
        s3Key: `${track.id}/flac-again`,
      }),
    ).rejects.toThrow();
  });

  it('stores rights with attribution and rejects an inverted validity range', async () => {
    const { track } = await createTrack(`rights-${randomUUID()}`);
    const rights = first(
      await db
        .insert(trackRights)
        .values({
          trackId: track.id,
          sourceId,
          license: 'CC BY 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
          attribution: '"Song" by Test Artist, licensed under CC BY 4.0',
        })
        .returning(),
    );
    expect(rights.allowStream).toBe(true);
    expect(rights.allowOffline).toBe(false);
    expect(rights.territories).toBeNull();

    await expect(
      db.insert(trackRights).values({
        trackId: track.id,
        sourceId,
        license: 'CC BY 4.0',
        attribution: 'x',
        validFrom: new Date('2026-02-01T00:00:00Z'),
        validTo: new Date('2026-01-01T00:00:00Z'),
      }),
    ).rejects.toThrow();
  });

  it('removes tracks, renditions, loudness and rights together with the release', async () => {
    const { release, track } = await createTrack(`cascade-${randomUUID()}`);
    await db.insert(trackAssets).values({
      trackId: track.id,
      codec: 'opus',
      container: 'webm',
      bitrateKbps: 128,
      sampleRateHz: 48_000,
      channels: 2,
      quality: 'lossy',
      s3Key: `${track.id}/opus128`,
      sizeBytes: 2048,
    });
    await db
      .insert(trackLoudness)
      .values({ trackId: track.id, integratedLufs: -14.2, truePeakDbtp: -1.1, replayGainDb: -3.8 });
    await db
      .insert(trackRights)
      .values({ trackId: track.id, sourceId, license: 'CC0 1.0', attribution: 'Song' });

    await db.delete(releases).where(eq(releases.id, release.id));

    expect(await db.select().from(tracks).where(eq(tracks.id, track.id))).toEqual([]);
    expect(await db.select().from(trackAssets).where(eq(trackAssets.trackId, track.id))).toEqual(
      [],
    );
    expect(
      await db.select().from(trackLoudness).where(eq(trackLoudness.trackId, track.id)),
    ).toEqual([]);
    expect(await db.select().from(trackRights).where(eq(trackRights.trackId, track.id))).toEqual(
      [],
    );
  });
});
