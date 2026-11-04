import { readFileSync } from 'node:fs';

import { z } from 'zod';

export const LogLevel = z.enum(['silent', 'error', 'warn', 'log', 'debug', 'verbose']);
export type LogLevel = z.infer<typeof LogLevel>;

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(0).max(65_535).default(4000),
  API_PUBLIC_URL: z.url().default('http://127.0.0.1:4000'),
  CORS_ORIGINS: csv.default(['http://localhost:3000', 'http://127.0.0.1:3000']),
  TRUST_PROXY: z.stringbool().default(false),
  LOG_LEVEL: LogLevel.default('log'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('pretty'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis:// URL'),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
  S3_BUCKET_MEDIA: z.string().min(3),
  S3_BUCKET_MASTERS: z.string().min(3),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_PREFIX: z.string().min(1).default('rl'),
});

export interface RateLimitConfig {
  readonly max: number;
  readonly windowMs: number;
  readonly keyPrefix: string;
}

export interface AppConfig {
  readonly env: 'development' | 'test' | 'production';
  readonly version: string;
  readonly api: {
    readonly host: string;
    readonly port: number;
    readonly publicUrl: string;
    readonly corsOrigins: readonly string[];
    readonly trustProxy: boolean;
  };
  readonly log: { readonly level: LogLevel; readonly format: 'json' | 'pretty' };
  readonly db: { readonly url: string; readonly poolMax: number };
  readonly redis: { readonly url: string };
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly forcePathStyle: boolean;
    readonly buckets: { readonly media: string; readonly masters: string };
  };
  readonly rateLimit: RateLimitConfig;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Validates environment variables. Error messages name the variable but never echo its value. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.map(String).join('.')}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${details}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    version: readPackageVersion(),
    api: {
      host: e.API_HOST,
      port: e.API_PORT,
      publicUrl: e.API_PUBLIC_URL,
      corsOrigins: e.CORS_ORIGINS,
      trustProxy: e.TRUST_PROXY,
    },
    log: { level: e.LOG_LEVEL, format: e.LOG_FORMAT },
    db: { url: e.DATABASE_URL, poolMax: e.DATABASE_POOL_MAX },
    redis: { url: e.REDIS_URL },
    s3: {
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      buckets: { media: e.S3_BUCKET_MEDIA, masters: e.S3_BUCKET_MASTERS },
    },
    rateLimit: {
      max: e.RATE_LIMIT_MAX,
      windowMs: e.RATE_LIMIT_WINDOW_MS,
      keyPrefix: e.RATE_LIMIT_PREFIX,
    },
  };
}

function readPackageVersion(): string {
  try {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const pkg: unknown = JSON.parse(raw);
    if (
      typeof pkg === 'object' &&
      pkg !== null &&
      'version' in pkg &&
      typeof pkg.version === 'string'
    ) {
      return pkg.version;
    }
  } catch {
    // Version is informational only.
  }
  return '0.0.0';
}
