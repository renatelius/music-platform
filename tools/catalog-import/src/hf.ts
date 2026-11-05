// Hugging Face dataset as a CatalogSource. Parquet parts are never downloaded whole:
// metadata columns are read with byte ranges and cached as JSON, audio is fetched only for
// the row groups that contain picked tracks (ADR-017).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { z } from 'zod';

import { FMA_METADATA_COLUMNS, FmaRow, normalizeRow } from './fma.js';
import { HttpClient } from './http.js';
import type { AudioItem, CatalogSource, PartRows, SourcePart } from './importer.js';
import { RemoteFile } from './remote-file.js';
import { formatBytes, seededShuffle } from './util.js';

const HF = 'https://huggingface.co';
/** Metadata columns of one row group are small; a larger span means audio sits in between. */
const PREFETCH_LIMIT_BYTES = 32 * 1024 * 1024;

const RepoInfo = z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) });
const TreeEntry = z.object({
  type: z.string(),
  path: z.string(),
  size: z.number().int().nonnegative().optional(),
  lfs: z.object({ size: z.number().int().nonnegative() }).optional(),
});
const PartEntry = z.object({ path: z.string(), size: z.number().int().positive() });
type PartEntry = z.infer<typeof PartEntry>;
const PartsManifest = z.object({ version: z.literal(1), parts: z.array(PartEntry) });
const PartCache = z.object({
  version: z.literal(1),
  rows: z.array(FmaRow),
  /** Compressed size of the audio column: what downloading this part's audio costs. */
  audioBytes: z.number().int().nonnegative().nullish(),
});

const Offset = z.union([z.bigint(), z.number()]).transform(Number);
/** The subset of Parquet column-chunk metadata needed to locate a column in the file. */
const ColumnChunk = z.object({
  meta_data: z
    .object({
      path_in_schema: z.array(z.string()),
      data_page_offset: Offset,
      dictionary_page_offset: Offset.nullish(),
      total_compressed_size: Offset,
    })
    .nullish(),
});

export interface HfSourceOptions {
  readonly dataset: string;
  /** Branch, tag or commit; resolved to a commit so every request reads the same files. */
  readonly revision: string;
  readonly cacheDir: string;
  readonly token?: string | undefined;
  /** Order in which parts are scanned (variety across the dataset). */
  readonly seed: string;
  readonly log: (message: string) => void;
}

async function readCache<T>(file: string, schema: z.ZodType<T>): Promise<T | null> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function writeCache(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${String(process.pid)}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, file);
}

