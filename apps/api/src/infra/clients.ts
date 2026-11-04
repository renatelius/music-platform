import { S3Client } from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import type { AppConfig } from '../config/env.js';

export function createRedis(config: AppConfig): Redis {
  const logger = new Logger('Redis');
  const redis = new Redis(config.redis.url, {
    connectTimeout: 2000,
    maxRetriesPerRequest: 2,
  });
  redis.on('error', (error: Error) => {
    logger.warn(`Redis error: ${error.message}`);
  });
  return redis;
}

export function createS3(config: AppConfig): S3Client {
  return new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    forcePathStyle: config.s3.forcePathStyle,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
  });
}
