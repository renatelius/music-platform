// End-to-end audio pipeline on real FFmpeg, Postgres, S3 and Redis with synthetic files.
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

import type { S3Client } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AppConfig, loadConfig } from '../dist/config/env.js';
import { createDb, createPool, type Database } from '../dist/db/client.js';
import { releases, sources, trackAssets, trackLoudness, tracks } from '../dist/db/schema.js';
import { createS3 } from '../dist/infra/clients.js';
import { type MediaTools, runTool } from '../dist/media/index.js';
import { processTrack } from '../dist/worker/pipeline.js';
import { createIngestQueue, enqueueTrack, startIngestWorker } from '../dist/worker/queue.js';
import { deletePrefix, objectSize, uploadFile } from '../dist/worker/storage.js';

const SINE = '0.0707946*sin(2*PI*997*t)';

describe('audio pipeline', () => {
  let config: AppConfig;
  let pool: ReturnType<typeof createPool>;
  let db: Database;
  let s3: S3Client;
  let tools: MediaTools;
  let dir: string;
  let sourceId: string;
  const trackIds: string[] = [];

  const deps = () => ({ db, s3, buckets: config.s3.buckets, tools });
  const file = (name: string) => join(dir, name);

  async function ffmpeg(args: string[]): Promise<void> {
    const result = await runTool(
      tools.ffmpegPath,
      ['-hide_banner', '-loglevel', 'error', '-y', ...args],
      60_000,
    );
    if (result.exitCode !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
  }

  const tone = (rate: number, seconds: number) => [
    '-f',
    'lavfi',
    '-i',
    `aevalsrc=${SINE}|${SINE}:s=${String(rate)}:d=${String(seconds)}`,
  ];

  /** Creates release + track rows and uploads the master, like the importer will. */
  async function addTrack(path: string): Promise<string> {
    const externalId = randomUUID();
    const [release] = await db
      .insert(releases)
      .values({ title: `Release ${externalId}`, sourceId, externalId })
      .returning({ id: releases.id });
    if (release === undefined) throw new Error('no release');
    const [track] = await db
      .insert(tracks)
      .values({ releaseId: release.id, title: 'Tone', sourceId, externalId })
      .returning({ id: tracks.id });
    if (track === undefined) throw new Error('no track');
    trackIds.push(track.id);
    const masterKey = `tracks/${track.id}/original${extname(path)}`;
    await uploadFile(s3, config.s3.buckets.masters, masterKey, path, 'application/octet-stream');
    await db.update(tracks).set({ masterKey }).where(eq(tracks.id, track.id));
    return track.id;
  }

  async function loadTrack(id: string) {
    const [track] = await db.select().from(tracks).where(eq(tracks.id, id));
    const assets = await db.select().from(trackAssets).where(eq(trackAssets.trackId, id));
    const [loudness] = await db.select().from(trackLoudness).where(eq(trackLoudness.trackId, id));
    const names = assets
      .map((a) =>
        a.bitrateKbps === null
          ? `${a.codec}-${String(a.bitDepth)}-${String(a.sampleRateHz)}`
          : `${a.codec}-${String(a.bitrateKbps)}`,
      )
      .sort();
    return { track, assets, loudness, names };
  }

  beforeAll(async () => {
    config = loadConfig(process.env);
    pool = createPool(config.db.url, 4);
    db = createDb(pool);
    s3 = createS3(config);
    tools = { ffmpegPath: config.media.ffmpegPath, ffprobePath: config.media.ffprobePath };
    dir = await mkdtemp(join(tmpdir(), 'mp-pipeline-test-'));
    const [source] = await db
      .insert(sources)
      .values({ kind: 'synthetic', name: `pipeline-test-${randomUUID()}` })
      .returning({ id: sources.id });
    if (source === undefined) throw new Error('no source');
    sourceId = source.id;

    await ffmpeg([...tone(44_100, 3), '-c:a', 'flac', '-sample_fmt', 's16', file('cd.flac')]);
    await ffmpeg([...tone(96_000, 3), '-c:a', 'flac', '-sample_fmt', 's32', file('hires.flac')]);
    await ffmpeg([...tone(44_100, 3), '-c:a', 'libmp3lame', '-b:a', '128k', file('lossy.mp3')]);
    await ffmpeg([...tone(44_100, 0.5), '-c:a', 'flac', file('short.flac')]);
    await ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=stereo',
      '-t',
      '3',
      '-c:a',
      'flac',
      file('silence.flac'),
    ]);
    await writeFile(file('broken.mp3'), 'this is not an audio file\n'.repeat(200));
  });

  afterAll(async () => {
    for (const id of trackIds) {
      await deletePrefix(s3, config.s3.buckets.media, `tracks/${id}/`);
      await deletePrefix(s3, config.s3.buckets.masters, `tracks/${id}/`);
    }
    await db.delete(releases).where(eq(releases.sourceId, sourceId));
    await db.delete(sources).where(eq(sources.id, sourceId));
    await rm(dir, { recursive: true, force: true });
    s3.destroy();
    await pool.end();
  });

  it('turns a CD-quality FLAC into the full ladder with loudness and S3 objects', async () => {
    const id = await addTrack(file('cd.flac'));
    const outcome = await processTrack(deps(), id, { minDurationMs: 1000 });
    expect(outcome).toEqual({ status: 'ready', renditions: 5 });

    const { track, assets, loudness, names } = await loadTrack(id);
    expect(names).toEqual(['aac-160', 'aac-256', 'aac-96', 'flac-16-44100', 'opus-160']);
    expect(track).toMatchObject({
      status: 'ready',
      failureReason: null,
      sourceCodec: 'flac',
      sourceSampleRateHz: 44_100,
      sourceBitDepth: 16,
      sourceChannels: 2,
    });
    expect(Math.abs((track?.durationMs ?? 0) - 3000)).toBeLessThan(50);
    expect(assets.find((a) => a.codec === 'flac')?.quality).toBe('lossless');
    expect(assets.filter((a) => a.codec !== 'flac').every((a) => a.quality === 'lossy')).toBe(true);
    expect(Math.abs((loudness?.integratedLufs ?? 0) + 23)).toBeLessThan(0.5);

    for (const asset of assets) {
      expect(asset.sizeBytes).toBeGreaterThan(0);
      expect(await objectSize(s3, config.s3.buckets.media, asset.s3Key)).toBe(asset.sizeBytes);
    }
  });

  it('keeps a 24-bit / 96 kHz master as Hi-Res FLAC and adds a CD-quality FLAC', async () => {
    const id = await addTrack(file('hires.flac'));
    await processTrack(deps(), id, { minDurationMs: 1000 });
    const { assets, names } = await loadTrack(id);
    expect(names).toContain('flac-24-96000');
    expect(names).toContain('flac-16-48000');
    expect(assets.find((a) => a.bitDepth === 24)?.quality).toBe('hires');
    expect(assets.find((a) => a.codec === 'flac' && a.bitDepth === 16)?.quality).toBe('lossless');
  });

  it('makes only lossy renditions not above 128 kbps from a 128 kbps MP3', async () => {
    const id = await addTrack(file('lossy.mp3'));
    await processTrack(deps(), id, { minDurationMs: 1000 });
    const { track, assets, names } = await loadTrack(id);
    expect(names).toEqual(['aac-128', 'aac-96', 'opus-128']);
    expect(assets.every((a) => a.quality === 'lossy')).toBe(true);
    expect(track?.sourceBitrateKbps).toBe(128);
  });

  it('rejects silence, a too short file and a file that is not audio', async () => {
    const silence = await addTrack(file('silence.flac'));
    const short = await addTrack(file('short.flac'));
    const broken = await addTrack(file('broken.mp3'));
    expect(await processTrack(deps(), silence, { minDurationMs: 1000 })).toEqual({
      status: 'failed',
      reason: 'silence',
    });
    expect(await processTrack(deps(), short, { minDurationMs: 1000 })).toEqual({
      status: 'failed',
      reason: 'too_short',
    });
    const brokenOutcome = await processTrack(deps(), broken, { minDurationMs: 1000 });
    expect(brokenOutcome.status).toBe('failed');
    for (const id of [silence, short, broken]) {
      const { track, assets } = await loadTrack(id);
      expect(track?.status).toBe('failed');
      expect(track?.failureReason).not.toBeNull();
      expect(assets).toEqual([]);
    }
  });

  it('can process the same track again without duplicate renditions', async () => {
    const id = await addTrack(file('lossy.mp3'));
    await processTrack(deps(), id, { minDurationMs: 1000 });
    await processTrack(deps(), id, { minDurationMs: 1000 });
    const { assets } = await loadTrack(id);
    expect(assets).toHaveLength(3);
  });

  it('processes a track queued on the ingest queue', { timeout: 60_000 }, async () => {
    const id = await addTrack(file('cd.flac'));
    const settings = { redisUrl: config.redis.url, prefix: `mp-test-${randomUUID()}` };
    const queue = createIngestQueue(settings);
    const worker = startIngestWorker(deps(), { ...settings, concurrency: 1, minDurationMs: 1000 });
    try {
      await enqueueTrack(queue.queue, id);
      const deadline = Date.now() + 45_000;
      let status: string | undefined;
      while (Date.now() < deadline) {
        const [row] = await db
          .select({ status: tracks.status })
          .from(tracks)
          .where(eq(tracks.id, id));
        status = row?.status;
        if (status === 'ready' || status === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(status).toBe('ready');
      expect((await loadTrack(id)).assets).toHaveLength(5);
    } finally {
      await worker.close();
      await queue.close();
    }
  });
});
