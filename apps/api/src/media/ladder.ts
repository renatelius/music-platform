import {
  type AudioFormat,
  classifyQuality,
  LOSSLESS_CODECS,
  type QualityTier,
} from '@mp/contracts';

export type RenditionCodec = 'aac' | 'opus' | 'flac';

/** One file the worker produces from the master (ARCHITECTURE.md §6.1, ADR-009). */
export interface RenditionSpec {
  readonly codec: RenditionCodec;
  readonly container: 'm4a' | 'webm' | 'flac';
  readonly extension: 'm4a' | 'webm' | 'flac';
  readonly contentType: string;
  /** Nominal bitrate of a lossy rendition; null for FLAC. */
  readonly bitrateKbps: number | null;
  readonly sampleRateHz: number;
  readonly bitDepth: number | null;
  readonly channels: number;
  /** classifyQuality(rendition, source): never more than the source has. */
  readonly quality: QualityTier;
}

export const AAC_LADDER_KBPS: readonly number[] = [96, 160, 256];
export const OPUS_LADDER_KBPS: readonly number[] = [160];
/** Bitrates a capped rendition snaps to, so a 191 kbps VBR source gives 160, not 191. */
const STANDARD_KBPS: readonly number[] = [32, 48, 64, 96, 128, 160, 192, 256, 320];
/** A lossy source with an unknown bitrate is treated as 128 kbps (the safe side). */
export const UNKNOWN_SOURCE_BITRATE_CAP_KBPS = 128;
const CD_BIT_DEPTH = 16;
const MAX_FLAC_BIT_DEPTH = 24;
const MAX_LOSSY_SAMPLE_RATE_HZ = 48_000;
const OPUS_SAMPLE_RATE_HZ = 48_000;

function isLosslessSource(source: AudioFormat): boolean {
  return LOSSLESS_CODECS.has(source.codec);
}

/**
 * Bitrate of a lossy rendition: the target, but never above the source bitrate
 * (re-encoding a 128 kbps MP3 at 256 kbps only makes the file bigger).
 * `null` means the source is too poor for this rung.
 */
export function cappedBitrate(targetKbps: number, source: AudioFormat): number | null {
  if (isLosslessSource(source)) return targetKbps;
  const cap = Math.min(targetKbps, source.bitrateKbps ?? UNKNOWN_SOURCE_BITRATE_CAP_KBPS);
  return STANDARD_KBPS.filter((kbps) => kbps <= cap).at(-1) ?? null;
}

/** 88.2/176.4 kHz go down to 44.1 kHz, 96/192 kHz to 48 kHz (integer ratios). */
function rateFamily(sampleRateHz: number): number {
  return sampleRateHz % 44_100 === 0 ? 44_100 : 48_000;
}

function lossySampleRate(sourceHz: number): number {
  return sourceHz > MAX_LOSSY_SAMPLE_RATE_HZ ? rateFamily(sourceHz) : sourceHz;
}

/**
 * Renditions for a master:
 * - AAC 96/160/256 (m4a) and Opus 160 (webm), capped by the source bitrate;
 * - FLAC CD-quality (16-bit) only for a lossless master;
 * - FLAC at the original resolution (up to 24-bit) only for a Hi-Res master.
 * An empty list means the source is below the lowest rung.
 */
export function planRenditions(source: AudioFormat): RenditionSpec[] {
  const channels = Math.min(source.channels, 2);
  const specs: RenditionSpec[] = [];

  const add = (spec: Omit<RenditionSpec, 'quality'>): void => {
    const duplicate = specs.some(
      (s) =>
        s.codec === spec.codec &&
        s.bitrateKbps === spec.bitrateKbps &&
        s.sampleRateHz === spec.sampleRateHz &&
        s.bitDepth === spec.bitDepth,
    );
    if (duplicate) return;
    const quality = classifyQuality(
      {
        codec: spec.codec,
        sampleRateHz: spec.sampleRateHz,
        bitDepth: spec.bitDepth,
        bitrateKbps: spec.bitrateKbps,
        channels: spec.channels,
      },
      source,
    );
    specs.push({ ...spec, quality });
  };

  for (const target of AAC_LADDER_KBPS) {
    const kbps = cappedBitrate(target, source);
    if (kbps === null) continue;
    add({
      codec: 'aac',
      container: 'm4a',
      extension: 'm4a',
      contentType: 'audio/mp4',
      bitrateKbps: kbps,
      sampleRateHz: lossySampleRate(source.sampleRateHz),
      bitDepth: null,
      channels,
    });
  }

  for (const target of OPUS_LADDER_KBPS) {
    const kbps = cappedBitrate(target, source);
    if (kbps === null) continue;
    add({
      codec: 'opus',
      container: 'webm',
      extension: 'webm',
      contentType: 'audio/webm',
      bitrateKbps: kbps,
      sampleRateHz: OPUS_SAMPLE_RATE_HZ,
      bitDepth: null,
      channels,
    });
  }

  if (isLosslessSource(source)) {
    const depth = Math.min(source.bitDepth ?? CD_BIT_DEPTH, MAX_FLAC_BIT_DEPTH);
    const flac = {
      codec: 'flac',
      container: 'flac',
      extension: 'flac',
      contentType: 'audio/flac',
      bitrateKbps: null,
      channels: source.channels,
    } as const;
    if (classifyQuality(source, source) === 'hires') {
      add({ ...flac, sampleRateHz: source.sampleRateHz, bitDepth: depth });
    }
    add({
      ...flac,
      sampleRateHz:
        source.sampleRateHz > MAX_LOSSY_SAMPLE_RATE_HZ
          ? rateFamily(source.sampleRateHz)
          : source.sampleRateHz,
      bitDepth: Math.min(depth, CD_BIT_DEPTH),
    });
  }

  return specs;
}

/** Stable file name of a rendition, e.g. "aac-160", "opus-128", "flac-24-96000". */
export function renditionName(spec: RenditionSpec): string {
  if (spec.bitrateKbps !== null) return `${spec.codec}-${String(spec.bitrateKbps)}`;
  return `${spec.codec}-${String(spec.bitDepth ?? CD_BIT_DEPTH)}-${String(spec.sampleRateHz)}`;
}
