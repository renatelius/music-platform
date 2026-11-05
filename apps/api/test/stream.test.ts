// Playback links on the real test database and S3: /catalog/tracks/:id/stream and /media/:token.
import { randomBytes, randomUUID } from 'node:crypto';

import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { AuthResponse, ProblemDetails, TrackStream } from '@mp/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type CatalogEntry,
  deleteSourceCatalog,
  ensureSource,
  upsertCatalogTrack,
} from '../dist/catalog/ingest.js';
import { MediaTokens } from '../dist/catalog/media-token.js';
import type { Database } from '../dist/db/client.js';
import { trackAssets, trackLoudness, tracks } from '../dist/db/schema.js';
import { DB, S3 } from '../dist/infra/tokens.js';
import { deletePrefix } from '../dist/worker/storage.js';
import { startTestApp, type TestApp } from './helpers.js';

function entry(title: string): CatalogEntry {
  return {
    externalId: `/stream-test/${randomUUID()}`,
    title,
    explicit: false,
    instrumental: null,
    artist: { externalId: '/stream-test/artist', name: 'Stream Tester', url: null },
    release: {
      externalId: '/stream-test/release',
      title: 'Stream Release',
      type: 'album',
      releaseDate: null,
      url: null,
    },
    rights: {
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      attribution: `"${title}" by Stream Tester, licensed under CC BY 4.0`,
      sourceUrl: 'https://example.org/track',
      allowOffline: true,
    },
  };
}

