import { type Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';

import { markFailed, type PipelineDeps, processTrack, type ProcessOutcome } from './pipeline.js';

/** BullMQ queue with one job per track to process (ADR-017). */
export const INGEST_QUEUE = 'ingest';

const IngestJobData = z.object({ trackId: z.uuid() });
export type IngestJobData = z.infer<typeof IngestJobData>;

export interface QueueSettings {
  readonly redisUrl: string;
  /** Redis key prefix; tests use a unique one so they never see each other's jobs. */
  readonly prefix: string;
}

export interface IngestQueue {
  readonly queue: Queue;
  close(): Promise<void>;
}

export function createIngestQueue(settings: QueueSettings): IngestQueue {
  const connection = new Redis(settings.redisUrl, { maxRetriesPerRequest: 3 });
  const queue = new Queue(INGEST_QUEUE, { connection, prefix: settings.prefix });
  return {
    queue,
    close: async () => {
      await queue.close();
      await connection.quit().catch(() => undefined);
    },
  };
}

/**
 * Queues a track. The job id is the track id: queueing the same track twice while it waits
 * is a no-op. Failed attempts are retried with back-off; the database keeps the final status.
 */
export async function enqueueTrack(queue: Queue, trackId: string): Promise<void> {
  const data: IngestJobData = { trackId };
  await queue.add('track', data, {
    jobId: trackId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: true,
  });
}

export interface WorkerSettings extends QueueSettings {
  readonly concurrency: number;
  readonly minDurationMs: number;
}

export interface IngestWorker {
  readonly worker: Worker;
  close(): Promise<void>;
}

export function startIngestWorker(deps: PipelineDeps, settings: WorkerSettings): IngestWorker {
  // Blocking commands need maxRetriesPerRequest: null (BullMQ requirement for workers).
  const connection = new Redis(settings.redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker(
    INGEST_QUEUE,
    async (job: Job): Promise<ProcessOutcome> => {
      const { trackId } = IngestJobData.parse(job.data);
      return processTrack(deps, trackId, { minDurationMs: settings.minDurationMs });
    },
    { connection, prefix: settings.prefix, concurrency: settings.concurrency },
  );

  worker.on('failed', (job: Job | undefined, error: Error) => {
    if (job === undefined) return;
    const parsed = IngestJobData.safeParse(job.data);
    const trackId = parsed.success ? parsed.data.trackId : String(job.id);
    const attempts = job.opts.attempts ?? 1;
    deps.logger?.warn(
      `Track ${trackId}: attempt ${String(job.attemptsMade)}/${String(attempts)} failed: ${error.message}`,
    );
    if (parsed.success && job.attemptsMade >= attempts) {
      markFailed(deps.db, trackId, 'internal_error').catch((markError: unknown) => {
        deps.logger?.warn(`Could not mark track ${trackId} as failed: ${String(markError)}`);
      });
    }
  });
  worker.on('error', (error: Error) => {
    deps.logger?.warn(`Worker error: ${error.message}`);
  });

  return {
    worker,
    close: async () => {
      await worker.close();
      await connection.quit().catch(() => undefined);
    },
  };
}
