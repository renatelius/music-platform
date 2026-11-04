import { MediaError, type MediaTools, runTool } from './tools.js';

/** ReplayGain 2.0 reference level. */
export const REPLAYGAIN_REFERENCE_LUFS = -18;
/** EBU R128 absolute gate: a programme that never rises above it is silence. */
const SILENCE_GATE_LUFS = -70;

export interface LoudnessResult {
  readonly integratedLufs: number;
  readonly truePeakDbtp: number;
  readonly loudnessRangeLu: number | null;
  /** Gain that brings the track to the ReplayGain reference (-18 LUFS). */
  readonly replayGainDb: number;
}

export interface AnalysisResult {
  readonly loudness: LoudnessResult;
  /** Digital silence or below the absolute gate for the whole file. */
  readonly silent: boolean;
  /** Decoder errors (damaged frames). Empty for a clean file. */
  readonly decodeErrors: readonly string[];
}

function parseLevel(value: string): number {
  if (value.endsWith('inf')) return value.startsWith('-') ? -Infinity : Infinity;
  return Number(value);
}

const LEVEL = String.raw`(-?(?:\d+(?:\.\d+)?|inf))`;
const INTEGRATED = new RegExp(String.raw`\bI:\s+${LEVEL}\s+LUFS`);
const PEAK = new RegExp(String.raw`\bPeak:\s+${LEVEL}\s+dBFS`);
const RANGE = /\bLRA:\s+(-?\d+(?:\.\d+)?)\s+LU\b/;
const ERROR_LINE = /\[(?:error|fatal)\]/;

/**
 * Decodes the whole file once: measures EBU R128 loudness and true peak, and collects
 * decoder errors on the way. `-loglevel level+info` prefixes every line with its level,
 * which is how damaged frames are told apart from the loudness summary.
 */
export async function analyzeAudio(
  tools: MediaTools,
  file: string,
  timeoutMs = 10 * 60_000,
): Promise<AnalysisResult> {
  const result = await runTool(
    tools.ffmpegPath,
    [
      '-hide_banner',
      '-nostats',
      '-nostdin',
      '-loglevel',
      'level+info',
      '-i',
      file,
      '-map',
      '0:a:0',
      '-af',
      'ebur128=peak=true:framelog=quiet',
      '-f',
      'null',
      '-',
    ],
    timeoutMs,
  );

  const lines = result.stderr.split(/\r?\n/);
  const decodeErrors = lines.filter((line) => ERROR_LINE.test(line)).map((line) => line.trim());
  if (result.exitCode !== 0) {
    throw new MediaError('unreadable', decodeErrors[0] ?? 'ffmpeg could not decode the file');
  }

  const summaryAt = result.stderr.lastIndexOf('Summary:');
  if (summaryAt === -1) throw new MediaError('tool_failed', 'ebur128 printed no summary');
  const summary = result.stderr.slice(summaryAt);

  const integrated = INTEGRATED.exec(summary)?.[1];
  const peak = PEAK.exec(summary)?.[1];
  if (integrated === undefined || peak === undefined) {
    throw new MediaError('tool_failed', 'could not read the ebur128 summary');
  }
  const range = RANGE.exec(summary)?.[1];

  const integratedLufs = parseLevel(integrated);
  const truePeakDbtp = parseLevel(peak);
  return {
    loudness: {
      integratedLufs,
      truePeakDbtp,
      loudnessRangeLu: range === undefined ? null : Number(range),
      replayGainDb: Math.round((REPLAYGAIN_REFERENCE_LUFS - integratedLufs) * 100) / 100,
    },
    silent: integratedLufs <= SILENCE_GATE_LUFS + 0.05 || !Number.isFinite(truePeakDbtp),
    decodeErrors,
  };
}
