// Test catalog import (ADR-017). Usage: pnpm catalog:import [--help]
// Exit code 0 only when the catalog has --target ready tracks and every rule check passes.
import { appendFileSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { ensureSource } from '@mp/api/catalog';
import { loadConfig } from '@mp/api/config';
import { createDb, createPool } from '@mp/api/db';
import { createS3 } from '@mp/api/infra';
import { checkMediaTools } from '@mp/api/media';

import { type CliArgs, parseCliArgs, USAGE } from './args.js';
import { FMA_DATASET, FMA_SOURCE } from './fma.js';
import { openHfSource } from './hf.js';
import { type ImportReport, runImport } from './importer.js';
import { formatReport } from './report.js';
import { errorMessage } from './util.js';
import { readyCount, verificationPassed, verifyCatalog } from './verify.js';

let args: CliArgs;
try {
  args = parseCliArgs(process.argv.slice(2));
} catch (error) {
  console.error(`${errorMessage(error)}\n\n${USAGE}`);
  process.exit(2);
}
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const config = loadConfig(process.env);
const tools = { ffmpegPath: config.media.ffmpegPath, ffprobePath: config.media.ffprobePath };
const concurrency = args.concurrency ?? config.worker.concurrency;
const cacheFromEnv = process.env.CATALOG_CACHE_DIR?.trim();
const cacheDir =
  cacheFromEnv !== undefined && cacheFromEnv !== ''
    ? cacheFromEnv
    : join(homedir(), '.cache', 'remusic', 'catalog-import');
// Everything printed is also written, line by line, to catalog-import.log in the repository root:
// the result survives a closed window (the file is git-ignored).
const logFile = new URL('../../../catalog-import.log', import.meta.url);
try {
  writeFileSync(
    logFile,
    `# catalog-import ${new Date().toISOString()} ${process.argv.slice(2).join(' ')}\n`,
  );
} catch {
  // Logging to a file is a convenience; the console still has everything.
}
const toFile = (message: string): void => {
  try {
    appendFileSync(logFile, `${message}\n`);
  } catch {
    // see above
  }
};
const log = (message: string): void => {
  console.log(message);
  toFile(message);
};

const pool = createPool(config.db.url, concurrency + 2);
const db = createDb(pool);
const s3 = createS3(config);
let exitCode = 1;

try {
  let report: ImportReport | null = null;
  if (!args.verifyOnly) {
    const media = await checkMediaTools(tools);
    if (media.missingEncoders.length > 0) {
      throw new Error(`FFmpeg lacks encoders: ${media.missingEncoders.join(', ')}`);
    }
    log(
      `Importing FMA tracks under open licenses: target ${String(args.target)}, ${String(concurrency)} at a time${args.dryRun ? ', DRY RUN' : ''}`,
    );
    report = await runImport(
      { db, s3, buckets: config.s3.buckets, tools, log },
      {
        info: FMA_SOURCE,
        open: () =>
          openHfSource({
            dataset: FMA_DATASET,
            revision: args.revision,
            cacheDir,
            token: process.env.HF_TOKEN,
            seed: args.seed,
            log,
          }),
      },
      {
        target: args.target,
        maxPerRelease: args.maxPerRelease,
        concurrency,
        minDurationMs: config.worker.minDurationMs,
        retryFailed: args.retryFailed,
        dryRun: args.dryRun,
        maxParts: args.maxParts,
      },
    );
  }

  const sourceId = report?.sourceId ?? (await ensureSource(db, FMA_SOURCE));
  const check = await verifyCatalog({ db, s3, buckets: config.s3.buckets }, sourceId);
  const lines = formatReport(report, check, args.target);
  log('');
  for (const line of lines) log(line);

  const reportFile = join(
    cacheDir,
    'reports',
    `import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  await mkdir(join(cacheDir, 'reports'), { recursive: true });
  await writeFile(
    reportFile,
    JSON.stringify({ args, report, check: { ...check, assets: check.assets.length } }, null, 2),
  );
  log(`Report: ${reportFile}`);

  const complete = report?.dryRun === true || readyCount(check) >= args.target;
  exitCode = complete && verificationPassed(check) ? 0 : 1;
} catch (error) {
  console.error(`Import failed: ${errorMessage(error)}`);
  toFile(`Import failed: ${errorMessage(error)}`);
} finally {
  s3.destroy();
  await pool.end();
}
toFile(`exit code ${String(exitCode)}`);
process.exit(exitCode);
