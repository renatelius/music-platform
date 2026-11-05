import { describe, expect, it } from 'vitest';

import {
  evaluateRow,
  FMA_LICENSE_LABELS,
  type FmaRow,
  licenseName,
  normalizeRow,
  sourcePage,
} from './fma.js';

const label = (name: string): number => {
  const index = FMA_LICENSE_LABELS.indexOf(name);
  if (index === -1) throw new Error(`no label ${name}`);
  return index;
};

const base: FmaRow = {
  index: 0,
  title: 'Moonlight',
  url: 'https://freemusicarchive.org/music/Kai_Engel/Irsens_Tale/Moonlight/',
  artist: 'Kai Engel',
  artistUrl: 'https://freemusicarchive.org/music/Kai_Engel/',
  albumTitle: "Irsen's Tale",
  albumUrl: 'https://freemusicarchive.org/music/Kai_Engel/Irsens_Tale',
  license: label('CC-BY 4.0'),
  released: '2015-11-05',
  explicit: 0,
  instrumental: 1,
  allowCommercialUse: 1,
  allowDerivatives: 1,
};

describe('FMA license labels', () => {
  it('follows the numbering of the dataset YAML, not the README table', () => {
    expect(FMA_LICENSE_LABELS).toHaveLength(35);
    expect(licenseName(4)).toBe('CC-BY 4.0');
    expect(licenseName(18)).toBe('CC-BY-NC-SA 3.0');
    expect(licenseName(27)).toBe('CC-BY-SA 4.0');
    expect(licenseName(30)).toBe('CC0 1.0');
    expect(licenseName(31)).toBe('FMA Sound Recording Common Law');
    expect(licenseName(34)).toBe('Public Domain Mark 1.0');
    expect(licenseName(99)).toBe('unknown license #99');
    expect(licenseName(null)).toBeNull();
  });
});

describe('normalizeRow', () => {
  it('turns Parquet values into plain JSON values', () => {
    const row = normalizeRow(
      {
        title: '  Moon \n light ',
        url: 'https://freemusicarchive.org/music/A/B/C',
        artist: 'A',
        artist_url: '',
        album_title: null,
        license: 30n,
        released: new Date('2012-04-01T12:00:00Z'),
        explicit: 0n,
        instrumental: 1,
        allow_commercial_use: 1n,
        allow_derivatives: 1n,
        listens: 12n,
      },
      7,
    );
    expect(row).toEqual({
      index: 7,
      title: 'Moon light',
      url: 'https://freemusicarchive.org/music/A/B/C',
      artist: 'A',
      artistUrl: null,
      albumTitle: null,
      albumUrl: null,
      license: 30,
      released: '2012-04-01',
      explicit: 0,
      instrumental: 1,
      allowCommercialUse: 1,
      allowDerivatives: 1,
    });
  });

  it('reads epoch timestamps in seconds, milliseconds and microseconds', () => {
    const at = Date.UTC(2010, 5, 15) / 1000;
    for (const value of [BigInt(at), at * 1000, BigInt(at) * 1_000_000n]) {
      expect(normalizeRow({ released: value }, 0).released).toBe('2010-06-15');
    }
    expect(normalizeRow({ released: 'garbage' }, 0).released).toBeNull();
    expect(normalizeRow(null, 3)).toMatchObject({ index: 3, title: null, license: null });
  });
});

describe('sourcePage', () => {
  it('uses the path of FMA pages as the external id', () => {
    expect(sourcePage('http://www.freemusicarchive.org/music/A/B/')).toEqual({
      id: '/music/A/B',
      url: 'https://freemusicarchive.org/music/A/B',
    });
    expect(sourcePage('https://example.org/x/')).toEqual({
      id: 'example.org/x',
      url: 'https://example.org/x',
    });
    expect(sourcePage('https://freemusicarchive.org/')).toBeNull();
    expect(sourcePage('ftp://example.org/x')).toBeNull();
    expect(sourcePage('not a url')).toBeNull();
    expect(sourcePage(null)).toBeNull();
  });
});