/** Byte span [start, end) of the chosen columns inside one row group. */
export function columnSpan(
  columns: unknown,
  include: (column: string) => boolean,
): { start: number; end: number } | null {
  const chunks = z.array(ColumnChunk).safeParse(columns);
  if (!chunks.success) return null;
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  for (const chunk of chunks.data) {
    const meta = chunk.meta_data;
    const column = meta?.path_in_schema[0];
    if (meta === null || meta === undefined || column === undefined || !include(column)) continue;
    const dictionary = meta.dictionary_page_offset ?? 0;
    const first =
      dictionary > 0 && dictionary < meta.data_page_offset ? dictionary : meta.data_page_offset;
    start = Math.min(start, first);
    end = Math.max(end, first + meta.total_compressed_size);
  }
  return end > start ? { start, end } : null;
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** `audio` struct of the datasets library: { bytes, path }. */
export function audioOf(row: unknown): { bytes: Uint8Array | null; path: string | null } {
  const audio = field(row, 'audio');
  const bytes = field(audio, 'bytes');
  const path = field(audio, 'path');
  return {
    bytes:
      bytes instanceof Uint8Array
        ? bytes
        : bytes instanceof ArrayBuffer
          ? new Uint8Array(bytes)
          : null,
    path:
      typeof path === 'string'
        ? path
        : path instanceof Uint8Array
          ? new TextDecoder().decode(path)
          : null,
  };
}

class HfPart implements SourcePart {
  readonly name: string;
  private readonly cacheFile: string;

  constructor(
    private readonly http: HttpClient,
    private readonly url: string,
    private readonly size: number,
    cacheDir: string,
    path: string,
    private readonly log: (message: string) => void,
  ) {
    this.name = basename(path);
    this.cacheFile = join(cacheDir, 'meta', `${this.name}.json`);
  }

  private file(): RemoteFile {
    return new RemoteFile(this.http, this.url, this.size);
  }

  async readRows(): Promise<PartRows> {
    const cached = await readCache(this.cacheFile, PartCache);
    if (cached !== null) return { rows: cached.rows, audioBytes: cached.audioBytes ?? null };
    const file = this.file();
    const metadata = await parquetMetadataAsync(file);
    const rows: FmaRow[] = [];
    let audioBytes = 0;
    let offset = 0;
    for (const group of metadata.row_groups) {
      const count = Number(group.num_rows);
      const audio = columnSpan(group.columns, (column) => column === 'audio');
      if (audio !== null) audioBytes += audio.end - audio.start;
      const span = columnSpan(group.columns, (column) => column !== 'audio');
      if (span !== null && span.end - span.start <= PREFETCH_LIMIT_BYTES) {
        await file.prefetch(span.start, span.end);
      }
      const raw: unknown[] = await parquetReadObjects({
        file,
        metadata,
        columns: [...FMA_METADATA_COLUMNS],
        rowStart: offset,
        rowEnd: offset + count,
        compressors,
      });
      for (const [i, value] of raw.entries()) rows.push(normalizeRow(value, offset + i));
      file.clear();
      offset += count;
    }
    await writeCache(this.cacheFile, { version: 1, rows, audioBytes });
    return { rows, audioBytes };
  }

  async *readAudio(indices: readonly number[]): AsyncGenerator<AudioItem> {
    const wanted = [...new Set(indices)].sort((a, b) => a - b);
    if (wanted.length === 0) return;
    const file = this.file();
    const metadata = await parquetMetadataAsync(file);
    let offset = 0;
    for (const group of metadata.row_groups) {
      const start = offset;
      const end = start + Number(group.num_rows);
      offset = end;
      const rows = wanted.filter((index) => index >= start && index < end);
      const first = rows[0];
      const last = rows.at(-1);
      if (first === undefined || last === undefined) continue;
      const span = columnSpan(group.columns, (column) => column === 'audio');
      const size = span === null ? '' : `, ~${formatBytes(span.end - span.start)}`;
      this.log(`${this.name}: downloading audio of ${String(rows.length)} track(s)${size}`);
      // utf8: false keeps the MP3 bytes binary (strings are still decoded by their annotation).
      const raw: unknown[] = await parquetReadObjects({
        file,
        metadata,
        columns: ['audio'],
        rowStart: first,
        rowEnd: last + 1,
        compressors,
        utf8: false,
      });
      for (const index of rows) yield { index, ...audioOf(raw[index - first]) };
    }
  }
}

async function listParts(
  http: HttpClient,
  dataset: string,
  revision: string,
  cacheDir: string,
): Promise<PartEntry[]> {
  const manifestFile = join(cacheDir, 'parts.json');
  const cached = await readCache(manifestFile, PartsManifest);
  if (cached !== null && cached.parts.length > 0) return cached.parts;

  const parts: PartEntry[] = [];
  let url: string | null = `${HF}/api/datasets/${dataset}/tree/${revision}/data`;
  while (url !== null) {
    const page: { body: unknown; next: string | null } = await http.json(url);
    for (const entry of z.array(TreeEntry).parse(page.body)) {
      const size = entry.lfs?.size ?? entry.size ?? 0;
      if (entry.type !== 'file' || !entry.path.endsWith('.parquet') || size === 0) continue;
      parts.push({ path: entry.path, size });
    }
    url = page.next;
  }
  if (parts.length === 0) throw new Error(`No Parquet files in ${dataset}@${revision}/data`);
  parts.sort((a, b) => a.path.localeCompare(b.path));
  await writeCache(manifestFile, { version: 1, parts });
  return parts;
}

export async function openHfSource(options: HfSourceOptions): Promise<CatalogSource> {
  const http = new HttpClient({ token: options.token, log: options.log });
  const info = await http.json(
    `${HF}/api/datasets/${options.dataset}/revision/${encodeURIComponent(options.revision)}`,
  );
  const { sha } = RepoInfo.parse(info.body);
  // Cache per commit: a new dataset revision never mixes with old metadata.
  const cacheDir = join(options.cacheDir, sha.slice(0, 12));
  const entries = await listParts(http, options.dataset, sha, cacheDir);
  options.log(
    `Dataset ${options.dataset}@${sha.slice(0, 12)}: ${String(entries.length)} parts, cache ${cacheDir}`,
  );
  const parts = seededShuffle(entries, options.seed).map(
    (entry) =>
      new HfPart(
        http,
        `${HF}/datasets/${options.dataset}/resolve/${sha}/${entry.path}`,
        entry.size,
        cacheDir,
        entry.path,
        options.log,
      ),
  );
  return { revision: sha, parts, bytesDownloaded: () => http.bytesDownloaded };
}
