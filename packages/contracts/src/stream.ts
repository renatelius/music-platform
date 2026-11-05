import { z } from 'zod';

import { AudioCodec, QualityTier } from './audio.js';
import { Id, IsoDateTime } from './common.js';

/** Content-Type of a rendition file by container. */
export function contentTypeFor(container: string): string {
  switch (container) {
    case 'm4a':
      return 'audio/mp4';
    case 'webm':
      return 'audio/webm';
    case 'flac':
      return 'audio/flac';
    case 'ogg':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
}

/** Type with codecs for `canPlayType` / `MediaSource.isTypeSupported`. */
export function mimeTypeFor(codec: AudioCodec, container: string): string {
  if (codec === 'aac' && container === 'm4a') return 'audio/mp4; codecs="mp4a.40.2"';
  if (codec === 'opus' && container === 'webm') return 'audio/webm; codecs="opus"';
  if (codec === 'opus' && container === 'ogg') return 'audio/ogg; codecs="opus"';
  if (codec === 'flac') return 'audio/flac';
  return contentTypeFor(container);
}

/** Path of a signed media link, relative to the API base URL. */
export const MEDIA_PATH = /^\/media\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** One rendition the client may play. */
export const StreamSource = z.object({
  codec: AudioCodec,
  container: z.string().min(1),
  mimeType: z.string().min(1),
  bitrateKbps: z.number().int().positive().nullable(),
  sampleRateHz: z.number().int().positive(),
  bitDepth: z.number().int().positive().nullable(),
  channels: z.number().int().positive(),
  quality: QualityTier,
  sizeBytes: z.number().int().positive(),
  /** `/media/<token>`: relative to the API base URL, valid until `expiresAt`, supports Range. */
  url: z.string().regex(MEDIA_PATH),
});
export type StreamSource = z.infer<typeof StreamSource>;

/** EBU R128 measurement of the original (ReplayGain 2.0 reference: -18 LUFS). */
export const TrackLoudnessInfo = z.object({
  integratedLufs: z.number(),
  truePeakDbtp: z.number(),
  replayGainDb: z.number(),
});
export type TrackLoudnessInfo = z.infer<typeof TrackLoudnessInfo>;

/** Everything a player needs to play one track. */
export const TrackStream = z.object({
  trackId: Id,
  durationMs: z.number().int().positive(),
  expiresAt: IsoDateTime,
  loudness: TrackLoudnessInfo.nullable(),
  /** Best first: higher quality tier, then higher bitrate. The client picks what it can play. */
  sources: z.array(StreamSource).min(1),
});
export type TrackStream = z.infer<typeof TrackStream>;
