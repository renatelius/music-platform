import type { RenditionSpec } from './ladder.js';
import { MediaError, type MediaTools, runTool } from './tools.js';

function codecArgs(spec: RenditionSpec): string[] {
  switch (spec.codec) {
    case 'aac':
      return [
        '-c:a',
        'aac',
        '-b:a',
        `${String(spec.bitrateKbps)}k`,
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
      ];
    case 'opus':
      return [
        '-c:a',
        'libopus',
        '-b:a',
        `${String(spec.bitrateKbps)}k`,
        '-vbr',
        'on',
        '-f',
        'webm',
      ];
    case 'flac':
      return [
        '-c:a',
        'flac',
        '-compression_level',
        '8',
        // The FLAC encoder stores s32 samples as 24 bits per sample.
        '-sample_fmt',
        (spec.bitDepth ?? 16) > 16 ? 's32' : 's16',
        '-f',
        'flac',
      ];
  }
}

/**
 * Encodes one rendition. Tags and embedded pictures are dropped: metadata lives in the
 * database, and the player gets covers separately.
 */
export async function encodeRendition(
  tools: MediaTools,
  input: string,
  spec: RenditionSpec,
  output: string,
  timeoutMs = 10 * 60_000,
): Promise<void> {
  const result = await runTool(
    tools.ffmpegPath,
    [
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-y',
      '-i',
      input,
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-map_metadata',
      '-1',
      '-ac',
      String(spec.channels),
      '-ar',
      String(spec.sampleRateHz),
      ...codecArgs(spec),
      output,
    ],
    timeoutMs,
  );
  if (result.exitCode !== 0) {
    const reason = result.stderr.split(/\r?\n/).find((line) => line.trim().length > 0);
    throw new MediaError('tool_failed', `encoding ${spec.codec} failed: ${reason ?? 'unknown'}`);
  }
}
