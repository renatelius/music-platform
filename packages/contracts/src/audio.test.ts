import { describe, expect, it } from 'vitest';

import { type AudioFormat, classifyQuality, describeFormat } from './audio.js';

const fmt = (over: Partial<AudioFormat>): AudioFormat => ({
  codec: 'flac',
  sampleRateHz: 44_100,
  bitDepth: 16,
  bitrateKbps: null,
  channels: 2,
  ...over,
});

const cdSource = fmt({});
const hiresSource = fmt({ sampleRateHz: 96_000, bitDepth: 24 });
const mp3Source = fmt({ codec: 'mp3', bitDepth: null, bitrateKbps: 320 });

describe('classifyQuality', () => {
  it('treats lossy renditions as lossy even from a lossless source', () => {
    expect(
      classifyQuality(fmt({ codec: 'aac', bitDepth: null, bitrateKbps: 256 }), hiresSource),
    ).toBe('lossy');
    expect(
      classifyQuality(fmt({ codec: 'opus', bitDepth: null, bitrateKbps: 160 }), cdSource),
    ).toBe('lossy');
  });

  it('never labels FLAC transcoded from MP3 as lossless', () => {
    expect(classifyQuality(fmt({}), mp3Source)).toBe('lossy');
  });

  it('labels CD-quality FLAC from a lossless source as lossless', () => {
    expect(classifyQuality(fmt({}), cdSource)).toBe('lossless');
    expect(
      classifyQuality(fmt({ codec: 'alac', sampleRateHz: 48_000 }), fmt({ sampleRateHz: 48_000 })),
    ).toBe('lossless');
  });

  it('labels 24/96 from a 24/96 source as hires', () => {
    expect(classifyQuality(fmt({ sampleRateHz: 96_000, bitDepth: 24 }), hiresSource)).toBe('hires');
  });

  it('does not treat upsampled audio as hires', () => {
    expect(classifyQuality(fmt({ sampleRateHz: 96_000, bitDepth: 24 }), cdSource)).toBe('lossless');
  });

  it('downsampled hires source to 16/44.1 is lossless, not hires', () => {
    expect(classifyQuality(fmt({}), hiresSource)).toBe('lossless');
  });
});

describe('describeFormat', () => {
  it('describes lossless formats with depth and rate', () => {
    expect(describeFormat(fmt({ sampleRateHz: 96_000, bitDepth: 24 }))).toBe(
      'FLAC 24-bit / 96 kHz',
    );
    expect(describeFormat(fmt({}))).toBe('FLAC 16-bit / 44.1 kHz');
  });

  it('describes lossy formats with bitrate', () => {
    expect(describeFormat(fmt({ codec: 'aac', bitDepth: null, bitrateKbps: 256 }))).toBe(
      'AAC 256 kbps',
    );
    expect(
      describeFormat(
        fmt({ codec: 'opus', bitDepth: null, bitrateKbps: null, sampleRateHz: 48_000 }),
      ),
    ).toBe('Opus / 48 kHz');
  });
});
