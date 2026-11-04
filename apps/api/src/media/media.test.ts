// Runs the real FFmpeg on synthetic files it generates itself: no copyrighted audio in the
// repository, and every expected value (format, loudness) is known exactly.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classifyQuality } from '@mp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  analyzeAudio,
  checkMediaTools,
  MediaError,
  type MediaTools,
  probeAudio,
  runTool,
} from './index.js';

function envOr(value: string | undefined, fallback: string): string {
  return value !== undefined && value !== '' ? value : fallback;
}

const tools: MediaTools = {
  ffmpegPath: envOr(process.env.FFMPEG_PATH, 'ffmpeg'),
  ffprobePath: envOr(process.env.FFPROBE_PATH, 'ffprobe'),
};

/** 997 Hz sine at -23 dBFS in both channels: -23 LUFS by the EBU R128 definition. */
const SINE = '0.0707946*sin(2*PI*997*t)';

function tone(sampleRate: number, seconds: number): string[] {
  return [
    '-f',
    'lavfi',
    '-i',
    `aevalsrc=${SINE}|${SINE}:s=${String(sampleRate)}:d=${String(seconds)}`,
  ];
}

async function ffmpeg(args: string[]): Promise<void> {
  const result = await runTool(
    tools.ffmpegPath,
    ['-hide_banner', '-loglevel', 'error', '-y', ...args],
    60_000,
  );
  if (result.exitCode !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}

describe('media (FFmpeg)', () => {
  let dir: string;
  const file = (name: string) => join(dir, name);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mp-media-test-'));
    await ffmpeg([...tone(44_100, 3), '-c:a', 'flac', '-sample_fmt', 's16', file('cd.flac')]);
    // The FLAC encoder stores 32-bit samples as 24 bits per sample.
    await ffmpeg([...tone(96_000, 3), '-c:a', 'flac', '-sample_fmt', 's32', file('hires.flac')]);
    await ffmpeg([...tone(44_100, 3), '-c:a', 'libmp3lame', '-b:a', '128k', file('lossy.mp3')]);
    await ffmpeg([...tone(48_000, 10), '-c:a', 'pcm_s16le', file('reference.wav')]);
    await ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=stereo',
      '-t',
      '5',
      '-c:a',
      'flac',
      file('silence.flac'),
    ]);
    await writeFile(file('broken.mp3'), 'this is not an audio file\n'.repeat(200));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('has ffmpeg, ffprobe and every encoder the rendition ladder needs', async () => {
    const status = await checkMediaTools(tools);
    expect(status.version).toMatch(/^ffmpeg version/);
    expect(status.missingEncoders).toEqual([]);
  });

  it('reads a CD-quality FLAC as lossless 16-bit / 44.1 kHz', async () => {
    const probe = await probeAudio(tools, file('cd.flac'));
    expect(probe.format).toMatchObject({
      codec: 'flac',
      sampleRateHz: 44_100,
      bitDepth: 16,
      channels: 2,
    });
    expect(Math.abs(probe.durationMs - 3000)).toBeLessThan(50);
    expect(probe.container).toContain('flac');
    expect(classifyQuality(probe.format, probe.format)).toBe('lossless');
  });

  it('reads a 24-bit / 96 kHz FLAC as Hi-Res', async () => {
    const probe = await probeAudio(tools, file('hires.flac'));
    expect(probe.format).toMatchObject({ codec: 'flac', sampleRateHz: 96_000, bitDepth: 24 });
    expect(classifyQuality(probe.format, probe.format)).toBe('hires');
  });

  it('reads an MP3 as lossy with its bitrate and no bit depth', async () => {
    const probe = await probeAudio(tools, file('lossy.mp3'));
    expect(probe.format).toMatchObject({
      codec: 'mp3',
      sampleRateHz: 44_100,
      bitDepth: null,
      bitrateKbps: 128,
    });
    // Encoder delay and padding add a few milliseconds.
    expect(Math.abs(probe.durationMs - 3000)).toBeLessThan(100);
    expect(classifyQuality(probe.format, probe.format)).toBe('lossy');
  });

  it('reads PCM WAV with its bit depth', async () => {
    const probe = await probeAudio(tools, file('reference.wav'));
    expect(probe.format).toMatchObject({ codec: 'pcm', sampleRateHz: 48_000, bitDepth: 16 });
  });

  it('measures -23 LUFS and -23 dBTP for the EBU reference tone', async () => {
    const analysis = await analyzeAudio(tools, file('reference.wav'));
    expect(Math.abs(analysis.loudness.integratedLufs - -23)).toBeLessThan(0.5);
    expect(Math.abs(analysis.loudness.truePeakDbtp - -23)).toBeLessThan(0.5);
    expect(Math.abs(analysis.loudness.replayGainDb - 5)).toBeLessThan(0.5);
    expect(analysis.silent).toBe(false);
    expect(analysis.decodeErrors).toEqual([]);
  });

  it('decodes a clean MP3 without errors', async () => {
    const analysis = await analyzeAudio(tools, file('lossy.mp3'));
    expect(analysis.decodeErrors).toEqual([]);
    expect(analysis.silent).toBe(false);
  });

  it('recognises digital silence', async () => {
    const analysis = await analyzeAudio(tools, file('silence.flac'));
    expect(analysis.silent).toBe(true);
  });

  it('rejects a file that is not audio with a stable error code', async () => {
    const error: unknown = await probeAudio(tools, file('broken.mp3')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MediaError);
    expect(['unreadable', 'no_audio_stream']).toContain((error as MediaError).code);
  });

  it('reports a missing binary as tool_missing', async () => {
    await expect(runTool('mp-no-such-tool', ['-version'], 5000)).rejects.toMatchObject({
      code: 'tool_missing',
    });
  });
});
