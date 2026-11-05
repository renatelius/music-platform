// Synchronization on the real test database and Redis: change log, live channel, history and
// settings (I7b, docs/I7_PLAN.md §7).
import { randomUUID } from 'node:crypto';

import {
  AuthResponse,
  ClearHistoryResult,
  PlaylistMutation,
  ProblemDetails,
  RecentPlays,
  RecordPlaysResult,
  SyncChangesPage,
  SyncState,
  UserSettings,
  UserSettingsMutation,
  WS_CLOSE,
  WsServerMessage,
  WsTicket,
} from '@mp/contracts';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import {
  type CatalogEntry,
  deleteSourceCatalog,
  ensureSource,
  upsertCatalogTrack,
} from '../dist/catalog/ingest.js';
import type { Database } from '../dist/db/client.js';
import { trackAssets, tracks, userChangeLog } from '../dist/db/schema.js';
import { DB } from '../dist/infra/tokens.js';
import { startTestApp, type TestApp } from './helpers.js';

interface Res {
  status: number;
  body: unknown;
}

interface Account {
  token: string;
  userId: string;
}

interface Live {
  ws: WebSocket;
  messages: WsServerMessage[];
  waitFor: (count: number) => Promise<void>;
  closed: Promise<number>;
}

const PLAYBACK = {
  crossfadeMs: 3000,
  gaplessAlbums: true,
  replayGain: 'track',
  quality: 'auto',
  eqEnabled: true,
  eqGains: [1, 2, 3, 0, 0, 0, 0, 0, -1, -2],
  balance: 0,
  eqProfiles: [{ name: 'Mine', gains: [1, 2, 3, 0, 0, 0, 0, 0, -1, -2] }],
} as const;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(`timed out: ${what}`);
    }),
  ]);
}

function entry(title: string): CatalogEntry {
  const slug = encodeURIComponent(title.replace(/ /g, '_'));
  return {
    externalId: `/sync-test/artist/album/${slug}`,
    title,
    explicit: false,
    instrumental: null,
    artist: { externalId: '/sync-test/artist', name: 'Sync Tester', url: null },
    release: {
      externalId: '/sync-test/artist/album',
      title: 'Sync Album',
      type: 'album',
      releaseDate: '2020-01-01',
      url: null,
    },
    rights: {
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      attribution: `"${title}" by Sync Tester, licensed under CC BY 4.0`,
      sourceUrl: 'https://example.org/track',
      allowOffline: false,
    },
  };
}

