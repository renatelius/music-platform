// End-to-end import on the real test database, S3 and FFmpeg with a fake dataset:
// license filter, pipeline, report, per-release limit and idempotent re-runs.
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deleteSourceCatalog,
  ensureSource,
  loadSourceTracks,
  type SourceInfo,
} from '@mp/api/catalog';
import { type AppConfig, loadConfig } from '@mp/api/config';
import { createDb, createPool, type Database } from '@mp/api/db';
import { createS3 } from '@mp/api/infra';
import { type MediaTools, runTool } from '@mp/api/media';
import type { PipelineDeps } from '@mp/api/pipeline';
import { deletePrefix } from '@mp/api/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FMA_LICENSE_LABELS, type FmaRow } from '../src/fma.js';
import {
  type AudioItem,
  type CatalogSource,
  type ImportOptions,
  runImport,
  type SourcePart,
} from '../src/importer.js';
import { verificationPassed, verifyCatalog } from '../src/verify.js';

const label = (name: string): number => FMA_LICENSE_LABELS.indexOf(name);

function row(index: number, title: string, patch: Partial<FmaRow> = {}): FmaRow {
  const slug = title.replace(/ /g, '_');
  return {
    index,
    title,
    url: `https://freemusicarchive.org/music/Artist_A/Alpha/${slug}`,
    artist: 'Artist A',
    artistUrl: 'https://freemusicarchive.org/music/Artist_A',
    albumTitle: 'Alpha',
    albumUrl: 'https://freemusicarchive.org/music/Artist_A/Alpha',
    license: label('CC-BY 4.0'),
    released: '2016-01-01',
    explicit: 0,
    instrumental: 1,
    allowCommercialUse: 1,
    allowDerivatives: 1,
    ...patch,
  };
}

const artistB = (index: number, title: string, license: string): FmaRow =>
  row(index, title, {
    url: `https://freemusicarchive.org/music/Artist_B/Beta/${title.replace(/ /g, '_')}`,
    artist: 'Artist B',
    artistUrl: 'https://freemusicarchive.org/music/Artist_B',
    albumTitle: 'Beta',
    albumUrl: 'https://freemusicarchive.org/music/Artist_B/Beta',
    license: label(license),
  });

interface FakePart {
  readonly name: string;
  readonly rows: FmaRow[];
  readonly audio: Map<number, Uint8Array>;
}

async function* audioOf(part: FakePart, indices: readonly number[]): AsyncGenerator<AudioItem> {
  for (const index of indices) {
    await Promise.resolve();
    yield { index, bytes: part.audio.get(index) ?? null, path: `${String(index)}.mp3` };
  }
}

