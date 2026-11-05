// Catalog API on the real test database: visibility rules, pages, search and suggestions.
import { randomUUID } from 'node:crypto';

import {
  ArtistDetail,
  AuthResponse,
  CatalogHome,
  ProblemDetails,
  ReleaseDetail,
  SearchResults,
  SuggestResults,
  TrackDto,
} from '@mp/contracts';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type CatalogEntry,
  deleteSourceCatalog,
  ensureSource,
  upsertCatalogTrack,
} from '../dist/catalog/ingest.js';
import type { Database } from '../dist/db/client.js';
import { artists, trackAssets, trackRights, tracks } from '../dist/db/schema.js';
import { DB } from '../dist/infra/tokens.js';
import { startTestApp, type TestApp } from './helpers.js';

const ARTIST_A = 'Zyqwerton Quartet';
const ARTIST_B = 'Ёлка Тестова';
const ARTIST_C = 'Plumbago Ghost';

function entry(
  title: string,
  artist: string,
  release: string,
  license: 'CC BY 4.0' | 'CC0 1.0' = 'CC BY 4.0',
): CatalogEntry {
  const slug = (text: string) => encodeURIComponent(text.replace(/ /g, '_'));
  return {
    externalId: `/test/${slug(artist)}/${slug(release)}/${slug(title)}`,
    title,
    explicit: false,
    instrumental: null,
    artist: {
      externalId: `/test/${slug(artist)}`,
      name: artist,
      url: 'https://example.org/artist',
    },
    release: {
      externalId: `/test/${slug(artist)}/${slug(release)}`,
      title: release,
      type: 'album',
      releaseDate: '2016-04-01',
      url: 'https://example.org/release',
    },
    rights: {
      license,
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      attribution: `"${title}" by ${artist}, licensed under ${license}`,
      sourceUrl: 'https://example.org/track',
      allowOffline: true,
    },
  };
}