describe('playback links', () => {
  let t: TestApp;
  let db: Database;
  let s3: S3Client;
  let sourceId: string;
  let token: string;
  let playable: string;
  let hidden: string;
  const opusBytes = randomBytes(5000);
  const aacBytes = randomBytes(3000);
  const prefixes: string[] = [];

  async function put(key: string, body: Buffer, contentType: string): Promise<void> {
    await s3.send(
      new PutObjectCommand({
        Bucket: t.config.s3.buckets.media,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async function getStream(id: string, auth = true) {
    const res = await fetch(`${t.url}/catalog/tracks/${id}/stream`, {
      headers: auth ? { authorization: `Bearer ${token}` } : {},
    });
    return { status: res.status, body: await res.json() };
  }

  beforeAll(async () => {
    t = await startTestApp();
    db = t.app.get<Database>(DB);
    s3 = t.app.get<S3Client>(S3);
    sourceId = await ensureSource(db, {
      kind: 'synthetic',
      name: `stream-test-${randomUUID()}`,
      url: null,
    });

    const track = await upsertCatalogTrack(db, sourceId, entry('Playable'));
    playable = track.id;
    const prefix = `tracks/${playable}/`;
    prefixes.push(prefix);
    await put(`${prefix}opus-128.webm`, opusBytes, 'audio/webm');
    await put(`${prefix}aac-96.m4a`, aacBytes, 'audio/mp4');
    await db
      .update(tracks)
      .set({ status: 'ready', durationMs: 180_000 })
      .where(eq(tracks.id, playable));
    const asset = {
      trackId: playable,
      sampleRateHz: 48_000,
      channels: 2,
      quality: 'lossy' as const,
    };
    await db.insert(trackAssets).values([
      {
        ...asset,
        codec: 'aac',
        container: 'm4a',
        bitrateKbps: 96,
        sampleRateHz: 44_100,
        s3Key: `${prefix}aac-96.m4a`,
        sizeBytes: aacBytes.length,
      },
      {
        ...asset,
        codec: 'opus',
        container: 'webm',
        bitrateKbps: 128,
        s3Key: `${prefix}opus-128.webm`,
        sizeBytes: opusBytes.length,
      },
    ]);
    await db
      .insert(trackLoudness)
      .values({ trackId: playable, integratedLufs: -12.5, truePeakDbtp: -0.4, replayGainDb: -5.5 });

    // Not processed: never playable.
    hidden = (await upsertCatalogTrack(db, sourceId, entry('Hidden'))).id;

    const res = await fetch(`${t.url}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `stream-${randomUUID()}@example.test`,
        password: 'correct horse battery staple',
        displayName: 'Listener',
      }),
    });
    expect(res.status).toBe(201);
    token = AuthResponse.parse(await res.json()).accessToken;
  });

  afterAll(async () => {
    for (const prefix of prefixes) {
      await deletePrefix(s3, t.config.s3.buckets.media, prefix).catch(() => 0);
    }
    await deleteSourceCatalog(db, sourceId).catch(() => []);
    await t.close();
  });

  it('gives signed links to every rendition with loudness, only to signed-in users', async () => {
    expect((await getStream(playable, false)).status).toBe(401);
    expect((await getStream(hidden)).status).toBe(404);

    const res = await getStream(playable);
    expect(res.status).toBe(200);
    const stream = TrackStream.parse(res.body);
    expect(stream).toMatchObject({
      trackId: playable,
      durationMs: 180_000,
      loudness: { integratedLufs: -12.5, truePeakDbtp: -0.4, replayGainDb: -5.5 },
    });
    expect(stream.sources.map((s) => `${s.codec}-${String(s.bitrateKbps)}`)).toEqual([
      'opus-128',
      'aac-96',
    ]);
    expect(stream.sources[0]).toMatchObject({
      mimeType: 'audio/webm; codecs="opus"',
      sizeBytes: 5000,
      quality: 'lossy',
    });
    const expires = new Date(stream.expiresAt).getTime() - Date.now();
    expect(expires).toBeGreaterThan(55 * 60_000);
    expect(expires).toBeLessThanOrEqual(60 * 60_000);
    // The S3 key never reaches the client.
    expect(JSON.stringify(stream)).not.toContain(`tracks/${playable}`);
  });

  async function mediaUrl(): Promise<string> {
    const stream = TrackStream.parse((await getStream(playable)).body);
    const opus = stream.sources.find((s) => s.codec === 'opus');
    if (opus === undefined) throw new Error('no opus source');
    return `${t.url}${opus.url}`;
  }

  it('serves the file and byte ranges without an Authorization header', async () => {
    const url = await mediaUrl();

    const whole = await fetch(url);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('audio/webm');
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect(whole.headers.get('content-length')).toBe('5000');
    expect(whole.headers.get('cache-control')).toMatch(/^private, max-age=\d+$/);
    expect(Buffer.from(await whole.arrayBuffer()).equals(opusBytes)).toBe(true);

    const cases: [string, number, number][] = [
      ['bytes=0-99', 0, 99],
      ['bytes=4990-', 4990, 4999],
      ['bytes=-20', 4980, 4999],
      ['bytes=100-99999', 100, 4999],
    ];
    for (const [range, start, end] of cases) {
      const res = await fetch(url, { headers: { range } });
      expect(res.status, range).toBe(206);
      expect(res.headers.get('content-range')).toBe(`bytes ${String(start)}-${String(end)}/5000`);
      expect(res.headers.get('content-length')).toBe(String(end - start + 1));
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.equals(opusBytes.subarray(start, end + 1)), range).toBe(true);
    }

    const outside = await fetch(url, { headers: { range: 'bytes=5000-' } });
    expect(outside.status).toBe(416);
    expect(outside.headers.get('content-range')).toBe('bytes */5000');
  });

  it('refuses tampered, foreign and expired links', async () => {
    const url = await mediaUrl();
    const mac = url.slice(-43);
    const flipped = mac.startsWith('A') ? `B${mac.slice(1)}` : `A${mac.slice(1)}`;
    const expired = new MediaTokens(t.config.auth.jwtSecret).sign({
      key: `tracks/${playable}/opus-128.webm`,
      sizeBytes: 5000,
      contentType: 'audio/webm',
      expiresAt: new Date(Date.now() - 1000),
    });
    const foreign = new MediaTokens(`${t.config.auth.jwtSecret}-other`).sign({
      key: `tracks/${playable}/opus-128.webm`,
      sizeBytes: 5000,
      contentType: 'audio/webm',
      expiresAt: new Date(Date.now() + 60_000),
    });
    for (const bad of [
      `${url.slice(0, -43)}${flipped}`,
      `${t.url}/media/${expired}`,
      `${t.url}/media/${foreign}`,
      `${t.url}/media/not-a-token`,
    ]) {
      const res = await fetch(bad);
      expect(res.status, bad).toBe(403);
      expect(ProblemDetails.parse(await res.json()).code).toBe('FORBIDDEN');
    }
  });

  it('answers 404 when the object is gone', async () => {
    const missing = new MediaTokens(t.config.auth.jwtSecret).sign({
      key: `tracks/${randomUUID()}/opus-128.webm`,
      sizeBytes: 5000,
      contentType: 'audio/webm',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const res = await fetch(`${t.url}/media/${missing}`);
    expect(res.status).toBe(404);
  });
});