describe('catalog import', () => {
  let config: AppConfig;
  let pool: ReturnType<typeof createPool>;
  let db: Database;
  let deps: PipelineDeps & { log: (message: string) => void };
  let dir: string;
  let parts: FakePart[];
  let opened = 0;
  const info: SourceInfo = { kind: 'fma', name: `import-test-${randomUUID()}`, url: null };
  const options: ImportOptions = {
    target: 3,
    maxPerRelease: 10,
    concurrency: 2,
    minDurationMs: 1000,
    retryFailed: false,
    dryRun: false,
    maxParts: 100,
  };

  const source = {
    info,
    open: (): Promise<CatalogSource> => {
      opened += 1;
      const list: SourcePart[] = parts.map((part) => ({
        name: part.name,
        readRows: () => Promise.resolve({ rows: part.rows, audioBytes: null }),
        readAudio: (indices: readonly number[]) => audioOf(part, indices),
      }));
      return Promise.resolve({ revision: 'test', parts: list, bytesDownloaded: () => 0 });
    },
  };

  async function mp3(frequency: number): Promise<Uint8Array> {
    const tools: MediaTools = deps.tools;
    const file = join(dir, `${String(frequency)}.mp3`);
    const sine = `0.0707946*sin(2*PI*${String(frequency)}*t)`;
    const result = await runTool(
      tools.ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `aevalsrc=${sine}|${sine}:s=44100:d=3`,
        '-c:a',
        'libmp3lame',
        '-b:a',
        '128k',
        file,
      ],
      60_000,
    );
    if (result.exitCode !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
    return new Uint8Array(await readFile(file));
  }

  beforeAll(async () => {
    config = loadConfig(process.env);
    pool = createPool(config.db.url, 6);
    db = createDb(pool);
    deps = {
      db,
      s3: createS3(config),
      buckets: config.s3.buckets,
      tools: { ffmpegPath: config.media.ffmpegPath, ffprobePath: config.media.ffprobePath },
      log: () => undefined,
    };
    dir = await mkdtemp(join(tmpdir(), 'mp-import-test-'));
    const garbage = new TextEncoder().encode('this is not an audio file\n'.repeat(200));
    parts = [
      {
        name: 'part-a',
        rows: [
          row(0, 'Open One'),
          row(1, 'Open Two', { albumTitle: null, albumUrl: null, license: label('CC0 1.0') }),
          row(2, 'Not Commercial', { license: label('CC-BY-NC-SA 3.0') }),
          row(3, 'No Derivatives', { license: label('CC-BY-ND 4.0') }),
          row(4, 'Flags Say No', { allowCommercialUse: 0 }),
          row(5, 'Broken', { license: label('Public Domain Mark 1.0') }),
          row(6, 'Open One'),
        ],
        audio: new Map([
          [0, await mp3(440)],
          [1, await mp3(550)],
          [2, await mp3(660)],
          [5, garbage],
        ]),
      },
      {
        name: 'part-b',
        rows: [artistB(0, 'Open Three', 'CC-BY-SA 4.0'), artistB(1, 'Spare', 'CC-BY-SA 3.0')],
        audio: new Map([
          [0, await mp3(770)],
          [1, await mp3(880)],
        ]),
      },
    ];
  });

  afterAll(async () => {
    for (const name of [info.name, `${info.name}-dry`]) {
      const sourceId = await ensureSource(db, { ...info, name });
      const ids = await deleteSourceCatalog(db, sourceId);
      for (const id of ids) {
        await deletePrefix(deps.s3, config.s3.buckets.media, `tracks/${id}/`);
        await deletePrefix(deps.s3, config.s3.buckets.masters, `tracks/${id}/`);
      }
    }
    await rm(dir, { recursive: true, force: true });
    deps.s3.destroy();
    await pool.end();
  });

  it('imports only open licenses until the target, with a report of everything rejected', async () => {
    const report = await runImport(deps, source, options);
    expect(report).toMatchObject({
      readyAtStart: 0,
      readyTotal: 3,
      importedNow: 3,
      partsScanned: 2,
      rowsRead: 9,
      duplicates: 1,
      rejected: { license_not_allowed: 2, license_flags_not_open: 1 },
      rejectedLicenses: { 'CC-BY-NC-SA 3.0': 1, 'CC-BY-ND 4.0': 1 },
      importedByLicense: { 'CC BY 4.0': 1, 'CC0 1.0': 1, 'CC BY-SA 4.0': 1 },
    });
    expect(Object.values(report.pipelineFailures).reduce((a, b) => a + b, 0)).toBe(1);

    const check = await verifyCatalog(deps, report.sourceId);
    expect(verificationPassed(check)).toBe(true);
    expect(check.byStatus).toEqual({ ready: 3, failed: 1 });
    expect(check.readyByLicense).toEqual({ 'CC BY 4.0': 1, 'CC0 1.0': 1, 'CC BY-SA 4.0': 1 });
    expect(check.assets.length).toBeGreaterThanOrEqual(3);

    const stored = await loadSourceTracks(db, report.sourceId);
    expect([...stored.keys()].sort()).toEqual([
      '/music/Artist_A/Alpha/Broken',
      '/music/Artist_A/Alpha/Open_One',
      '/music/Artist_A/Alpha/Open_Two',
      '/music/Artist_B/Beta/Open_Three',
    ]);
    expect(stored.get('/music/Artist_A/Alpha/Open_Two')?.releaseExternalId).toBe(
      'single:/music/Artist_A/Alpha/Open_Two',
    );
    expect(stored.get('/music/Artist_A/Alpha/Broken')?.status).toBe('failed');
  });

  it('does nothing on a re-run when the target is already reached', async () => {
    const before = opened;
    const report = await runImport(deps, source, options);
    expect(opened).toBe(before);
    expect(report).toMatchObject({ readyAtStart: 3, readyTotal: 3, importedNow: 0 });
    expect((await loadSourceTracks(db, report.sourceId)).size).toBe(4);
  });

  it('keeps the per-release limit, skips failed tracks and adds only what is missing', async () => {
    const capped = await runImport(deps, source, { ...options, target: 4, maxPerRelease: 1 });
    expect(capped).toMatchObject({ importedNow: 0, readyTotal: 3, releaseCapSkipped: 1 });

    const report = await runImport(deps, source, { ...options, target: 4 });
    expect(report).toMatchObject({ readyAtStart: 3, importedNow: 1, readyTotal: 4 });
    const stored = await loadSourceTracks(db, report.sourceId);
    expect(stored.size).toBe(5);
    expect(stored.get('/music/Artist_B/Beta/Spare')?.status).toBe('ready');
    expect(stored.get('/music/Artist_A/Alpha/Broken')?.status).toBe('failed');
    expect(verificationPassed(await verifyCatalog(deps, report.sourceId))).toBe(true);
  });

  it('reports what a dry run would import without writing any track', async () => {
    const dry = { ...source, info: { ...info, name: `${info.name}-dry` } };
    const report = await runImport(deps, dry, { ...options, target: 10, dryRun: true });
    expect(report).toMatchObject({
      dryRun: true,
      wouldImport: 5,
      importedNow: 0,
      readyTotal: 0,
      importedByLicense: {
        'CC BY 4.0': 1,
        'CC0 1.0': 1,
        'Public Domain Mark 1.0': 1,
        'CC BY-SA 4.0': 1,
        'CC BY-SA 3.0': 1,
      },
    });
    expect((await loadSourceTracks(db, report.sourceId)).size).toBe(0);
  });
});