describe('catalog API', () => {
  let t: TestApp;
  let db: Database;
  let sourceId: string;
  let token: string;
  const ids: Record<string, string> = {};

  async function get(path: string, auth = true): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${t.url}${path}`, {
      headers: auth ? { authorization: `Bearer ${token}` } : {},
    });
    return { status: res.status, body: await res.json() };
  }

  const id = (name: string): string => {
    const value = ids[name];
    if (value === undefined) throw new Error(`no id ${name}`);
    return value;
  };

  async function addTrack(
    name: string,
    data: CatalogEntry,
    state: 'visible' | 'failed' | 'no-stream' | 'territory' | 'no-assets',
  ) {
    const track = await upsertCatalogTrack(db, sourceId, data);
    ids[name] = track.id;
    if (state === 'failed') {
      await db
        .update(tracks)
        .set({ status: 'failed', failureReason: 'silence' })
        .where(eq(tracks.id, track.id));
      return track.id;
    }
    await db
      .update(tracks)
      .set({ status: 'ready', durationMs: 200_000 })
      .where(eq(tracks.id, track.id));
    if (state !== 'no-assets') {
      const asset = {
        trackId: track.id,
        sampleRateHz: 44_100,
        channels: 2,
        quality: 'lossy' as const,
        sizeBytes: 1000,
        bitrateKbps: 128,
      };
      await db.insert(trackAssets).values([
        { ...asset, codec: 'opus', container: 'webm', s3Key: `test/${track.id}/opus-128.webm` },
        { ...asset, codec: 'aac', container: 'm4a', s3Key: `test/${track.id}/aac-128.m4a` },
        {
          ...asset,
          codec: 'aac',
          container: 'm4a',
          bitrateKbps: 96,
          s3Key: `test/${track.id}/aac-96.m4a`,
        },
      ]);
    }
    if (state === 'no-stream') {
      await db
        .update(trackRights)
        .set({ allowStream: false })
        .where(eq(trackRights.trackId, track.id));
    }
    if (state === 'territory') {
      await db
        .update(trackRights)
        .set({ territories: ['US'] })
        .where(eq(trackRights.trackId, track.id));
    }
    return track.id;
  }

  beforeAll(async () => {
    t = await startTestApp();
    db = t.app.get<Database>(DB);
    sourceId = await ensureSource(db, {
      kind: 'synthetic',
      name: `catalog-api-test-${randomUUID()}`,
      url: null,
    });
    await addTrack('moonlight', entry('Moonlight', ARTIST_A, 'Glacier Songs'), 'visible');
    await addTrack('noStream', entry('No Stream Right', ARTIST_A, 'Glacier Songs'), 'no-stream');
    await addTrack('territory', entry('Territory Locked', ARTIST_A, 'Glacier Songs'), 'territory');
    await addTrack('noAssets', entry('No Renditions', ARTIST_A, 'Glacier Songs'), 'no-assets');
    await addTrack(
      'etude',
      entry('Beyoncé Étude', ARTIST_B, 'Северное сияние', 'CC0 1.0'),
      'visible',
    );
    await addTrack('hidden', entry('Plumbago Hidden', ARTIST_C, 'Only Hidden Release'), 'failed');

    const [moonlight] = await db
      .select({ releaseId: tracks.releaseId })
      .from(tracks)
      .where(eq(tracks.id, id('moonlight')));
    const [etude] = await db
      .select({ releaseId: tracks.releaseId })
      .from(tracks)
      .where(eq(tracks.id, id('etude')));
    const [hidden] = await db
      .select({ releaseId: tracks.releaseId })
      .from(tracks)
      .where(eq(tracks.id, id('hidden')));
    ids.glacier = moonlight?.releaseId ?? '';
    ids.aurora = etude?.releaseId ?? '';
    ids.hiddenRelease = hidden?.releaseId ?? '';

    const res = await fetch(`${t.url}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `catalog-${randomUUID()}@example.test`,
        password: 'correct horse battery staple',
        displayName: 'Listener',
      }),
    });
    expect(res.status).toBe(201);
    token = AuthResponse.parse(await res.json()).accessToken;
  });

  afterAll(async () => {
    await deleteSourceCatalog(db, sourceId).catch(() => []);
    await t.close();
  });

  it('requires a signed-in user', async () => {
    for (const path of [
      '/catalog/home',
      '/catalog/search?q=moon',
      `/catalog/tracks/${randomUUID()}`,
    ]) {
      const res = await get(path, false);
      expect(res.status, path).toBe(401);
      expect(ProblemDetails.parse(res.body).code).toBe('UNAUTHENTICATED');
    }
  });

  it('home lists only playable releases and counts only playable tracks', async () => {
    const res = await get('/catalog/home');
    expect(res.status).toBe(200);
    const home = CatalogHome.parse(res.body);
    expect(home.stats.tracks).toBeGreaterThanOrEqual(2);
    const recent = home.recentReleases.map((release) => release.id);
    expect(recent).toContain(id('glacier'));
    expect(recent).toContain(id('aurora'));
    expect(recent).not.toContain(id('hiddenRelease'));
    const glacier = home.recentReleases.find((release) => release.id === id('glacier'));
    expect(glacier).toMatchObject({
      trackCount: 1,
      durationMs: 200_000,
      releaseDate: '2016-04-01',
    });
    expect(glacier?.artists.map((artist) => artist.name)).toEqual([ARTIST_A]);
    expect(home.dailyTracks.length).toBeGreaterThan(0);
    const daily = home.dailyTracks.map((track) => track.id);
    for (const hidden of ['noStream', 'territory', 'noAssets', 'hidden']) {
      expect(daily).not.toContain(id(hidden));
    }
  });

  it('shows a release with its playable tracks, license and best quality', async () => {
    const res = await get(`/catalog/releases/${id('glacier')}`);
    expect(res.status).toBe(200);
    const release = ReleaseDetail.parse(res.body);
    expect(release).toMatchObject({
      title: 'Glacier Songs',
      type: 'album',
      trackCount: 1,
      url: 'https://example.org/release',
    });
    expect(release.tracks).toHaveLength(1);
    const [track] = release.tracks;
    expect(track).toMatchObject({
      id: id('moonlight'),
      title: 'Moonlight',
      durationMs: 200_000,
      artists: [{ name: ARTIST_A }],
      release: { id: id('glacier'), title: 'Glacier Songs' },
      quality: { tier: 'lossy', format: { codec: 'aac', bitrateKbps: 128, sampleRateHz: 44_100 } },
      license: {
        name: 'CC BY 4.0',
        url: 'https://creativecommons.org/licenses/by/4.0/',
        attribution: `"Moonlight" by ${ARTIST_A}, licensed under CC BY 4.0`,
        sourceUrl: 'https://example.org/track',
      },
    });
  });

  it('answers 404 for releases, artists and tracks that cannot be played, 422 for bad ids', async () => {
    const missing = [
      `/catalog/releases/${id('hiddenRelease')}`,
      `/catalog/releases/${randomUUID()}`,
      `/catalog/tracks/${id('hidden')}`,
      `/catalog/tracks/${id('noStream')}`,
      `/catalog/tracks/${id('territory')}`,
      `/catalog/tracks/${id('noAssets')}`,
      `/catalog/artists/${randomUUID()}`,
    ];
    for (const path of missing) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(ProblemDetails.parse(res.body).code).toBe('NOT_FOUND');
    }
    const bad = await get('/catalog/releases/not-a-uuid');
    expect(bad.status).toBe(422);
  });

  it('shows an artist with releases and tracks, hides an artist without playable tracks', async () => {
    const [artistA] = await db
      .select({ id: artists.id })
      .from(artists)
      .where(and(eq(artists.sourceId, sourceId), eq(artists.name, ARTIST_A)));
    const [artistC] = await db
      .select({ id: artists.id })
      .from(artists)
      .where(and(eq(artists.sourceId, sourceId), eq(artists.name, ARTIST_C)));
    const res = await get(`/catalog/artists/${artistA?.id ?? ''}`);
    expect(res.status).toBe(200);
    const artist = ArtistDetail.parse(res.body);
    expect(artist).toMatchObject({ name: ARTIST_A, trackCount: 1, releaseCount: 1 });
    expect(artist.releases.map((release) => release.id)).toEqual([id('glacier')]);
    expect(artist.tracks.map((track) => track.id)).toEqual([id('moonlight')]);

    expect((await get(`/catalog/artists/${artistC?.id ?? ''}`)).status).toBe(404);
    const ghost = SearchResults.parse((await get('/catalog/search?q=plumbago')).body);
    expect(ghost.artists).toEqual([]);
    expect(ghost.releases).toEqual([]);
    expect(ghost.tracks).toEqual([]);
  });

  it('returns a playable track', async () => {
    const res = await get(`/catalog/tracks/${id('etude')}`);
    expect(res.status).toBe(200);
    expect(TrackDto.parse(res.body)).toMatchObject({
      title: 'Beyoncé Étude',
      artists: [{ name: ARTIST_B }],
      license: { name: 'CC0 1.0' },
    });
  });

  async function searchFor(q: string): Promise<SearchResults> {
    const res = await get(`/catalog/search?q=${encodeURIComponent(q)}`);
    expect(res.status, q).toBe(200);
    return SearchResults.parse(res.body);
  }

  it('finds artists, their releases and tracks; tolerates typos, case, accents and ё', async () => {
    const exact = await searchFor('zyqwerton quartet');
    expect(exact.artists[0]?.name).toBe(ARTIST_A);
    expect(exact.releases.map((release) => release.id)).toContain(id('glacier'));
    expect(exact.tracks.map((track) => track.id)).toContain(id('moonlight'));

    expect((await searchFor('Zyqwertn')).artists.map((artist) => artist.name)).toContain(ARTIST_A);
    // One wrong letter in the middle changes three trigrams: still found (FUZZY_THRESHOLD).
    expect((await searchFor('zyqwrton')).artists.map((artist) => artist.name)).toContain(ARTIST_A);
    expect((await searchFor('GLACIER')).releases.map((release) => release.id)).toContain(
      id('glacier'),
    );
    expect((await searchFor('beyonce etude')).tracks.map((track) => track.id)).toContain(
      id('etude'),
    );
    expect((await searchFor('елка')).artists.map((artist) => artist.name)).toContain(ARTIST_B);
    expect((await searchFor('сияние')).releases.map((release) => release.id)).toContain(
      id('aurora'),
    );
    expect((await searchFor('zy')).artists.map((artist) => artist.name)).toContain(ARTIST_A);
  });

  it('never finds tracks that cannot be played', async () => {
    for (const q of ['No Stream Right', 'Territory Locked', 'No Renditions', 'Plumbago Hidden']) {
      const found = await searchFor(q);
      const trackIds = found.tracks.map((track) => track.id);
      for (const hidden of ['noStream', 'territory', 'noAssets', 'hidden']) {
        expect(trackIds, q).not.toContain(id(hidden));
      }
    }
  });

  it('treats LIKE wildcards in the query as plain text', async () => {
    for (const q of ['%', '_', '%%%', '\\']) {
      const found = await searchFor(q);
      expect(found.artists.length + found.releases.length + found.tracks.length, q).toBe(0);
    }
  });

  it('validates the query', async () => {
    for (const path of [
      '/catalog/search',
      '/catalog/search?q=',
      `/catalog/search?q=${'a'.repeat(101)}`,
      '/catalog/search?q=a&limit=0',
      '/catalog/search?q=a&limit=51',
      '/catalog/search?q=a%00b',
      '/catalog/search/suggest?q=a&limit=11',
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(422);
      expect(ProblemDetails.parse(res.body).code).toBe('VALIDATION_FAILED');
    }
  });

  it('suggests the best matches of any type, artist first', async () => {
    const res = await get('/catalog/search/suggest?q=zyqwerton&limit=5');
    expect(res.status).toBe(200);
    const suggestions = SuggestResults.parse(res.body);
    expect(suggestions.items.length).toBeLessThanOrEqual(5);
    expect(suggestions.items[0]).toMatchObject({ kind: 'artist', title: ARTIST_A, subtitle: null });
    expect(suggestions.items).toContainEqual({
      kind: 'track',
      id: id('moonlight'),
      title: 'Moonlight',
      subtitle: ARTIST_A,
    });
  });
});
