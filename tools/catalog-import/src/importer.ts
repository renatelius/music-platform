// Import loop (ADR-017): metadata of all parts -> license allow list -> rank parts by importable
// tracks -> download audio of the densest parts -> catalog rows -> master in S3 -> audio pipeline. Stops as soon as the catalog has `target`
// ready tracks. Running it again never duplicates rows: tracks are found by source + external id.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

import {
  attachMaster,
  type CatalogEntry,
  ensureSource,
  loadSourceTracks,
  type SourceInfo,
  upsertCatalogTrack,
} from '@mp/api/catalog';
import { markFailed, type PipelineDeps, processTrack, type ProcessOutcome } from '@mp/api/pipeline';
import { uploadFile } from '@mp/api/storage';
import type { OpenLicense } from '@mp/contracts';

import { evaluateRow, type FmaRow } from './fma.js';
import { errorMessage, increment, sleep, TaskPool } from './util.js';

export interface AudioItem {
  readonly index: number;
  readonly bytes: Uint8Array | null;
  /** Original file name inside the dataset (gives the extension). */
  readonly path: string | null;
}

export interface PartRows {
  readonly rows: FmaRow[];
  /** Bytes downloaded to read this part's audio (null when unknown). */
  readonly audioBytes: number | null;
}

/** One Parquet file of the dataset (or a fake one in tests). */
export interface SourcePart {
  readonly name: string;
  readRows(): Promise<PartRows>;
  /** Yields the audio of the given rows; reads row group by row group to bound memory. */
  readAudio(indices: readonly number[]): AsyncIterable<AudioItem>;
}

export interface CatalogSource {
  /** Exact dataset revision (commit), recorded in the report. */
  readonly revision: string;
  /** In scan order. */
  readonly parts: readonly SourcePart[];
  bytesDownloaded(): number;
}

export interface ImportOptions {
  /** Stop when the catalog has this many ready tracks from the source. */
  readonly target: number;
  /** Variety: at most this many tracks per release. */
  readonly maxPerRelease: number;
  readonly concurrency: number;
  readonly minDurationMs: number;
  /** Process tracks that failed in an earlier run again. */
  readonly retryFailed: boolean;
  /** Scan and report only: nothing is downloaded or written except the metadata cache. */
  readonly dryRun: boolean;
  readonly maxParts: number;
}

export interface ImportDeps extends PipelineDeps {
  readonly log: (message: string) => void;
}

export interface ImportReport {
  readonly sourceId: string;
  revision: string | null;
  readonly target: number;
  readonly dryRun: boolean;
  readonly readyAtStart: number;
  readyTotal: number;
  importedNow: number;
  partsScanned: number;
  /** Parts whose metadata could not be read (skipped). */
  scanErrors: number;
  rowsRead: number;
  /** Parts whose audio was (or, in a dry run, would be) downloaded. */
  partsWithAudio: number;
  /** Sum of the audio sizes of those parts, from Parquet metadata. */
  estimatedDownloadBytes: number;
  /** Rows rejected before any download, by reason. */
  readonly rejected: Record<string, number>;
  /** Licenses of the rows rejected with `license_not_allowed`. */
  readonly rejectedLicenses: Record<string, number>;
  duplicates: number;
  releaseCapSkipped: number;
  /** Tracks rejected by the audio pipeline (corrupt, too short, silence...) or failed to import. */
  readonly pipelineFailures: Record<string, number>;
  readonly importedByLicense: Record<string, number>;
  wouldImport: number;
  bytesDownloaded: number;
  durationMs: number;
}

interface Pick {
  readonly entry: CatalogEntry;
  readonly license: OpenLicense;
}

interface Candidate {
  /** Row number inside the part. */
  readonly index: number;
  readonly pick: Pick;
}

/** Parts whose metadata is read at the same time (small range requests). */
const SCAN_CONCURRENCY = 4;

const AUDIO_TYPES: Readonly<Record<string, string>> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
};

/** Extension of the original file; FMA audio is MP3 when the name says nothing. */
export function audioExtension(path: string | null): string {
  const extension = extname(path ?? '').toLowerCase();
  return extension in AUDIO_TYPES ? extension : '.mp3';
}

