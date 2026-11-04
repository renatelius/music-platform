import { z } from 'zod';

export const AudioCodec = z.enum(['mp3', 'aac', 'opus', 'vorbis', 'flac', 'alac', 'pcm']);
export type AudioCodec = z.infer<typeof AudioCodec>;

export const LOSSLESS_CODECS: ReadonlySet<AudioCodec> = new Set<AudioCodec>([
  'flac',
  'alac',
  'pcm',
]);

export const QualityTier = z.enum(['lossy', 'lossless', 'hires']);
export type QualityTier = z.infer<typeof QualityTier>;

export const AudioFormat = z.object({
  codec: AudioCodec,
  sampleRateHz: z.number().int().min(8_000).max(768_000),
  /** Bits per sample. `null` for lossy codecs where it is not meaningful. */
  bitDepth: z.number().int().min(8).max(32).nullable(),
  /** Average bitrate. `null` when unknown. */
  bitrateKbps: z.number().int().positive().nullable(),
  channels: z.number().int().min(1).max(16),
});
export type AudioFormat = z.infer<typeof AudioFormat>;

/** CD quality: 16-bit / 44.1 kHz. Above 48 kHz or 16 bit counts as Hi-Res. */
const HIRES_MIN_SAMPLE_RATE_EXCLUSIVE = 48_000;
const HIRES_MIN_BIT_DEPTH_EXCLUSIVE = 16;
const DEFAULT_PCM_BIT_DEPTH = 16;

/**
 * Honest quality classification of a delivered rendition (BRIEF.md: "never present
 * a compressed file as Lossless or Hi-Res").
 *
 * - Lossy if the rendition OR the original source is lossy
 *   (a FLAC transcoded from an MP3 is still lossy).
 * - Hi-Res only if the effective resolution, capped by the source, exceeds
 *   16-bit / 48 kHz (an upsampled file is not Hi-Res).
 */
export function classifyQuality(rendition: AudioFormat, source: AudioFormat): QualityTier {
  if (!LOSSLESS_CODECS.has(rendition.codec) || !LOSSLESS_CODECS.has(source.codec)) {
    return 'lossy';
  }
  const sampleRate = Math.min(rendition.sampleRateHz, source.sampleRateHz);
  const bitDepth = Math.min(
    rendition.bitDepth ?? DEFAULT_PCM_BIT_DEPTH,
    source.bitDepth ?? DEFAULT_PCM_BIT_DEPTH,
  );
  return sampleRate > HIRES_MIN_SAMPLE_RATE_EXCLUSIVE || bitDepth > HIRES_MIN_BIT_DEPTH_EXCLUSIVE
    ? 'hires'
    : 'lossless';
}

const CODEC_LABEL: Record<AudioCodec, string> = {
  mp3: 'MP3',
  aac: 'AAC',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  alac: 'ALAC',
  pcm: 'PCM',
};

function formatKhz(hz: number): string {
  const khz = hz / 1000;
  return Number.isInteger(khz) ? String(khz) : khz.toFixed(1);
}

/** Human-readable format for the player badge, e.g. "FLAC 24-bit / 96 kHz", "AAC 256 kbps". */
export function describeFormat(format: AudioFormat): string {
  const label = CODEC_LABEL[format.codec];
  if (LOSSLESS_CODECS.has(format.codec)) {
    const depth = String(format.bitDepth ?? DEFAULT_PCM_BIT_DEPTH);
    return `${label} ${depth}-bit / ${formatKhz(format.sampleRateHz)} kHz`;
  }
  if (format.bitrateKbps === null) return `${label} / ${formatKhz(format.sampleRateHz)} kHz`;
  return `${label} ${String(format.bitrateKbps)} kbps`;
}