describe('synchronization API', () => {
  let t: TestApp;
  let db: Database;
  let sourceId: string;
  let wsUrl: string;
  let webOrigin: string;
  let a: Account;
  let b: Account;
  let listener: Account;
  const trackIds: string[] = [];

  async function call(
    method: string,
    path: string,
    body?: unknown,
    options: { auth?: Account | null; key?: string } = {},
  ): Promise<Res> {
    const headers: Record<string, string> = {};
    const auth = options.auth === undefined ? a : options.auth;
    if (auth !== null) headers.authorization = `Bearer ${auth.token}`;
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

  async function register(): Promise<Account> {
    const res = await fetch(`${t.url}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `sync-${randomUUID()}@example.test`,
        password: 'correct horse battery staple',
        displayName: 'Listener',
      }),
    });
    expect(res.status).toBe(201);
    const auth = AuthResponse.parse(await res.json());
    return { token: auth.accessToken, userId: auth.user.id };
  }

  async function changes(account: Account, query: string): Promise<SyncChangesPage> {
    const res = await call('GET', `/sync/changes?${query}`, undefined, { auth: account });
    expect(res.status).toBe(200);
    return SyncChangesPage.parse(res.body);
  }

  async function ticket(account: Account): Promise<string> {
    const res = await call('POST', '/sync/ws-ticket', undefined, { auth: account });
    expect(res.status).toBe(200);
    return WsTicket.parse(res.body).ticket;
  }

  function live(value: string, origin: string | null = webOrigin): Live {
    const ws = new WebSocket(`${wsUrl}/ws?ticket=${value}`, origin === null ? {} : { origin });
    const messages: WsServerMessage[] = [];
    let wake: () => void = () => undefined;
    ws.on('message', (data) => {
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : '';
      messages.push(WsServerMessage.parse(JSON.parse(text)));
      wake();
    });
    ws.on('error', () => undefined);
    const closed = new Promise<number>((resolve) => {
      ws.on('close', (code) => {
        resolve(code);
      });
    });
    const waitFor = async (count: number) => {
      const deadline = Date.now() + 3000;
      while (messages.length < count) {
        if (Date.now() > deadline) {
          throw new Error(`expected ${String(count)} messages, got ${String(messages.length)}`);
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 50);
        });
      }
    };
    return { ws, messages, waitFor, closed };
  }

  /** HTTP status of a refused upgrade. */
  function refused(value: string, origin?: string): Promise<number> {
    return within(
      new Promise<number>((resolve, reject) => {
        const ws = new WebSocket(
          `${wsUrl}/ws?ticket=${value}`,
          origin === undefined ? {} : { origin },
        );
        ws.on('unexpected-response', (request, response) => {
          resolve(response.statusCode ?? 0);
          request.destroy();
        });
        ws.on('open', () => {
          ws.close();
          reject(new Error('connected'));
        });
        ws.on('error', () => undefined);
      }),
      3000,
      'refused upgrade',
    );
  }

  async function close(...connections: Live[]): Promise<void> {
    for (const connection of connections) connection.ws.close();
    await Promise.all(connections.map((connection) => connection.closed));
  }

  beforeAll(async () => {
    t = await startTestApp();
    db = t.app.get<Database>(DB);
    wsUrl = t.url.replace(/^http/, 'ws');
    webOrigin = new URL(t.config.webAppUrl).origin;
    sourceId = await ensureSource(db, {
      kind: 'synthetic',
      name: `sync-api-test-${randomUUID()}`,
      url: null,
    });
    for (const title of ['Echo', 'Foxtrot']) {
      const created = await upsertCatalogTrack(db, sourceId, entry(title));
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
        s3Key: `sync-test/${created.id}/opus-128.webm`,
      });
      trackIds.push(created.id);
    }
    a = await register();
    b = await register();
    listener = await register();
  });

  afterAll(async () => {
    await deleteSourceCatalog(db, sourceId).catch(() => []);
    await t.close();
  });

  it('requires a signed-in user', async () => {
    for (const [method, path] of [
      ['GET', '/sync/state'],
      ['GET', '/sync/changes?since=0'],
      ['POST', '/sync/ws-ticket'],
      ['POST', '/history/plays'],
      ['GET', '/history/recent'],
      ['DELETE', '/history'],
      ['GET', '/me/settings'],
      ['PUT', '/me/settings'],
    ] as const) {
      const res = await call(method, path, undefined, { auth: null });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(ProblemDetails.parse(res.body).code).toBe('UNAUTHENTICATED');
    }
  });

  it('returns changes in order, pages them and names the request that made them', async () => {
    const key = randomUUID();
    const created = await call('POST', '/playlists', { name: 'Sync one' }, { key });
    expect(created.status).toBe(201);
    const playlistId = PlaylistMutation.parse(created.body).playlist.id;
    expect((await call('PATCH', `/playlists/${playlistId}`, { name: 'Sync two' })).status).toBe(
      200,
    );
    expect((await call('DELETE', `/playlists/${playlistId}`)).status).toBe(200);

    const all = await changes(a, 'since=0');
    expect(all.changes.map((change) => [change.entity, change.op, change.entityId])).toEqual([
      ['playlist', 'upsert', playlistId],
      ['playlist', 'upsert', playlistId],
      ['playlist', 'delete', playlistId],
    ]);
    expect(all.changes.map((change) => change.seq)).toEqual([1, 2, 3]);
    expect(all.changes[0]?.mutationId).toBe(key);
    expect(all.changes[1]?.mutationId).toBeNull();
    expect(all.changes[1]?.payload).toMatchObject({ name: 'Sync two' });
    expect(all).toMatchObject({ seq: 3, hasMore: false });

    const first = await changes(a, 'since=0&limit=2');
    expect(first.changes.map((change) => change.seq)).toEqual([1, 2]);
    expect(first).toMatchObject({ seq: 2, hasMore: true });
    const rest = await changes(a, 'since=2&limit=2');
    expect(rest.changes.map((change) => change.seq)).toEqual([3]);
    expect(rest).toMatchObject({ seq: 3, hasMore: false });
    expect(await changes(a, 'since=3')).toEqual({ changes: [], seq: 3, hasMore: false });
    expect(SyncState.parse((await call('GET', '/sync/state')).body)).toEqual({ seq: 3 });
  });

  it('answers 410 when the version is unknown or no longer in the log', async () => {
    const ahead = await call('GET', '/sync/changes?since=999');
    expect(ahead.status).toBe(410);
    expect(ProblemDetails.parse(ahead.body).code).toBe('GONE');
    expect((await call('GET', '/sync/changes?since=-1')).status).toBe(422);

    // As the 90-day cleanup does: the oldest change is gone.
    await db
      .delete(userChangeLog)
      .where(and(eq(userChangeLog.userId, a.userId), eq(userChangeLog.seq, 1)));
    expect((await call('GET', '/sync/changes?since=0')).status).toBe(410);
    expect((await changes(a, 'since=1')).changes).toHaveLength(2);
  });

  it('keeps versions gapless under 20 parallel changes of one user', async () => {
    const c = await register();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        call('POST', '/playlists', { name: `Parallel ${String(index)}` }, { auth: c }),
      ),
    );
    expect(results.map((res) => res.status)).toEqual(Array.from({ length: 20 }, () => 201));
    const seqs = results.map((res) => PlaylistMutation.parse(res.body).seq).sort((x, y) => x - y);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    const log = await changes(c, 'since=0');
    expect(log.changes.map((change) => change.seq)).toEqual(seqs);
  });

  it('tells every connection of the user about a change, and nobody else', async () => {
    const one = live(await ticket(a));
    const two = live(await ticket(a), null);
    const other = live(await ticket(b));
    await Promise.all([one.waitFor(1), two.waitFor(1), other.waitFor(1)]);
    const before = (await changes(a, 'since=1')).seq;
    expect(one.messages[0]).toEqual({ type: 'hello', seq: before });
    expect(other.messages[0]).toEqual({ type: 'hello', seq: 0 });

    const created = await call('POST', '/playlists', { name: 'Live' });
    const { seq } = PlaylistMutation.parse(created.body);
    expect(seq).toBe(before + 1);
    await Promise.all([one.waitFor(2), two.waitFor(2)]);
    expect(one.messages[1]).toEqual({ type: 'changed', seq });
    expect(two.messages[1]).toEqual({ type: 'changed', seq });
    await sleep(300);
    expect(other.messages).toHaveLength(1);
    await close(one, two, other);
  });

  it('accepts a ticket once and only from the web app or a native client', async () => {
    const value = await ticket(a);
    expect(await refused(value, 'https://evil.example')).toBe(403);
    const first = live(value);
    await first.waitFor(1);
    expect(await refused(value)).toBe(401);
    expect(await refused('x'.repeat(43))).toBe(401);
    expect(await refused('not a ticket')).toBe(401);
    await close(first);
  });

  it('closes the live channel when the user signs out everywhere', async () => {
    const d = await register();
    const connection = live(await ticket(d));
    await connection.waitFor(1);
    expect((await call('POST', '/auth/logout-all', undefined, { auth: d })).status).toBe(204);
    expect(await within(connection.closed, 3000, 'close after sign-out')).toBe(
      WS_CLOSE.unauthenticated,
    );
    expect((await call('POST', '/sync/ws-ticket', undefined, { auth: d })).status).toBe(401);
  });

  it('records plays once and shows recent ones without short plays and repeats', async () => {
    const [echo, foxtrot] = trackIds;
    if (echo === undefined || foxtrot === undefined) throw new Error('no tracks');
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const play = (trackId: string, minutesAgo: number, playedMs: number) => ({
      clientEventId: randomUUID(),
      trackId,
      startedAt: at(minutesAgo),
      playedMs,
      completed: playedMs >= 120_000,
      skipped: playedMs < 30_000,
    });
    const events = [
      play(echo, 10, 120_000),
      play(echo, 8, 60_000),
      play(foxtrot, 6, 5_000),
      { ...play(foxtrot, 4, 45_000), context: { type: 'release', id: null } },
      play(randomUUID(), 2, 60_000),
    ];
    const first = await call('POST', '/history/plays', { events }, { auth: listener });
    expect(first.status).toBe(202);
    expect(RecordPlaysResult.parse(first.body)).toEqual({ recorded: 4 });
    const again = await call('POST', '/history/plays', { events }, { auth: listener });
    expect(RecordPlaysResult.parse(again.body)).toEqual({ recorded: 0 });

    const recent = RecentPlays.parse(
      (await call('GET', '/history/recent', undefined, { auth: listener })).body,
    );
    expect(recent.items.map((item) => item.track.id)).toEqual([foxtrot, echo]);
    expect(recent.items[0]?.track).toMatchObject({ available: true, title: 'Foxtrot' });
    expect(Date.parse(recent.items[1]?.playedAt ?? '')).toBe(
      Date.parse(events[1]?.startedAt ?? ''),
    );
    expect((await call('POST', '/history/plays', { events: [] }, { auth: listener })).status).toBe(
      422,
    );
  });

  it('records nothing while history is off, and clears it', async () => {
    const off = await call('PUT', '/me/settings', { historyEnabled: false }, { auth: listener });
    expect(off.status).toBe(200);
    expect(UserSettingsMutation.parse(off.body).historyEnabled).toBe(false);
    const event = {
      clientEventId: randomUUID(),
      trackId: trackIds[0],
      startedAt: new Date().toISOString(),
      playedMs: 60_000,
      completed: false,
      skipped: false,
    };
    const ignored = await call('POST', '/history/plays', { events: [event] }, { auth: listener });
    expect(ignored.status).toBe(202);
    expect(RecordPlaysResult.parse(ignored.body)).toEqual({ recorded: 0 });

    const cleared = await call('DELETE', '/history', undefined, { auth: listener });
    expect(ClearHistoryResult.parse(cleared.body)).toEqual({ deleted: 4 });
    const recent = RecentPlays.parse(
      (await call('GET', '/history/recent', undefined, { auth: listener })).body,
    );
    expect(recent.items).toEqual([]);
  });

  it('keeps playback settings for the account, versioned like the library', async () => {
    const f = await register();
    const defaults = UserSettings.parse(
      (await call('GET', '/me/settings', undefined, { auth: f })).body,
    );
    expect(defaults).toEqual({ playback: null, historyEnabled: true, updatedAt: null });

    const saved = await call('PUT', '/me/settings', { playback: PLAYBACK }, { auth: f });
    expect(saved.status).toBe(200);
    const first = UserSettingsMutation.parse(saved.body);
    expect(first.playback).toEqual(PLAYBACK);
    expect(first.seq).toBe(1);
    const same = await call('PUT', '/me/settings', { playback: PLAYBACK }, { auth: f });
    expect(UserSettingsMutation.parse(same.body).seq).toBe(1);

    const read = UserSettings.parse(
      (await call('GET', '/me/settings', undefined, { auth: f })).body,
    );
    expect(read).toMatchObject({ playback: PLAYBACK, historyEnabled: true });
    expect(read.updatedAt).not.toBeNull();
    const log = await changes(f, 'since=0');
    expect(log.changes.map((change) => [change.entity, change.entityId])).toEqual([
      ['settings', f.userId],
    ]);

    const bad = await call(
      'PUT',
      '/me/settings',
      { playback: { ...PLAYBACK, eqGains: [1] } },
      { auth: f },
    );
    expect(bad.status).toBe(422);
  });
});
