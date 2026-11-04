import { HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';

import { aggregateHealth, type DependencyCheck, type HealthResponse } from '@mp/contracts';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';

import type { AppConfig } from '../config/env.js';
import { APP_CONFIG, PG_POOL, REDIS, S3 } from '../infra/tokens.js';

const CRITICAL = ['postgres', 'redis'] as const;
const PROBE_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(S3) private readonly s3: S3Client,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async check(): Promise<HealthResponse> {
    const [postgres, redis, s3] = await Promise.all([
      this.probe(() => this.pool.query('select 1')),
      this.probe(() => this.redis.ping()),
      this.probe(() =>
        this.s3.send(new HeadBucketCommand({ Bucket: this.config.s3.buckets.media })),
      ),
    ]);
    const checks = { postgres, redis, s3 };
    return {
      status: aggregateHealth(checks, CRITICAL),
      version: this.config.version,
      uptimeSec: Math.round(process.uptime()),
      checks,
    };
  }

  private async probe(run: () => Promise<unknown>): Promise<DependencyCheck> {
    const started = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`timed out after ${String(PROBE_TIMEOUT_MS)} ms`));
          }, PROBE_TIMEOUT_MS);
        }),
      ]);
      return { status: 'ok', latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      const check: DependencyCheck = {
        status: 'down',
        latencyMs: Math.round(performance.now() - started),
      };
      // Error text may reveal internal hosts: only outside production.
      if (this.config.env !== 'production') {
        check.error = error instanceof Error ? error.message || error.name : 'unknown error';
      }
      return check;
    } finally {
      clearTimeout(timer);
    }
  }
}
