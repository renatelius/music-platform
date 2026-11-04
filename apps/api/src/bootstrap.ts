import 'reflect-metadata';

import { ConsoleLogger, Logger, type LogLevel as NestLogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module.js';
import { ProblemExceptionFilter } from './common/problem.filter.js';
import { rateLimitMiddleware, type RedisRateLimiter } from './common/rate-limit.js';
import { REQUEST_ID_HEADER, requestIdMiddleware } from './common/request-context.js';
import { requestLogMiddleware } from './common/request-log.js';
import type { AppConfig, LogLevel } from './config/env.js';
import { RATE_LIMITER } from './infra/tokens.js';

const LEVEL_ORDER: NestLogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];

function createLogger(level: LogLevel, format: 'json' | 'pretty'): ConsoleLogger | false {
  if (level === 'silent') return false;
  const logLevels = LEVEL_ORDER.slice(0, LEVEL_ORDER.indexOf(level) + 1);
  return new ConsoleLogger({ json: format === 'json', colors: format === 'pretty', logLevels });
}

/** Builds a fully configured application. Used by main.ts and by integration tests. */
export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: createLogger(config.log.level, config.log.format),
    abortOnError: false,
  });

  app.disable('x-powered-by');
  app.set('trust proxy', config.api.trustProxy);
  app.enableCors({
    // cors expects a mutable array; config is deeply readonly
    origin: [...config.api.corsOrigins],
    credentials: true,
    exposedHeaders: [
      REQUEST_ID_HEADER,
      'retry-after',
      'ratelimit-limit',
      'ratelimit-remaining',
      'ratelimit-reset',
    ],
  });

  app.use(requestIdMiddleware());
  app.use(requestLogMiddleware(new Logger('HTTP')));
  app.use(helmet());
  app.use(
    rateLimitMiddleware(
      app.get<RedisRateLimiter>(RATE_LIMITER),
      config.rateLimit,
      new Logger('RateLimit'),
    ),
  );
  app.useGlobalFilters(new ProblemExceptionFilter());

  return app;
}
