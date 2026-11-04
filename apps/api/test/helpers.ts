// Integration tests import the COMPILED app from dist/: tsc emits the decorator metadata
// NestJS relies on, while Vitest's transformer does not. `test` depends on `build` (turbo.json).
import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';

import { createApp } from '../dist/bootstrap.js';
import { type AppConfig, loadConfig } from '../dist/config/env.js';

export interface TestApp {
  app: NestExpressApplication;
  config: AppConfig;
  url: string;
  close: () => Promise<void>;
}

export async function startTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  // A unique rate-limit namespace per app keeps tests independent of each other and of re-runs.
  const config = loadConfig({
    ...process.env,
    LOG_LEVEL: 'silent',
    RATE_LIMIT_PREFIX: `rl-test-${randomUUID()}`,
    ...overrides,
  });
  const app = await createApp(config);
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  return { app, config, url, close: () => app.close() };
}