describe('evaluateRow', () => {
  it('accepts CC BY and maps the row to artist, album, track and rights', () => {
    const decision = evaluateRow(base);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.license).toBe('CC BY 4.0');
    expect(decision.entry).toEqual({
      externalId: '/music/Kai_Engel/Irsens_Tale/Moonlight',
      title: 'Moonlight',
      explicit: false,
      instrumental: true,
      artist: {
        externalId: '/music/Kai_Engel',
        name: 'Kai Engel',
        url: 'https://freemusicarchive.org/music/Kai_Engel',
      },
      release: {
        externalId: '/music/Kai_Engel/Irsens_Tale',
        title: "Irsen's Tale",
        type: 'album',
        releaseDate: '2015-11-05',
        url: 'https://freemusicarchive.org/music/Kai_Engel/Irsens_Tale',
      },
      rights: {
        license: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        attribution: '"Moonlight" by Kai Engel, licensed under CC BY 4.0',
        sourceUrl: 'https://freemusicarchive.org/music/Kai_Engel/Irsens_Tale/Moonlight',
        allowOffline: true,
      },
    });
  });

  it('accepts every open license and nothing else', () => {
    const open = new Map([
      ['CC0 1.0', 'CC0 1.0'],
      ['Public Domain Mark 1.0', 'Public Domain Mark 1.0'],
      ['CC-BY 1.0', 'CC BY 1.0'],
      ['CC-BY 3.0', 'CC BY 3.0'],
      ['CC-BY-SA 2.5', 'CC BY-SA 2.5'],
      ['CC-BY-SA 4.0', 'CC BY-SA 4.0'],
    ]);
    for (const name of FMA_LICENSE_LABELS) {
      const decision = evaluateRow({ ...base, license: label(name) });
      const allowed =
        name === 'CC0 1.0' || name === 'Public Domain Mark 1.0' || /^CC-BY(-SA)? /.test(name);
      expect(decision.ok, name).toBe(allowed);
      if (!decision.ok) {
        expect(decision).toMatchObject({ reason: 'license_not_allowed', license: name });
      } else if (open.has(name)) {
        expect(decision.license).toBe(open.get(name));
      }
    }
    expect(evaluateRow({ ...base, license: null })).toMatchObject({
      ok: false,
      reason: 'license_not_allowed',
      license: null,
    });
  });

  it('rejects an open license whose flags forbid commercial use or derivatives', () => {
    for (const flags of [
      { allowCommercialUse: 0 },
      { allowDerivatives: 0 },
      { allowCommercialUse: null },
    ]) {
      expect(evaluateRow({ ...base, ...flags })).toMatchObject({
        ok: false,
        reason: 'license_flags_not_open',
      });
    }
  });

  it('rejects rows without title, artist or track page', () => {
    expect(evaluateRow({ ...base, title: null })).toMatchObject({ reason: 'missing_title' });
    expect(evaluateRow({ ...base, artist: null })).toMatchObject({ reason: 'missing_artist' });
    expect(evaluateRow({ ...base, url: null })).toMatchObject({ reason: 'missing_source_url' });
  });

  it('makes a single for a track without album and credits public domain works', () => {
    const decision = evaluateRow({
      ...base,
      albumTitle: null,
      albumUrl: null,
      artistUrl: null,
      license: label('CC0 1.0'),
      instrumental: null,
      explicit: 1,
    });
    if (!decision.ok) throw new Error(decision.reason);
    expect(decision.entry.release).toEqual({
      externalId: 'single:/music/Kai_Engel/Irsens_Tale/Moonlight',
      title: 'Moonlight',
      type: 'single',
      releaseDate: '2015-11-05',
      url: null,
    });
    expect(decision.entry.artist.externalId).toBe('name:kai engel');
    expect(decision.entry.explicit).toBe(true);
    expect(decision.entry.instrumental).toBeNull();
    expect(decision.entry.rights.attribution).toBe(
      '"Moonlight" by Kai Engel, dedicated to the public domain (CC0 1.0)',
    );
  });

  it('keys an album without a page by artist and title', () => {
    const decision = evaluateRow({ ...base, albumUrl: null });
    if (!decision.ok) throw new Error(decision.reason);
    expect(decision.entry.release.externalId).toBe("album:/music/Kai_Engel:irsen's tale");
  });
});
