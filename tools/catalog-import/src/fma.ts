// FMA rows (Hugging Face `benjamin-paine/free-music-archive-full`) -> catalog entries.
// Only open licenses pass (ADR-017): CC0, Public Domain Mark, CC BY, CC BY-SA - and only when
// the row's own flags also allow commercial use and derivative works.
import type { CatalogEntry, SourceInfo } from '@mp/api/catalog';
import { formatAttribution, OPEN_LICENSE_URL, type OpenLicense } from '@mp/contracts';
import { z } from 'zod';

export const FMA_DATASET = 'benjamin-paine/free-music-archive-full';

/** Identity of the source in the database: a re-import finds its earlier rows by it. */
export const FMA_SOURCE: SourceInfo = {
  kind: 'fma',
  name: 'free-music-archive-full',
  url: `https://huggingface.co/datasets/${FMA_DATASET}`,
};

/**
 * License names by class label, copied from `dataset_info.features.license` in the front
 * matter of the dataset README. The table in the README text is numbered differently (it has
 * no Public Domain Mark), so it must not be used.
 */
export const FMA_LICENSE_LABELS: readonly string[] = [
  'CC-BY 1.0',
  'CC-BY 2.0',
  'CC-BY 2.5',
  'CC-BY 3.0',
  'CC-BY 4.0',
  'CC-BY-NC 2.0',
  'CC-BY-NC 2.1',
  'CC-BY-NC 2.5',
  'CC-BY-NC 3.0',
  'CC-BY-NC 4.0',
  'CC-BY-NC-ND 2.0',
  'CC-BY-NC-ND 2.1',
  'CC-BY-NC-ND 2.5',
  'CC-BY-NC-ND 3.0',
  'CC-BY-NC-ND 4.0',
  'CC-BY-NC-SA 2.0',
  'CC-BY-NC-SA 2.1',
  'CC-BY-NC-SA 2.5',
  'CC-BY-NC-SA 3.0',
  'CC-BY-NC-SA 4.0',
  'CC-BY-ND 2.0',
  'CC-BY-ND 2.5',
  'CC-BY-ND 3.0',
  'CC-BY-ND 4.0',
  'CC-BY-SA 2.0',
  'CC-BY-SA 2.5',
  'CC-BY-SA 3.0',
  'CC-BY-SA 4.0',
  'CC-NC-Sampling+ 1.0',
  'CC-Sampling+ 1.0',
  'CC0 1.0',
  'FMA Sound Recording Common Law',
  'Free Art License',
  'Free Music Philosophy (FMP)',
  'Public Domain Mark 1.0',
];

/** Allow list by NAME (never by number): FMA name -> canonical open license. */
const ALLOWED = new Map<string, OpenLicense>([
  ['CC0 1.0', 'CC0 1.0'],
  ['Public Domain Mark 1.0', 'Public Domain Mark 1.0'],
  ['CC-BY 1.0', 'CC BY 1.0'],
  ['CC-BY 2.0', 'CC BY 2.0'],
  ['CC-BY 2.5', 'CC BY 2.5'],
  ['CC-BY 3.0', 'CC BY 3.0'],
  ['CC-BY 4.0', 'CC BY 4.0'],
  ['CC-BY-SA 2.0', 'CC BY-SA 2.0'],
  ['CC-BY-SA 2.5', 'CC BY-SA 2.5'],
  ['CC-BY-SA 3.0', 'CC BY-SA 3.0'],
  ['CC-BY-SA 4.0', 'CC BY-SA 4.0'],
]);

/** Parquet columns read for every row: everything except the audio. */
export const FMA_METADATA_COLUMNS = [
  'title',
  'url',
  'artist',
  'artist_url',
  'album_title',
  'album_url',
  'license',
  'released',
  'explicit',
  'instrumental',
  'allow_commercial_use',
  'allow_derivatives',
] as const;

/** One dataset row without audio, normalized (JSON-safe, cached between runs). */
export const FmaRow = z.object({
  /** Row number inside its Parquet part. */
  index: z.number().int().min(0),
  title: z.string().nullable(),
  url: z.string().nullable(),
  artist: z.string().nullable(),
  artistUrl: z.string().nullable(),
  albumTitle: z.string().nullable(),
  albumUrl: z.string().nullable(),
  /** Class label of the license (see FMA_LICENSE_LABELS). */
  license: z.number().int().nullable(),
  /** YYYY-MM-DD */
  released: z.string().nullable(),
  /** Class labels 0 = No, 1 = Yes. */
  explicit: z.number().int().nullable(),
  instrumental: z.number().int().nullable(),
  allowCommercialUse: z.number().int().nullable(),
  allowDerivatives: z.number().int().nullable(),
});
export type FmaRow = z.infer<typeof FmaRow>;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean === '' ? null : clean;
}

