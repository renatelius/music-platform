import type { AudioFormat } from '@mp/contracts';
import { describe, expect, it } from 'vitest';

import { cappedBitrate, planRenditions, renditionName } from './ladder.js';

const cd: AudioFormat = {
  codec: 'flac',
  sampleRateHz: 44_100,
  bitDepth: 16,
  bitrateKbps: 900,
  channels: 2,
};
const hires: AudioFormat = {
  codec: 'flac',
  sampleRateHz: 96_000,
  bitDepth: 24,
  bitrateKbps: 3000,
  channels: 2,
};
const mp3 = (bitrateKbps: number | null): AudioFormat => ({
  codec: 'mp3',
  sampleRateHz: 44_100,
  bitDepth: null,
  bitrateKbps,
  channels: 2,
});

const names = (source: AudioFormat) => planRenditions(source).map(renditionName);

describe('rendition ladder', () => {
  it('gives a CD-quality master the full lossy ladder and a lossless FLAC', () => {
    const specs = planRenditions(cd);
    expect(specs.map(renditionName)).toEqual([
      'aac-96',
      'aac-160',
      'aac-256',
      'opus-160',
      'flac-16-44100',
    ]);
    expect(specs.find((s) => s.codec === 'aac')?.sampleRateHz).toBe(44_100);
    expect(specs.find((s) => s.codec === 'opus')?.sampleRateHz).toBe(48_000);
    expect(specs.find((s) => s.codec === 'flac')?.quality).toBe('lossless');
    expect(specs.filter((s) => s.codec !== 'flac').every((s) => s.quality === 'lossy')).toBe(true);
  });

  it('keeps a Hi-Res master as is and adds a CD-quality FLAC from the same rate family', () => {
    const specs = planRenditions(hires);
    expect(specs.map(renditionName)).toEqual([
      'aac-96',
      'aac-160',
      'aac-256',
      'opus-160',
      'flac-24-96000',
      'flac-16-48000',
    ]);
    expect(specs.find((s) => renditionName(s) === 'flac-24-96000')?.quality).toBe('hires');
    expect(specs.find((s) => renditionName(s) === 'flac-16-48000')?.quality).toBe('lossless');
    expect(specs.find((s) => s.codec === 'aac')?.sampleRateHz).toBe(48_000);
  });

  it('never makes FLAC or a higher bitrate from a 128 kbps MP3', () => {
    const specs = planRenditions(mp3(128));
    expect(specs.map(renditionName)).toEqual(['aac-96', 'aac-128', 'opus-128']);
    expect(specs.every((s) => s.quality === 'lossy')).toBe(true);
    expect(specs.every((s) => (s.bitrateKbps ?? 0) <= 128)).toBe(true);
  });

  it('snaps a VBR source to a standard bitrate below it', () => {
    expect(names(mp3(191))).toEqual(['aac-96', 'aac-160', 'opus-160']);
    expect(cappedBitrate(256, mp3(191))).toBe(160);
  });

  it('treats an unknown lossy bitrate as 128 kbps', () => {
    expect(names(mp3(null))).toEqual(['aac-96', 'aac-128', 'opus-128']);
  });

  it('returns nothing for a source below the lowest rung', () => {
    expect(planRenditions(mp3(24))).toEqual([]);
  });

  it('keeps mono as mono', () => {
    expect(planRenditions({ ...cd, channels: 1 }).every((s) => s.channels === 1)).toBe(true);
  });
});
