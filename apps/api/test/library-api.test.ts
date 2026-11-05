// Personal library and playlists on the real test database (I7a, docs/I7_PLAN.md §7).
import { randomUUID } from 'node:crypto';

import {
  AddPlaylistItemsResult,
  AuthResponse,
  FollowedArtistsPage,
  LibraryChange,
  LibraryContains,
  LikedTracksPage,
  PlaylistItemsPage,
  PlaylistList,
  PlaylistMutation,
  PlaylistSummary,
  ProblemDetails,
  SavedReleasesPage,
} from '@mp/contracts';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type CatalogEntry,
  deleteSourceCatalog,
  ensureSource,
  upsertCatalogTrack,
} from '../dist/catalog/ingest.js';
import type { Database } from '../dist/db/client.js';
import { trackAssets, trackRights, tracks, userChangeLog } from '../dist/db/schema.js';
import { DB } from '../dist/infra/tokens.js';
import { startTestApp, type TestApp } from './helpers.js';

function entry(title: string, artist: string, release: string): CatalogEntry {
  const slug = (text: string) => encodeURIComponent(text.replace(/ /g, '_'));
  return {
    externalId: `/library-test/${slug(artist)}/${slug(release)}/${slug(title)}`,
    title,
    explicit: false,
    instrumental: null,
    artist: { externalId: `/library-test/${slug(artist)}`, name: artist, url: null },
    release: {
      externalId: `/library-test/${slug(artist)}/${slug(release)}`,
      title: release,
      type: 'album',
      releaseDate: '2020-01-01',
      url: null,
    },
    rights: {
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      attribution: `"${title}" by ${artist}, licensed under CC BY 4.0`,
      sourceUrl: 'https://example.org/track',
      allowOffline: false,
    },
  };
}

interface Res {
  status: number;
  body: unknown;
}

