import { parseArgs } from 'node:util';

export interface CliArgs {
  readonly target: number;
  readonly maxPerRelease: number;
  /** null = WORKER_CONCURRENCY from .env */
  readonly concurrency: number | null;
  readonly maxParts: number;
  readonly retryFailed: boolean;
  readonly dryRun: boolean;
  readonly verifyOnly: boolean;
  readonly revision: string;
  readonly seed: string;
  readonly help: boolean;
}

export const USAGE = `Usage: pnpm catalog:import [options]

Imports full-length FMA tracks under open licenses (CC0, Public Domain Mark, CC BY, CC BY-SA)
from Hugging Face until the catalog has --target ready tracks. Safe to run again.

  --target <n>           ready tracks wanted in the catalog (default 300)
  --max-per-release <n>  at most n tracks per album, for variety (default 10)
  --concurrency <n>      tracks processed at once (default WORKER_CONCURRENCY)
  --max-parts <n>        scan at most n dataset parts (default: all)
  --retry-failed         process tracks rejected in an earlier run again
  --dry-run              scan licenses and report, download nothing
  --verify               only check the catalog already in the database and S3
  --revision <rev>       dataset branch, tag or commit (default main)
  --seed <text>          order in which dataset parts are scanned (default remusic)
  -h, --help             show this help

Environment: HF_TOKEN (optional, higher Hugging Face rate limits),
CATALOG_CACHE_DIR (metadata cache; default ~/.cache/remusic/catalog-import).`;

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${name} must be a positive whole number, got "${value}"`);
  }
  return Number(value);
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      target: { type: 'string' },
      'max-per-release': { type: 'string' },
      concurrency: { type: 'string' },
      'max-parts': { type: 'string' },
      'retry-failed': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      verify: { type: 'boolean' },
      revision: { type: 'string' },
      seed: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  return {
    target: positiveInt(values.target, 300, '--target'),
    maxPerRelease: positiveInt(values['max-per-release'], 10, '--max-per-release'),
    concurrency:
      values.concurrency === undefined ? null : positiveInt(values.concurrency, 1, '--concurrency'),
    maxParts: positiveInt(values['max-parts'], Number.MAX_SAFE_INTEGER, '--max-parts'),
    retryFailed: values['retry-failed'] ?? false,
    dryRun: values['dry-run'] ?? false,
    verifyOnly: values.verify ?? false,
    revision: values.revision ?? 'main',
    seed: values.seed ?? 'remusic',
    help: values.help ?? false,
  };
}