async function processWithRetry(
  deps: ImportDeps,
  trackId: string,
  minDurationMs: number,
): Promise<ProcessOutcome> {
  try {
    return await processTrack(deps, trackId, { minDurationMs });
  } catch (error) {
    deps.log(`    processing failed (${errorMessage(error)}), retrying once`);
  }
  await sleep(2000);
  try {
    return await processTrack(deps, trackId, { minDurationMs });
  } catch (error) {
    deps.log(`    processing failed again: ${errorMessage(error)}`);
    await markFailed(deps.db, trackId, 'internal_error');
    return { status: 'failed', reason: 'internal_error' };
  }
}

/** Catalog rows -> original in `mp-masters` -> pipeline. Throws only for infrastructure errors. */
async function importTrack(
  deps: ImportDeps,
  sourceId: string,
  pick: Pick,
  bytes: Uint8Array,
  path: string | null,
  minDurationMs: number,
): Promise<ProcessOutcome> {
  const track = await upsertCatalogTrack(deps.db, sourceId, pick.entry);
  const extension = audioExtension(path);
  const masterKey = `tracks/${track.id}/original${extension}`;
  const dir = await mkdtemp(join(tmpdir(), 'mp-import-'));
  try {
    const file = join(dir, `master${extension}`);
    await writeFile(file, bytes);
    await uploadFile(
      deps.s3,
      deps.buckets.masters,
      masterKey,
      file,
      AUDIO_TYPES[extension] ?? 'application/octet-stream',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  await attachMaster(deps.db, track.id, masterKey);
  return processWithRetry(deps, track.id, minDurationMs);
}

export async function runImport(
  deps: ImportDeps,
  source: { readonly info: SourceInfo; readonly open: () => Promise<CatalogSource> },
  options: ImportOptions,
): Promise<ImportReport> {
  const started = Date.now();
  const sourceId = await ensureSource(deps.db, source.info);
  const stored = await loadSourceTracks(deps.db, sourceId);
  const perRelease = new Map<string, number>();
  let ready = 0;
  for (const track of stored.values()) {
    if (track.status !== 'ready') continue;
    ready += 1;
    perRelease.set(track.releaseExternalId, (perRelease.get(track.releaseExternalId) ?? 0) + 1);
  }

  const report: ImportReport = {
    sourceId,
    revision: null,
    target: options.target,
    dryRun: options.dryRun,
    readyAtStart: ready,
    readyTotal: ready,
    importedNow: 0,
    partsScanned: 0,
    scanErrors: 0,
    rowsRead: 0,
    partsWithAudio: 0,
    estimatedDownloadBytes: 0,
    rejected: {},
    rejectedLicenses: {},
    duplicates: 0,
    releaseCapSkipped: 0,
    pipelineFailures: {},
    importedByLicense: {},
    wouldImport: 0,
    bytesDownloaded: 0,
    durationMs: 0,
  };
  if (ready >= options.target) {
    deps.log(
      `Catalog already has ${String(ready)} ready tracks (target ${String(options.target)}).`,
    );
    report.durationMs = Date.now() - started;
    return report;
  }

  const opened = await source.open();
  report.revision = opened.revision;

  // 1. Metadata of every part (cached after the first run). The audio of a part costs the same
  //    whether it yields one track or a hundred, and open licenses come in clusters (whole
  //    albums), so parts are ranked by how many importable tracks they hold.
  const toScan = opened.parts.slice(0, options.maxParts);
  deps.log(`Reading metadata of ${String(toScan.length)} parts (cached after the first run)...`);
  const scanned: { order: number; part: SourcePart; rows: PartRows }[] = [];
  const scanPool = new TaskPool(SCAN_CONCURRENCY);
  for (const [order, part] of toScan.entries()) {
    await scanPool.run(async () => {
      try {
        scanned.push({ order, part, rows: await part.readRows() });
      } catch (error) {
        report.scanErrors += 1;
        deps.log(`  ${part.name}: metadata unreadable, skipped: ${errorMessage(error)}`);
        return;
      }
      if (scanned.length % 50 === 0) {
        deps.log(`  metadata: ${String(scanned.length)}/${String(toScan.length)} parts`);
      }
    });
  }
  await scanPool.drain();
  scanned.sort((a, b) => a.order - b.order);

  // 2. License allow list and what is already in the catalog.
  const seen = new Set<string>();
  const ranked: {
    order: number;
    part: SourcePart;
    audioBytes: number | null;
    candidates: Candidate[];
  }[] = [];
  for (const { order, part, rows } of scanned) {
    report.partsScanned += 1;
    report.rowsRead += rows.rows.length;
    const candidates: Candidate[] = [];
    for (const row of rows.rows) {
      const decision = evaluateRow(row);
      if (!decision.ok) {
        increment(report.rejected, decision.reason);
        if (decision.reason === 'license_not_allowed') {
          increment(report.rejectedLicenses, decision.license ?? 'no license');
        }
        continue;
      }
      const { entry } = decision;
      if (seen.has(entry.externalId)) {
        report.duplicates += 1;
        continue;
      }
      seen.add(entry.externalId);
      const existing = stored.get(entry.externalId);
      if (existing?.status === 'ready') continue;
      if (existing?.status === 'failed' && !options.retryFailed) continue;
      candidates.push({ index: row.index, pick: { entry, license: decision.license } });
    }
    if (candidates.length > 0)
      ranked.push({ order, part, audioBytes: rows.audioBytes, candidates });
  }
  ranked.sort((a, b) => b.candidates.length - a.candidates.length || a.order - b.order);
  const available = ranked.reduce((total, item) => total + item.candidates.length, 0);
  deps.log(
    `Scanned ${String(report.partsScanned)} parts, ${String(report.rowsRead)} rows: ${String(available)} importable tracks in ${String(ranked.length)} parts`,
  );

  const select = (candidates: readonly Candidate[], need: number): Map<number, Pick> => {
    const picked = new Map<number, Pick>();
    for (const { index, pick } of candidates) {
      if (picked.size >= need) break;
      const key = pick.entry.release.externalId;
      const inRelease = perRelease.get(key) ?? 0;
      if (inRelease >= options.maxPerRelease) {
        report.releaseCapSkipped += 1;
        continue;
      }
      perRelease.set(key, inRelease + 1);
      picked.set(index, pick);
    }
    return picked;
  };
  const release = (pick: Pick): void => {
    const key = pick.entry.release.externalId;
    perRelease.set(key, Math.max(0, (perRelease.get(key) ?? 1) - 1));
  };

  // 3. Densest parts first, until the target is reached.
  const pool = new TaskPool(options.concurrency);
  let reserved = 0;
  for (const { part, audioBytes, candidates } of ranked) {
    const need = options.target - ready - reserved;
    if (need <= 0) break;
    const picked = select(candidates, need);
    if (picked.size === 0) continue;
    report.partsWithAudio += 1;
    report.estimatedDownloadBytes += audioBytes ?? 0;
    deps.log(
      `${part.name}: ${String(picked.size)} to import (catalog: ${String(ready)}/${String(options.target)})`,
    );

    if (options.dryRun) {
      reserved += picked.size;
      report.wouldImport += picked.size;
      for (const pick of picked.values()) increment(report.importedByLicense, pick.license);
      continue;
    }

    const handled = new Set<number>();
    for await (const item of part.readAudio([...picked.keys()])) {
      const pick = picked.get(item.index);
      if (pick === undefined || handled.has(item.index)) continue;
      const { bytes, path } = item;
      if (bytes === null || bytes.byteLength === 0) continue; // reported below as no_audio
      handled.add(item.index);
      await pool.run(async () => {
        const label = `"${pick.entry.title}" - ${pick.entry.artist.name} (${pick.license})`;
        let outcome: ProcessOutcome;
        try {
          outcome = await importTrack(deps, sourceId, pick, bytes, path, options.minDurationMs);
        } catch (error) {
          deps.log(`    ${label}: import failed: ${errorMessage(error)}`);
          outcome = { status: 'failed', reason: 'internal_error' };
        }
        if (outcome.status === 'ready') {
          ready += 1;
          report.importedNow += 1;
          increment(report.importedByLicense, pick.license);
          deps.log(
            `  [${String(ready)}/${String(options.target)}] ${label}: ready, ${String(outcome.renditions)} renditions`,
          );
          return;
        }
        const reason = outcome.status === 'failed' ? outcome.reason : 'missing';
        increment(report.pipelineFailures, reason);
        release(pick);
        deps.log(`  ${label}: rejected (${reason})`);
      });
    }
    await pool.drain();
    for (const [index, pick] of picked) {
      if (handled.has(index)) continue;
      increment(report.pipelineFailures, 'no_audio');
      release(pick);
      deps.log(`  "${pick.entry.title}": no audio in the dataset`);
    }
  }

  report.readyTotal = ready;
  report.bytesDownloaded = opened.bytesDownloaded();
  report.durationMs = Date.now() - started;
  return report;
}
