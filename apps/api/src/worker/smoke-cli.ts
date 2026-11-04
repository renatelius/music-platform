// Setup smoke test: pushes one synthetic file through the whole pipeline against the dev
// database and S3, checks that every rendition row has its object, then removes everything.
// Usage: pnpm --filter @mp/api worker:smoke
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { and, eq } from 'drizzle-orm';

import { loadConfig } from '../config/env.js';
import { createDb, createPool } from '../db/client.js';
import { releases, sources, trackAssets, trackLoudness, tracks } from '../db/schema.js';
import { createS3 } from '../infra/clients.js';
import { runTool } from '../media/index.js';
import { processTrack } from './pipeline.js';
import { deletePrefix, objectSize, uploadFile } from './storage.js';

const config = loadConfig(process.env);
const tools = { ffmpegPath: config.media.ffmpegPath, ffprobePath: config.media.ffprobePath };
const pool = createPool(config.db.url, 2);
const db = createDb(pool);
const s3 = createS3(config);
const dir = await mkdtemp(join(tmpdir(), 'mp-smoke-'));
let trackId: string | undefined;
let releaseId: string | undefined;
let ok = false;

try {
  const master = join(dir, 'tone.flac');
  const sine = '0.0707946*sin(2*PI*997*t)';
  const generated = await runTool(
    tools.ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `aevalsrc=${sine}|${sine}:s=44100:d=5`,
      '-c:a',
      'flac',
      '-sample_fmt',
      's16',
      master,
    ],
    60_000,
  );
  if (generated.exitCode !== 0) throw new Error(`ffmpeg could not generate the test file`);

  const sourceName = 'setup-smoke';
  await db.insert(sources).values({ kind: 'synthetic', name: sourceName }).onConflictDoNothing();
  const [source] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.kind, 'synthetic'), eq(sources.name, sourceName)));
  if (source === undefined) throw new Error('could not create the synthetic source');

  const externalId = `smoke-${randomUUID()}`;
  const [release] = await db
    .insert(releases)
    .values({ title: 'Setup smoke test', sourceId: source.id, externalId })
    .returning({ id: releases.id });
  if (release === undefined) throw new Error('could not create the release');
  releaseId = release.id;
  const [track] = await db
    .insert(tracks)
    .values({ releaseId, title: '997 Hz tone', sourceId: source.id, externalId })
    .returning({ id: tracks.id });
  if (track === undefined) throw new Error('could not create the track');
  trackId = track.id;

  const masterKey = `tracks/${trackId}/original.flac`;
  await uploadFile(s3, config.s3.buckets.masters, masterKey, master, 'audio/flac');
  await db.update(tracks).set({ masterKey }).where(eq(tracks.id, trackId));

  const started = Date.now();
  const outcome = await processTrack({ db, s3, buckets: config.s3.buckets, tools }, trackId, {
    minDurationMs: 1000,
  });
  console.log(`pipeline: ${JSON.stringify(outcome)} in ${String(Date.now() - started)} ms`);

  const assets = await db.select().from(trackAssets).where(eq(trackAssets.trackId, trackId));
  let missing = 0;
  for (const asset of assets) {
    const size = await objectSize(s3, config.s3.buckets.media, asset.s3Key);
    const present = size === asset.sizeBytes;
    if (!present) missing += 1;
    const rate = `${String(asset.sampleRateHz)} Hz`;
    const bitrate =
      asset.bitrateKbps === null
        ? `${String(asset.bitDepth)}-bit`
        : `${String(asset.bitrateKbps)} kbps`;
    console.log(
      `  ${asset.codec.padEnd(5)} ${bitrate.padEnd(9)} ${rate.padEnd(9)} ${asset.quality.padEnd(8)} ${String(asset.sizeBytes).padStart(8)} B  ${present ? 'in S3' : 'MISSING IN S3'}`,
    );
  }
  const [loudness] = await db
    .select()
    .from(trackLoudness)
    .where(eq(trackLoudness.trackId, trackId));
  if (loudness !== undefined) {
    console.log(
      `loudness: ${loudness.integratedLufs.toFixed(1)} LUFS, true peak ${loudness.truePeakDbtp.toFixed(1)} dBTP, ReplayGain ${loudness.replayGainDb.toFixed(1)} dB (expected about -23 LUFS)`,
    );
  }
  ok =
    outcome.status === 'ready' &&
    assets.length === 5 &&
    missing === 0 &&
    loudness !== undefined &&
    Math.abs(loudness.integratedLufs + 23) < 1;
  if (!ok) console.log('smoke test FAILED: expected 5 renditions in S3 and about -23 LUFS');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  if (trackId !== undefined) {
    await deletePrefix(s3, config.s3.buckets.media, `tracks/${trackId}/`).catch(() => 0);
    await deletePrefix(s3, config.s3.buckets.masters, `tracks/${trackId}/`).catch(() => 0);
  }
  if (releaseId !== undefined) {
    await db
      .delete(releases)
      .where(eq(releases.id, releaseId))
      .catch(() => undefined);
  }
  await rm(dir, { recursive: true, force: true });
  s3.destroy();
  await pool.end();
}
process.exit(ok ? 0 : 1);
