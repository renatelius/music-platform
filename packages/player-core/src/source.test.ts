import type { StreamSource, TrackStream } from '@mp/contracts';
import { describe, expect, it } from 'vitest';

import { chooseSource, createStreamResolver, NotPlayableError, replayGainDb } from './source.js';

function source(codec: 'aac' | 'opus' | 'flac', bitrateKbps: number | null): StreamSource {
  const lossless = codec === 'flac';
  return {
    codec,
    container: codec === 'aac' ? 'm4a' : codec === 'opus' ? 'webm' : 'flac',
    mimeType:
      codec === 'aac'
        ? 'audio/mp4; codecs="mp4a.40.2"'
        : codec === 'opus'
          ? 'audio/webm; codecs="opus"'
          : 'audio/flac',
    bitrateKbps,
    sampleRateHz: codec === 'opus' ? 48_000 : 44_100,
    bitDepth: lossless ? 16 : null,
    channels: 2,
    quality: lossless ? 'lossless' : 'lossy',
    sizeBytes: 1000,
    url: `/media/${codec}${String(bitrateKbps ?? 0)}.sig`,
  };
}

const ALL = [
  source('flac', null),
  source('aac', 256),
  source('opus', 160),
  source('aac', 160),
  source('aac', 96),
];
const everything = () => true;
const noOpus = (mime: string) => !mime.includes('opus');

describe('chooseSource', () => {
  it('prefers Opus, then the highest AAC when Opus does not play', () => {
    expect(chooseSource(ALL, everything)?.url).toBe('/media/opus160.sig');
    expect(chooseSource(ALL, noOpus)?.url).toBe('/media/aac256.sig');
  });

  it('saves data and plays lossless only on request', () => {
    expect(chooseSource(ALL, everything, 'data-saver')?.url).toBe('/media/aac96.sig');
    expect(chooseSource(ALL, everything, 'lossless')?.codec).toBe('flac');
    const lossy = ALL.filter((s) => s.codec !== 'flac');
    expect(chooseSource(lossy, everything, 'lossless')?.url).toBe('/media/opus160.sig');
  });

  it('returns null when nothing plays', () => {
    expect(chooseSource(ALL, () => false)).toBeNull();
    expect(chooseSource([], everything)).toBeNull();
  });
});

describe('replayGainDb', () => {
  const loudness = { integratedLufs: -12, truePeakDbtp: -0.5, replayGainDb: -6 };

  it('applies ReplayGain plus preamp and never pushes the true peak above -1 dBTP', () => {
    expect(replayGainDb(loudness, { mode: 'track', preampDb: 0 })).toBe(-6);
    expect(replayGainDb(loudness, { mode: 'track', preampDb: 3 })).toBe(-3);
    const quiet = { integratedLufs: -26, truePeakDbtp: -4, replayGainDb: 8 };
    expect(replayGainDb(quiet, { mode: 'track', preampDb: 0 })).toBe(3);
  });

  it('is zero when off or unknown', () => {
    expect(replayGainDb(loudness, { mode: 'off', preampDb: 3 })).toBe(0);
    expect(replayGainDb(null, { mode: 'track', preampDb: 0 })).toBe(0);
  });
});

class NotFound extends Error {}

describe('createStreamResolver', () => {
  let now = 0;
  let calls: string[] = [];
  const stream = (trackId: string, expiresInMs = 3_600_000): TrackStream => ({
    trackId,
    durationMs: 180_000,
    expiresAt: new Date(now + expiresInMs).toISOString(),
    loudness: null,
    sources: ALL,
  });

  function resolver(canPlay: (mime: string) => boolean = everything) {
    calls = [];
    return createStreamResolver({
      fetchStream: (trackId) => {
        calls.push(trackId);
        if (trackId === 'gone') return Promise.reject(new NotFound('404'));
        if (trackId === 'down') return Promise.reject(new Error('network'));
        return Promise.resolve(stream(trackId));
      },
      mediaUrl: (path) => `/api${path}`,
      canPlay,
      preference: () => 'auto',
      isNotFound: (error) => error instanceof NotFound,
      now: () => now,
    });
  }

  it('resolves to an absolute URL and caches until shortly before expiry', async () => {
    now = Date.parse('2026-11-05T10:00:00Z');
    const r = resolver();
    expect((await r.resolve('t1')).url).toBe('/api/media/opus160.sig');
    await r.resolve('t1');
    expect(calls).toEqual(['t1']);
    now += 3_600_000 - 30_000;
    await r.resolve('t1');
    expect(calls).toEqual(['t1', 't1']);
    r.invalidate('t1');
    await r.resolve('t1');
    expect(calls).toEqual(['t1', 't1', 't1']);
  });

  it('tells unplayable tracks from network failures', async () => {
    const r = resolver();
    await expect(r.resolve('gone')).rejects.toBeInstanceOf(NotPlayableError);
    await expect(r.resolve('down')).rejects.toThrow('network');
    await expect(resolver(() => false).resolve('t1')).rejects.toMatchObject({
      reason: 'unsupported',
    });
    // A failed request is not cached.
    const again = resolver();
    await again.resolve('down').catch(() => undefined);
    await again.resolve('down').catch(() => undefined);
    expect(calls).toEqual(['down', 'down']);
  });
});