function int(value: unknown): number | null {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  return null;
}

/** Epoch value in seconds, milliseconds or microseconds -> Date. */
function fromEpoch(value: number): Date {
  if (value > 1e14) return new Date(value / 1000);
  if (value > 1e11) return new Date(value);
  return new Date(value * 1000);
}

function day(value: unknown): string | null {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (typeof value === 'bigint') date = fromEpoch(Number(value));
  else if (typeof value === 'number') date = fromEpoch(value);
  else if (typeof value === 'string') date = new Date(value);
  if (date === null || Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year < 1900 || year > 2100) return null;
  return date.toISOString().slice(0, 10);
}

/** Raw Parquet row (strings, bigint class labels, Date) -> FmaRow. */
export function normalizeRow(raw: unknown, index: number): FmaRow {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    index,
    title: text(r.title),
    url: text(r.url),
    artist: text(r.artist),
    artistUrl: text(r.artist_url),
    albumTitle: text(r.album_title),
    albumUrl: text(r.album_url),
    license: int(r.license),
    released: day(r.released),
    explicit: int(r.explicit),
    instrumental: int(r.instrumental),
    allowCommercialUse: int(r.allow_commercial_use),
    allowDerivatives: int(r.allow_derivatives),
  };
}

export interface SourcePage {
  /** External id: the page path for FMA pages, host + path for anything else. */
  readonly id: string;
  /** Normalized link for attribution. */
  readonly url: string;
}

const FMA_HOST = 'freemusicarchive.org';

/** Parses a page link; FMA links become `https://freemusicarchive.org/<path>`. */
export function sourcePage(url: string | null): SourcePage | null {
  if (url === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.replace(/\/+$/, '');
  if (host === FMA_HOST) {
    if (path === '') return null;
    return { id: path, url: `https://${FMA_HOST}${path}` };
  }
  return { id: `${host}${path}`, url: `${parsed.protocol}//${host}${path}` };
}

export function licenseName(label: number | null): string | null {
  if (label === null) return null;
  return FMA_LICENSE_LABELS[label] ?? `unknown license #${String(label)}`;
}

export type RejectReason =
  | 'license_not_allowed'
  | 'license_flags_not_open'
  | 'missing_title'
  | 'missing_artist'
  | 'missing_source_url';

export type Decision =
  | { readonly ok: true; readonly entry: CatalogEntry; readonly license: OpenLicense }
  | { readonly ok: false; readonly reason: RejectReason; readonly license: string | null };

/** Applies the license allow list and maps an accepted row to a catalog entry. */
export function evaluateRow(row: FmaRow): Decision {
  const name = licenseName(row.license);
  const license = name === null ? undefined : ALLOWED.get(name);
  if (license === undefined) return { ok: false, reason: 'license_not_allowed', license: name };
  // The row's own flags must agree with the license; on any doubt the track is skipped.
  if (row.allowCommercialUse !== 1 || row.allowDerivatives !== 1) {
    return { ok: false, reason: 'license_flags_not_open', license: name };
  }
  if (row.title === null) return { ok: false, reason: 'missing_title', license: name };
  if (row.artist === null) return { ok: false, reason: 'missing_artist', license: name };
  const page = sourcePage(row.url);
  if (page === null) return { ok: false, reason: 'missing_source_url', license: name };

  const artistPage = sourcePage(row.artistUrl);
  const artistId = artistPage?.id ?? `name:${row.artist.toLowerCase()}`;
  const albumPage = sourcePage(row.albumUrl);
  const release: CatalogEntry['release'] =
    row.albumTitle === null
      ? {
          externalId: `single:${page.id}`,
          title: row.title,
          type: 'single',
          releaseDate: row.released,
          url: null,
        }
      : {
          externalId: albumPage?.id ?? `album:${artistId}:${row.albumTitle.toLowerCase()}`,
          title: row.albumTitle,
          type: 'album',
          releaseDate: row.released,
          url: albumPage?.url ?? null,
        };

  return {
    ok: true,
    license,
    entry: {
      externalId: page.id,
      title: row.title,
      explicit: row.explicit === 1,
      instrumental: row.instrumental === null ? null : row.instrumental === 1,
      artist: { externalId: artistId, name: row.artist, url: artistPage?.url ?? null },
      release,
      rights: {
        license,
        licenseUrl: OPEN_LICENSE_URL[license],
        attribution: formatAttribution({ title: row.title, artist: row.artist, license }),
        sourceUrl: page.url,
        // Every allowed license permits copying, so downloads for offline play are fine.
        allowOffline: true,
      },
    },
  };
}
