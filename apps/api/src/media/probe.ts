import { AudioCodec, AudioFormat, LOSSLESS_CODECS } from '@mp/contracts';
import { z } from 'zod';

import { MediaError, type MediaTools, runTool } from './tools.js';

/** ffprobe prints most numbers as strings ("44100", "128000"); some as numbers. */
const numeric = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  });

const FfprobeStream = z.object({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  sample_rate: numeric,
  channels: z.number().optional(),
  bits_per_raw_sample: numeric,
  bits_per_sample: z.number().optional(),
  sample_fmt: z.string().optional(),
  bit_rate: numeric,
  duration: numeric,
  disposition: z.object({ attached_pic: z.number().optional() }).optional(),
});
type FfprobeStream = z.infer<typeof FfprobeStream>;

const FfprobeOutput = z.object({
  streams: z.array(FfprobeStream).default([]),
  format: z
    .object({
      format_name: z.string().optional(),
      duration: numeric,
      bit_rate: numeric,
      tags: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

export interface ProbeResult {
  /** Format of the first audio stream, in the shape `classifyQuality` expects. */
  readonly format: AudioFormat;
  readonly durationMs: number;
  /** ffprobe container name, e.g. "mp3", "flac", "mov,mp4,m4a,3gp,3g2,mj2". */
  readonly container: string;
  /** An embedded cover image (MP3/FLAC "attached picture"). */
  readonly hasCoverArt: boolean;
  /** Container tags with lower-cased keys (title, artist, album…). */
  readonly tags: Readonly<Record<string, string>>;
}

const SAMPLE_FORMAT_BITS: Readonly<Record<string, number>> = {
  u8: 8,
  u8p: 8,
  s16: 16,
  s16p: 16,
  s32: 32,
  s32p: 32,
};

function mapCodec(name: string): AudioCodec | null {
  if (name.startsWith('pcm_')) return 'pcm';
  const parsed = AudioCodec.safeParse(name);
  return parsed.success ? parsed.data : null;
}

/** Bit depth is meaningful only for lossless codecs (contracts: `null` for lossy). */
function bitDepth(stream: FfprobeStream, codec: AudioCodec): number | null {
  if (!LOSSLESS_CODECS.has(codec)) return null;
  if (stream.bits_per_raw_sample !== undefined && stream.bits_per_raw_sample > 0) {
    return stream.bits_per_raw_sample;
  }
  if (stream.bits_per_sample !== undefined && stream.bits_per_sample > 0) {
    return stream.bits_per_sample;
  }
  return stream.sample_fmt === undefined ? null : (SAMPLE_FORMAT_BITS[stream.sample_fmt] ?? null);
}

function firstLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

/** Reads the technical format of an audio file with ffprobe. */
export async function probeAudio(
  tools: MediaTools,
  file: string,
  timeoutMs = 30_000,
): Promise<ProbeResult> {
  const result = await runTool(
    tools.ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    timeoutMs,
  );
  if (result.exitCode !== 0) {
    throw new MediaError(
      'unreadable',
      firstLine(result.stderr) ?? 'ffprobe could not read the file',
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new MediaError('unreadable', 'ffprobe returned invalid JSON');
  }
  const parsed = FfprobeOutput.safeParse(json);
  if (!parsed.success) throw new MediaError('unreadable', 'unexpected ffprobe output');
  const { streams, format: container } = parsed.data;

  const audio = streams.find((stream) => stream.codec_type === 'audio');
  if (audio === undefined) throw new MediaError('no_audio_stream', 'the file has no audio stream');

  const codec = audio.codec_name === undefined ? null : mapCodec(audio.codec_name);
  if (codec === null) {
    throw new MediaError(
      'unsupported_codec',
      `unsupported codec: ${audio.codec_name ?? 'unknown'}`,
    );
  }

  const durationSec = audio.duration ?? container?.duration;
  if (durationSec === undefined || durationSec <= 0) {
    throw new MediaError('unreadable', 'duration is unknown');
  }

  const bitrate = audio.bit_rate ?? container?.bit_rate;
  const format = AudioFormat.safeParse({
    codec,
    sampleRateHz: audio.sample_rate,
    bitDepth: bitDepth(audio, codec),
    bitrateKbps: bitrate === undefined ? null : Math.round(bitrate / 1000),
    channels: audio.channels,
  });
  if (!format.success) {
    throw new MediaError('unreadable', 'sample rate, channels or bit depth are out of range');
  }

  return {
    format: format.data,
    durationMs: Math.round(durationSec * 1000),
    container: container?.format_name ?? 'unknown',
    hasCoverArt: streams.some(
      (stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic === 1,
    ),
    tags: Object.fromEntries(
      Object.entries(container?.tags ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
    ),
  };
}
