// Worker process (ADR-017): same code base and configuration as the API, no HTTP.
// Started by `pnpm --filter @mp/api worker` and by dev.bat next to the API.
import { Logger } from '@nestjs/common';

import { loadConfig } from '../config/env.js';
import { createDb, createPool } from '../db/client.js';
import { createS3 } from '../infra/clients.js';
import { checkMediaTools } from '../media/index.js';
import { startIngestWorker } from './queue.js';

const config = loadConfig(process.env);
const logger = new Logger('Worker');
const tools = { ffmpegPath: config.media.ffmpegPath, ffprobePath: config.media.ffprobePath };

const status = await checkMediaTools(tools).catch((error: unknown): never => {
  logger.error(error instanceof Error ? error.message : String(error));
  return process.exit(1);
});
if (status.missingEncoders.length > 0) {
  logger.error(`FFmpeg lacks encoders: ${status.missingEncoders.join(', ')}`);
  process.exit(1);
}

const pool = createPool(config.db.url, config.worker.concurrency + 2);
const db = createDb(pool);
const s3 = createS3(config);

const ingest = startIngestWorker(
  { db, s3, buckets: config.s3.buckets, tools, logger },
  {
    redisUrl: config.redis.url,
    prefix: config.worker.queuePrefix,
    concurrency: config.worker.concurrency,
    minDurationMs: config.worker.minDurationMs,
  },
);
logger.log(
  `Ingest worker started: queue "${config.worker.queuePrefix}:ingest", concurrency ${String(config.worker.concurrency)}, ${status.version}`,
);

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.log(`${signal}: finishing current jobs…`);
  await ingest.close();
  s3.destroy();
  await pool.end();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
