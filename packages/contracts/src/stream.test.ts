import { describe, expect, it } from 'vitest';

import { contentTypeFor, mimeTypeFor, StreamSource, TrackStream } from './stream.js';

const source = {
  codec: 'opus',
  container: 'webm',
  mimeType: 'audio/webm; codecs="opus"',
  bitrateKbps: 128,
  sampleRateHz: 48_000,
  bitDepth: null,
  channels: 2,
  quality: 'lossy',
  sizeBytes: 4_000_000,
  url: '/media/eyJrIjoieCJ9.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
};

describe('stream contracts', () => {
  it('maps containers and codecs to media types', () => {
    expect(contentTypeFor('m4a')).toBe('audio/mp4');
    expect(contentTypeFor('webm')).toBe('audio/webm');
    expect(contentTypeFor('xyz')).toBe('application/octet-stream');
    expect(mimeTypeFor('aac', 'm4a')).toBe('audio/mp4; codecs="mp4a.40.2"');
    expect(mimeTypeFor('opus', 'webm')).toBe('audio/webm; codecs="opus"');
    expect(mimeTypeFor('flac', 'flac')).toBe('audio/flac');
  });

  it('accepts only signed media paths as source links', () => {
    expect(StreamSource.parse(source)).toEqual(source);
    for (const url of [
      'https://evil.example/x',
      '/media/../secret',
      '/media/abc',
      'javascript:1',
    ]) {
      expect(StreamSource.safeParse({ ...source, url }).success, url).toBe(false);
    }
  });

  it('requires at least one source', () => {
    const stream = {
      trackId: '019a5f2e-8c1b-7a3d-9f00-0123456789ab',
      durationMs: 215_000,
      expiresAt: '2026-11-05T10:00:00.000Z',
      loudness: { integratedLufs: -14.2, truePeakDbtp: -0.8, replayGainDb: -3.8 },
      sources: [source],
    };
    expect(TrackStream.parse(stream)).toEqual(stream);
    expect(TrackStream.safeParse({ ...stream, sources: [] }).success).toBe(false);
    expect(TrackStream.safeParse({ ...stream, loudness: null }).success).toBe(true);
  });
});
