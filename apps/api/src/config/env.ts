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
  /** `loopback` trusts X-Forwarded-For only from a proxy on the same host (e.g. the web app). */
  TRUST_PROXY: z.enum(['false', 'true', 'loopback']).default('loopback'),
  /** OpenAPI at /openapi.json and /docs; default: on outside production. */
  API_DOCS: z.stringbool().optional(),
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
  AUTH_JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  AUTH_ACCESS_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(900),
  AUTH_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  AUTH_COOKIE_SECURE: z.stringbool().optional(),
  /** Path of the refresh cookie as the browser sees it (`/api/auth` behind the web app proxy). */
  AUTH_COOKIE_PATH: z
    .string()
    .regex(/^\/[A-Za-z0-9/_-]*$/, 'must be an absolute path')
    .default('/auth'),
  WEB_APP_URL: z.url().default('http://localhost:3000'),
  SMTP_HOST: z.string().min(1).default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().min(3).default('ReMusic <no-reply@remusic.local>'),
  /** FFmpeg binaries for the audio pipeline; looked up on PATH by default. */
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  FFPROBE_PATH: z.string().min(1).default('ffprobe'),
  /** Worker (ADR-017). */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  QUEUE_PREFIX: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, 'letters, digits, - and _ only')
    .default('mp'),
  /** Shorter files are rejected (jingles, broken uploads). */
  INGEST_MIN_DURATION_SEC: z.coerce.number().int().min(1).max(600).default(30),
  /**
   * Lifetime of signed media links (ADR-019, ADR-022): 10 min by default, at most 1 h.
   * A link is a bearer token; players renew it shortly before it expires.
   */
  MEDIA_URL_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(600),
  /**
   * Header with the listener's country, set by the CDN or reverse proxy (ADR-023), e.g.
   * `cf-ipcountry`. Set it only when every request passes through that proxy, which overwrites
   * the header. Unset: country unknown, territorial rights never apply (fail closed).
   */
  GEO_COUNTRY_HEADER: z
    .string()
    .regex(/^[A-Za-z0-9-]+$/, 'must be a header name')
    .transform((name) => name.toLowerCase())
    .optional(),
});

/** Placeholder secrets from .env.example must never reach production (ADR-022). */
const PLACEHOLDER_SECRET = /change_me|dev_only|mp_dev_/i;

/** Variables that carry credentials; checked for placeholders in production. */
const SECRET_VARIABLES = [
  'AUTH_JWT_SECRET',
  'DATABASE_URL',
  'REDIS_URL',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'SMTP_PASSWORD',
] as const;

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
    readonly trustProxy: boolean | 'loopback';
    readonly docs: boolean;
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
  readonly webAppUrl: string;
  readonly auth: {
    readonly jwtSecret: string;
    readonly issuer: string;
    readonly audience: string;
    readonly accessTtlSec: number;
    readonly refreshTtlDays: number;
    readonly cookieSecure: boolean;
    readonly cookiePath: string;
    readonly emailVerifyTtlHours: number;
    readonly passwordResetTtlMin: number;
  };
  readonly mail: {
    readonly host: string;
    readonly port: number;
    readonly secure: boolean;
    readonly user: string | undefined;
    readonly password: string | undefined;
    readonly from: string;
  };
  readonly media: { readonly ffmpegPath: string; readonly ffprobePath: string };
  readonly worker: {
    readonly concurrency: number;
    readonly queuePrefix: string;
    readonly minDurationMs: number;
  };
  readonly stream: { readonly urlTtlSec: number };
  readonly geo: { readonly countryHeader: string | null };
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
  if (e.NODE_ENV === 'production') {
    const placeholders = SECRET_VARIABLES.filter((name) => {
      const value = e[name];
      return value !== undefined && PLACEHOLDER_SECRET.test(value);
    });
    if (placeholders.length > 0) {
      throw new ConfigError(
        `Invalid environment configuration:\n${placeholders.map((name) => `  ${name}: placeholder value in production`).join('\n')}`,
      );
    }
  }
  return {
    env: e.NODE_ENV,
    version: readPackageVersion(),
    api: {
      host: e.API_HOST,
      port: e.API_PORT,
      publicUrl: e.API_PUBLIC_URL,
      corsOrigins: e.CORS_ORIGINS,
      trustProxy: e.TRUST_PROXY === 'loopback' ? 'loopback' : e.TRUST_PROXY === 'true',
      docs: e.API_DOCS ?? e.NODE_ENV !== 'production',
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
    webAppUrl: e.WEB_APP_URL.replace(/\/+$/, ''),
    auth: {
      jwtSecret: e.AUTH_JWT_SECRET,
      issuer: e.API_PUBLIC_URL,
      audience: 'music-platform',
      accessTtlSec: e.AUTH_ACCESS_TTL_SEC,
      refreshTtlDays: e.AUTH_REFRESH_TTL_DAYS,
      cookieSecure: e.AUTH_COOKIE_SECURE ?? e.NODE_ENV === 'production',
      cookiePath: e.AUTH_COOKIE_PATH,
      emailVerifyTtlHours: 24,
      passwordResetTtlMin: 60,
    },
    mail: {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      user: e.SMTP_USER,
      password: e.SMTP_PASSWORD,
      from: e.MAIL_FROM,
    },
    media: { ffmpegPath: e.FFMPEG_PATH, ffprobePath: e.FFPROBE_PATH },
    worker: {
      concurrency: e.WORKER_CONCURRENCY,
      queuePrefix: e.QUEUE_PREFIX,
      minDurationMs: e.INGEST_MIN_DURATION_SEC * 1000,
    },
    stream: { urlTtlSec: e.MEDIA_URL_TTL_SEC },
    geo: { countryHeader: e.GEO_COUNTRY_HEADER ?? null },
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