describe('library and playlists API', () => {
  let t: TestApp;
  let db: Database;
  let sourceId: string;
  let token: string;
  let otherToken: string;
  let userId: string;
  const track: Record<string, string> = {};
  const release: Record<string, string> = {};
  const artist: Record<string, string> = {};

  const id = (map: Record<string, string>, name: string): string => {
    const value = map[name];
    if (value === undefined) throw new Error(`no id ${name}`);
    return value;
  };

  async function call(
    method: string,
    path: string,
    body?: unknown,
    options: { auth?: string | null; key?: string } = {},
  ): Promise<Res> {
    const headers: Record<string, string> = {};
    const auth = options.auth === undefined ? token : options.auth;
    if (auth !== null) headers.authorization = `Bearer ${auth}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (options.key !== undefined) headers['idempotency-key'] = options.key;
    const res = await fetch(`${t.url}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
  }

  const seqOf = (res: Res) => LibraryChange.parse(res.body).seq;

  async function addTrack(name: string, data: CatalogEntry): Promise<void> {
    const created = await upsertCatalogTrack(db, sourceId, data);
    track[name] = created.id;
    await db
      .update(tracks)
      .set({ status: 'ready', durationMs: 120_000 })
      .where(eq(tracks.id, created.id));
    await db.insert(trackAssets).values({
      trackId: created.id,
      codec: 'opus',
      container: 'webm',
      bitrateKbps: 128,
      sampleRateHz: 48_000,
      channels: 2,
      quality: 'lossy',
      sizeBytes: 1000,
      s3Key: `library-test/${created.id}/opus-128.webm`,
    });
    const [row] = await db
      .select({ releaseId: tracks.releaseId })
      .from(tracks)
      .where(eq(tracks.id, created.id));
    release[name] = row?.releaseId ?? '';
  }

  async function register(): Promise<{ token: string; userId: string }> {
    const res = await fetch(`${t.url}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `library-${randomUUID()}@example.test`,
        password: 'correct horse battery staple',
        displayName: 'Listener',
      }),
    });
    expect(res.status).toBe(201);
    const auth = AuthResponse.parse(await res.json());
    return { token: auth.accessToken, userId: auth.user.id };
  }

  beforeAll(async () => {
    t = await startTestApp();
    db = t.app.get<Database>(DB);
    sourceId = await ensureSource(db, {
      kind: 'synthetic',
      name: `library-api-test-${randomUUID()}`,
      url: null,
    });
    for (const [name, title] of [
      ['a', 'Alpha'],
      ['b', 'Bravo'],
      ['c', 'Charlie'],
      ['d', 'Delta'],
    ] as const) {
      await addTrack(name, entry(title, 'Library Tester', 'Test Album'));
    }
    await addTrack('gone', entry('Soon Gone', 'Vanishing Artist', 'Vanishing Album'));
    ({ token, userId } = await register());
    otherToken = (await register()).token;
    const releasePage = await call('GET', `/catalog/releases/${id(release, 'a')}`);
    expect(releasePage.status).toBe(200);
    const artists = (releasePage.body as { artists: { id: string }[] }).artists;
    artist.tester = artists[0]?.id ?? '';
  });

  afterAll(async () => {
    await deleteSourceCatalog(db, sourceId).catch(() => []);
    await t.close();
  });

  it('requires a signed-in user', async () => {
    for (const [method, path] of [
      ['GET', '/library/tracks'],
      ['PUT', `/library/tracks/${randomUUID()}`],
      ['GET', '/playlists'],
      ['POST', '/playlists'],
    ] as const) {
      const res = await call(method, path, undefined, { auth: null });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(ProblemDetails.parse(res.body).code).toBe('UNAUTHENTICATED');
    }
  });

  it('likes and unlikes a track; repeating either changes nothing', async () => {
    const liked = await call('PUT', `/library/tracks/${id(track, 'a')}`);
    expect(liked.status).toBe(200);
    const seq = seqOf(liked);
    expect(seq).toBeGreaterThan(0);
    expect(seqOf(await call('PUT', `/library/tracks/${id(track, 'a')}`))).toBe(seq);

    const page = LikedTracksPage.parse((await call('GET', '/library/tracks')).body);
    expect(page.items.map((item) => item.track.id)).toEqual([id(track, 'a')]);
    expect(page.items[0]?.track).toMatchObject({ available: true, title: 'Alpha' });

    const unliked = await call('DELETE', `/library/tracks/${id(track, 'a')}`);
    expect(seqOf(unliked)).toBe(seq + 1);
    expect(seqOf(await call('DELETE', `/library/tracks/${id(track, 'a')}`))).toBe(seq + 1);
    expect(LikedTracksPage.parse((await call('GET', '/library/tracks')).body).items).toEqual([]);
  });

  it('cannot like what is not in the catalog', async () => {
    const res = await call('PUT', `/library/tracks/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect((await call('PUT', '/library/tracks/not-a-uuid')).status).toBe(422);
  });

  it('pages liked tracks newest first and rejects a forged cursor', async () => {
    for (const name of ['b', 'c', 'd']) {
      expect((await call('PUT', `/library/tracks/${id(track, name)}`)).status).toBe(200);
    }
    const first = LikedTracksPage.parse((await call('GET', '/library/tracks?limit=2')).body);
    expect(first.items.map((item) => item.track.id)).toEqual([id(track, 'd'), id(track, 'c')]);
    expect(first.nextCursor).not.toBeNull();
    const second = LikedTracksPage.parse(
      (await call('GET', `/library/tracks?limit=2&cursor=${first.nextCursor ?? ''}`)).body,
    );
    expect(second.items.map((item) => item.track.id)).toEqual([id(track, 'b')]);
    expect(second.nextCursor).toBeNull();
    expect((await call('GET', '/library/tracks?cursor=bm9wZQ')).status).toBe(422);
  });

  it('keeps a liked track that stops being playable, marked unavailable', async () => {
    await call('PUT', `/library/tracks/${id(track, 'gone')}`);
    await db
      .update(trackRights)
      .set({ status: 'suspended' })
      .where(eq(trackRights.trackId, id(track, 'gone')));
    const page = LikedTracksPage.parse((await call('GET', '/library/tracks')).body);
    const gone = page.items.find((item) => item.track.id === id(track, 'gone'));
    expect(gone?.track).toEqual({
      available: false,
      id: id(track, 'gone'),
      title: 'Soon Gone',
      durationMs: 120_000,
      artists: [expect.objectContaining({ name: 'Vanishing Artist' })],
      release: { id: id(release, 'gone'), title: 'Vanishing Album' },
    });
    // It can still be unliked, but no longer liked again.
    expect((await call('DELETE', `/library/tracks/${id(track, 'gone')}`)).status).toBe(200);
    expect((await call('PUT', `/library/tracks/${id(track, 'gone')}`)).status).toBe(404);
  });

  it('saves releases and follows artists, and answers "contains" for a screen', async () => {
    expect((await call('PUT', `/library/releases/${id(release, 'a')}`)).status).toBe(200);
    expect((await call('PUT', `/library/artists/${id(artist, 'tester')}`)).status).toBe(200);
    const releases = SavedReleasesPage.parse((await call('GET', '/library/releases')).body);
    expect(releases.items[0]?.release).toMatchObject({
      id: id(release, 'a'),
      title: 'Test Album',
      available: true,
      trackCount: 4,
    });
    const artists = FollowedArtistsPage.parse((await call('GET', '/library/artists')).body);
    expect(artists.items[0]?.artist).toMatchObject({ id: id(artist, 'tester'), available: true });

    const unknown = randomUUID();
    const contains = LibraryContains.parse(
      (
        await call('POST', '/library/contains', {
          tracks: [id(track, 'b'), id(track, 'a'), unknown],
          releases: [id(release, 'a')],
        })
      ).body,
    );
    expect(contains.tracks).toEqual([id(track, 'b')]);
    expect(contains.releases).toEqual([id(release, 'a')]);
    expect(contains.artists).toEqual([]);
  });

  it('numbers changes without gaps when twenty run at once', async () => {
    const { token: fresh, userId: freshId } = await register();
    const names = ['a', 'b', 'c', 'd'];
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const name = names[i % names.length] ?? 'a';
        const path =
          i % 2 === 0
            ? `/library/tracks/${id(track, name)}`
            : `/library/releases/${id(release, name)}`;
        return call(i < 10 ? 'PUT' : 'DELETE', path, undefined, { auth: fresh });
      }),
    );
    for (const res of results) expect(res.status).toBe(200);
    const log = await db
      .select({ seq: userChangeLog.seq })
      .from(userChangeLog)
      .where(eq(userChangeLog.userId, freshId))
      .orderBy(asc(userChangeLog.seq));
    expect(log.map((row) => row.seq)).toEqual(log.map((_, i) => i + 1));
    expect(Math.max(...results.map(seqOf))).toBe(log.length);
  });

  describe('playlists', () => {
    let playlistId: string;
    const items: string[] = [];

    const order = async (): Promise<string[]> => {
      const page = PlaylistItemsPage.parse(
        (await call('GET', `/playlists/${playlistId}/items`)).body,
      );
      return page.items.map((item) => item.track.id);
    };

    it('creates a playlist; a retry with the same key returns the same answer', async () => {
      const key = randomUUID();
      const created = await call('POST', '/playlists', { name: '  Night  drive ' }, { key });
      expect(created.status).toBe(201);
      const first = PlaylistMutation.parse(created.body);
      expect(first.playlist).toMatchObject({
        name: 'Night drive',
        description: null,
        trackCount: 0,
      });
      playlistId = first.playlist.id;

      const again = await call('POST', '/playlists', { name: 'Night drive' }, { key });
      expect(again.status).toBe(201);
      expect(PlaylistMutation.parse(again.body)).toEqual(first);
      const list = PlaylistList.parse((await call('GET', '/playlists')).body);
      expect(list.items.filter((p) => p.name === 'Night drive')).toHaveLength(1);

      const misused = await call(
        'POST',
        `/playlists/${playlistId}/items`,
        { trackIds: [id(track, 'a')] },
        { key },
      );
      expect(misused.status).toBe(409);
      expect((await call('POST', '/playlists', { name: 'x' }, { key: 'nope' })).status).toBe(422);
      expect((await call('POST', '/playlists', { name: '   ' })).status).toBe(422);
    });

    it('adds tracks at the end, at the start and after an item', async () => {
      const added = await call('POST', `/playlists/${playlistId}/items`, {
        trackIds: [id(track, 'b'), id(track, 'c')],
      });
      expect(added.status).toBe(201);
      const result = AddPlaylistItemsResult.parse(added.body);
      expect(result.playlist.trackCount).toBe(2);
      expect(result.playlist.durationMs).toBe(240_000);
      items.push(...result.items.map((item) => item.itemId));

      const start = AddPlaylistItemsResult.parse(
        (
          await call('POST', `/playlists/${playlistId}/items`, {
            trackIds: [id(track, 'a')],
            after: null,
          })
        ).body,
      );
      items.push(start.items[0]?.itemId ?? '');
      const middle = AddPlaylistItemsResult.parse(
        (
          await call('POST', `/playlists/${playlistId}/items`, {
            trackIds: [id(track, 'd')],
            after: items[0],
          })
        ).body,
      );
      items.push(middle.items[0]?.itemId ?? '');
      expect(await order()).toEqual([
        id(track, 'a'),
        id(track, 'b'),
        id(track, 'd'),
        id(track, 'c'),
      ]);
    });

    it('warns about duplicates and adds them only when asked', async () => {
      const refused = await call('POST', `/playlists/${playlistId}/items`, {
        trackIds: [id(track, 'a'), randomUUID()],
      });
      expect(refused.status).toBe(422);
      const duplicate = await call('POST', `/playlists/${playlistId}/items`, {
        trackIds: [id(track, 'c'), id(track, 'a')],
      });
      expect(duplicate.status).toBe(409);
      const problem = ProblemDetails.parse(duplicate.body);
      expect(problem.code).toBe('DUPLICATE_TRACKS');
      expect(problem.errors?.map((error) => error.path)).toEqual(['trackIds.0', 'trackIds.1']);
      const allowed = await call('POST', `/playlists/${playlistId}/items`, {
        trackIds: [id(track, 'a')],
        allowDuplicates: true,
      });
      expect(allowed.status).toBe(201);
      const last = AddPlaylistItemsResult.parse(allowed.body).items[0]?.itemId ?? '';
      expect((await call('DELETE', `/playlists/${playlistId}/items/${last}`)).status).toBe(200);
    });

    it('moves and removes items', async () => {
      const [b, , a, d] = items; // b, c, a, d by creation
      expect(
        (await call('PATCH', `/playlists/${playlistId}/items/${b ?? ''}`, { after: null })).status,
      ).toBe(200);
      expect(await order()).toEqual([
        id(track, 'b'),
        id(track, 'a'),
        id(track, 'd'),
        id(track, 'c'),
      ]);
      expect(
        (await call('PATCH', `/playlists/${playlistId}/items/${a ?? ''}`, { after: d })).status,
      ).toBe(200);
      expect(await order()).toEqual([
        id(track, 'b'),
        id(track, 'd'),
        id(track, 'a'),
        id(track, 'c'),
      ]);
      expect(
        (await call('PATCH', `/playlists/${playlistId}/items/${a ?? ''}`, { after: a })).status,
      ).toBe(422);
      expect((await call('DELETE', `/playlists/${playlistId}/items/${d ?? ''}`)).status).toBe(200);
      expect((await call('DELETE', `/playlists/${playlistId}/items/${d ?? ''}`)).status).toBe(404);
      expect(await order()).toEqual([id(track, 'b'), id(track, 'a'), id(track, 'c')]);
    });

    it('pages items in playlist order', async () => {
      const first = PlaylistItemsPage.parse(
        (await call('GET', `/playlists/${playlistId}/items?limit=2`)).body,
      );
      expect(first.items).toHaveLength(2);
      const rest = PlaylistItemsPage.parse(
        (
          await call(
            'GET',
            `/playlists/${playlistId}/items?limit=2&cursor=${first.nextCursor ?? ''}`,
          )
        ).body,
      );
      expect([...first.items, ...rest.items].map((item) => item.track.id)).toEqual(await order());
      expect(rest.nextCursor).toBeNull();
    });

    it('renames, hides it from other users and deletes it', async () => {
      const renamed = await call('PATCH', `/playlists/${playlistId}`, {
        name: 'Late drive',
        description: 'Rain',
      });
      expect(PlaylistMutation.parse(renamed.body).playlist).toMatchObject({
        name: 'Late drive',
        description: 'Rain',
      });
      expect((await call('PATCH', `/playlists/${playlistId}`, {})).status).toBe(422);

      for (const [method, path] of [
        ['GET', `/playlists/${playlistId}`],
        ['GET', `/playlists/${playlistId}/items`],
        ['DELETE', `/playlists/${playlistId}`],
      ] as const) {
        expect((await call(method, path, undefined, { auth: otherToken })).status, path).toBe(404);
      }
      expect(PlaylistSummary.parse((await call('GET', `/playlists/${playlistId}`)).body).name).toBe(
        'Late drive',
      );
      expect((await call('DELETE', `/playlists/${playlistId}`)).status).toBe(200);
      expect((await call('GET', `/playlists/${playlistId}`)).status).toBe(404);
      const list = PlaylistList.parse((await call('GET', '/playlists')).body);
      expect(list.items.map((p) => p.id)).not.toContain(playlistId);
    });

    it('records every playlist change in the change log of its owner', async () => {
      const log = await db
        .select({ entity: userChangeLog.entity, op: userChangeLog.op })
        .from(userChangeLog)
        .where(eq(userChangeLog.userId, userId))
        .orderBy(asc(userChangeLog.seq));
      expect(log.filter((row) => row.entity === 'playlist').map((row) => row.op)).toEqual([
        'upsert',
        'upsert',
        'delete',
      ]);
      expect(log.some((row) => row.entity === 'playlist_item' && row.op === 'delete')).toBe(true);
    });
  });
});
