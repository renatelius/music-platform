import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

import type { S3Client } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { trackAssets, trackLoudness, tracks } from '../db/schema.js';
import {
  analyzeAudio,
  MediaError,
  type MediaErrorCode,
  type MediaTools,
  probeAudio,
} from '../media/index.js';
import { encodeRendition } from '../media/encode.js';
import { planRenditions, renditionName } from '../media/ladder.js';
import { downloadFile, isNotFound, uploadFile } from './storage.js';

export interface PipelineLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface PipelineDeps {
  readonly db: Database;
  readonly s3: S3Client;
  readonly buckets: { readonly media: string; readonly masters: string };
  readonly tools: MediaTools;
  readonly logger?: PipelineLogger;
}

export interface ProcessOptions {
  /** Shorter files are rejected (`too_short`): FMA has jingles and broken uploads. */
  readonly minDurationMs: number;
  readonly tempDir?: string;
}

/** Why a track was rejected. Stored as `tracks.failure_reason` and grouped in import reports. */
export type FailureReason =
  | 'no_master'
  | 'master_missing'
  | 'too_short'
  | 'silence'
  | 'corrupt'
  | 'source_bitrate_too_low'
  | MediaErrorCode
  | 'internal_error';

export type ProcessOutcome =
  | { readonly status: 'ready'; readonly renditions: number }
  | { readonly status: 'failed'; readonly reason: FailureReason }
  | { readonly status: 'missing' };

/** A few damaged frames are common in old MP3s; more than this counts as a corrupt file. */
export const MAX_DECODE_ERRORS = 10;

/** Failures that will not go away on retry: the file itself is the problem. */
const PERMANENT_MEDIA_ERRORS = new Set<MediaErrorCode>([
  'unreadable',
  'no_audio_stream',
  'unsupported_codec',
]);

/** S3 key of a rendition: one folder per track, deterministic names (re-processing overwrites). */
export function renditionKey(trackId: string, name: string, extension: string): string {
  return `tracks/${trackId}/${name}.${extension}`;
}

export async function markFailed(
  db: Database,
  trackId: string,
  reason: FailureReason,
): Promise<void> {
  await db
    .update(tracks)
    .set({ status: 'failed', failureReason: reason })
    .where(eq(tracks.id, trackId));
}

/**
 * Turns a master into playable renditions: probe → checks → loudness → encode → S3 → DB.
 * Idempotent: running it again replaces the renditions of the track.
 * Returns `failed` for problems with the file; throws for problems worth a retry
 * (S3 or the database unavailable, FFmpeg crashed).
 */
export async function processTrack(
  deps: PipelineDeps,
  trackId: string,
  options: ProcessOptions,
): Promise<ProcessOutcome> {
  const { db, s3, buckets, tools } = deps;
  const [track] = await db
    .select({ id: tracks.id, masterKey: tracks.masterKey })
    .from(tracks)
    .where(eq(tracks.id, trackId));
  if (track === undefined) return { status: 'missing' };

  const fail = async (reason: FailureReason): Promise<ProcessOutcome> => {
    await markFailed(db, trackId, reason);
    deps.logger?.warn(`Track ${trackId} rejected: ${reason}`);
    return { status: 'failed', reason };
  };

  await db
    .update(tracks)
    .set({ status: 'processing', failureReason: null })
    .where(eq(tracks.id, trackId));
  if (track.masterKey === null) return fail('no_master');

  const dir = await mkdtemp(join(options.tempDir ?? tmpdir(), 'mp-ingest-'));
  try {
    const input = join(dir, `master${extname(track.masterKey)}`);
    try {
      await downloadFile(s3, buckets.masters, track.masterKey, input);
    } catch (error) {
      if (isNotFound(error)) return await fail('master_missing');
      throw error;
    }

    const probe = await probeAudio(tools, input);
    if (probe.durationMs < options.minDurationMs) return await fail('too_short');

    const analysis = await analyzeAudio(tools, input);
    if (analysis.silent) return await fail('silence');
    if (analysis.decodeErrors.length > MAX_DECODE_ERRORS) return await fail('corrupt');

    const ladder = planRenditions(probe.format);
    if (ladder.length === 0) return await fail('source_bitrate_too_low');

    const assets: (typeof trackAssets.$inferInsert)[] = [];
    for (const spec of ladder) {
      const name = renditionName(spec);
      const output = join(dir, `${name}.${spec.extension}`);
      await encodeRendition(tools, input, spec, output);
      const key = renditionKey(trackId, name, spec.extension);
      const sizeBytes = await uploadFile(s3, buckets.media, key, output, spec.contentType);
      await rm(output, { force: true });
      assets.push({
        trackId,
        codec: spec.codec,
        container: spec.container,
        bitrateKbps: spec.bitrateKbps,
        sampleRateHz: spec.sampleRateHz,
        bitDepth: spec.bitDepth,
        channels: spec.channels,
        quality: spec.quality,
        s3Key: key,
        sizeBytes,
      });
    }

    const { format } = probe;
    const loudness = {
      integratedLufs: analysis.loudness.integratedLufs,
      truePeakDbtp: analysis.loudness.truePeakDbtp,
      loudnessRangeLu: analysis.loudness.loudnessRangeLu,
      replayGainDb: analysis.loudness.replayGainDb,
      measuredAt: new Date(),
    };
    // Files are uploaded first, so every row written here points at an existing object.
    await db.transaction(async (tx) => {
      await tx.delete(trackAssets).where(eq(trackAssets.trackId, trackId));
      await tx.insert(trackAssets).values(assets);
      await tx
        .insert(trackLoudness)
        .values({ trackId, ...loudness })
        .onConflictDoUpdate({ target: trackLoudness.trackId, set: loudness });
      await tx
        .update(tracks)
        .set({
          status: 'ready',
          failureReason: null,
          durationMs: probe.durationMs,
          sourceCodec: format.codec,
          sourceSampleRateHz: format.sampleRateHz,
          sourceBitDepth: format.bitDepth,
          sourceBitrateKbps: format.bitrateKbps,
          sourceChannels: format.channels,
        })
        .where(eq(tracks.id, trackId));
    });
    deps.logger?.log(`Track ${trackId} ready: ${String(assets.length)} renditions`);
    return { status: 'ready', renditions: assets.length };
  } catch (error) {
    if (error instanceof MediaError && PERMANENT_MEDIA_ERRORS.has(error.code)) {
      return await fail(error.code);
    }
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
