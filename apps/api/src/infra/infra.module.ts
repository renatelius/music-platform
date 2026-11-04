import type { S3Client } from '@aws-sdk/client-s3';
import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';

import { RedisRateLimiter } from '../common/rate-limit.js';
import type { AppConfig } from '../config/env.js';
import { createDb, createPool } from '../db/client.js';
import { createRedis, createS3 } from './clients.js';
import { APP_CONFIG, DB, PG_POOL, RATE_LIMITER, REDIS, S3 } from './tokens.js';

/** Closes connections on app.close() and on SIGTERM (enableShutdownHooks). */
@Injectable()
export class InfraLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(S3) private readonly s3: S3Client,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    this.s3.destroy();
    if (this.redis.status === 'ready') {
      await this.redis.quit().catch(() => undefined);
    } else {
      this.redis.disconnect();
    }
    await this.pool.end();
  }
}

@Global()
@Module({})
export class InfraModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: InfraModule,
      global: true,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        {
          provide: PG_POOL,
          useFactory: () => {
            const pool = createPool(config.db.url, config.db.poolMax);
            const logger = new Logger('Postgres');
            pool.on('error', (error: Error) => {
              logger.error(`Idle client error: ${error.message}`);
            });
            return pool;
          },
        },
        { provide: DB, inject: [PG_POOL], useFactory: (pool: Pool) => createDb(pool) },
        { provide: REDIS, useFactory: () => createRedis(config) },
        { provide: S3, useFactory: () => createS3(config) },
        {
          provide: RATE_LIMITER,
          inject: [REDIS],
          useFactory: (redis: Redis) => new RedisRateLimiter(redis, config.rateLimit.keyPrefix),
        },
        InfraLifecycle,
      ],
      exports: [APP_CONFIG, PG_POOL, DB, REDIS, S3, RATE_LIMITER],
    };
  }
}
