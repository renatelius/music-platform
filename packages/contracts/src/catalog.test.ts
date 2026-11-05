import { describe, expect, it } from 'vitest';

import { HttpUrl, SearchQuery, SuggestQuery, TrackDto } from './catalog.js';

const track = {
  id: '019a5f2e-8c1b-7a3d-9f00-0123456789ab',
  title: 'Moonlight',
  durationMs: 215_000,
  discNumber: 1,
  trackNumber: null,
  explicit: false,
  artists: [{ id: '019a5f2e-8c1b-7a3d-9f00-0123456789ac', name: 'Kai Engel' }],
  release: { id: '019a5f2e-8c1b-7a3d-9f00-0123456789ad', title: "Irsen's Tale" },
  quality: {
    tier: 'lossy',
    format: { codec: 'aac', sampleRateHz: 44_100, bitDepth: null, bitrateKbps: 128, channels: 2 },
  },
  license: {
    name: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: '"Moonlight" by Kai Engel, licensed under CC BY 4.0',
    sourceUrl: 'https://freemusicarchive.org/music/Kai_Engel/Irsens_Tale/Moonlight',
  },
};

describe('catalog contracts', () => {
  it('accepts a full track', () => {
    expect(TrackDto.parse(track)).toEqual(track);
  });

  it('allows only http(s) links', () => {
    expect(HttpUrl.safeParse('https://example.org/x').success).toBe(true);
    expect(HttpUrl.safeParse('http://example.org').success).toBe(true);
    expect(HttpUrl.safeParse('javascript:alert(1)').success).toBe(false);
    expect(HttpUrl.safeParse('ftp://example.org').success).toBe(false);
    expect(
      TrackDto.safeParse({ ...track, license: { ...track.license, sourceUrl: 'data:text/html,x' } })
        .success,
    ).toBe(false);
  });

  it('normalizes the search query and applies limits', () => {
    expect(SearchQuery.parse({ q: '  kai \n\t engel ' })).toEqual({ q: 'kai engel', limit: 10 });
    expect(SearchQuery.parse({ q: 'x', limit: '50' }).limit).toBe(50);
    expect(SuggestQuery.parse({ q: 'x' }).limit).toBe(8);
  });

  it('rejects empty, too long and control-character queries', () => {
    for (const q of ['', '   ', 'a'.repeat(101), 'bad\u0000query', 'bell\u0007query']) {
      expect(SearchQuery.safeParse({ q }).success, JSON.stringify(q)).toBe(false);
    }
    expect(SearchQuery.safeParse({ q: ['a', 'b'] }).success).toBe(false);
    expect(SearchQuery.safeParse({ q: 'a', limit: '51' }).success).toBe(false);
    expect(SuggestQuery.safeParse({ q: 'a', limit: '11' }).success).toBe(false);
  });
});
