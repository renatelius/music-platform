import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './env.js';

const minimal = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db',
  REDIS_URL: 'redis://127.0.0.1:6379/0',
  S3_ENDPOINT: 'http://127.0.0.1:8333',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_BUCKET_MEDIA: 'media',
  S3_BUCKET_MASTERS: 'masters',
  AUTH_JWT_SECRET: 'test-secret-0123456789-0123456789-abcdef',
};

describe('loadConfig', () => {
  it('applies defaults for optional settings', () => {
    const config = loadConfig(minimal);
    expect(config.env).toBe('development');
    expect(config.api.port).toBe(4000);
    expect(config.api.trustProxy).toBe('loopback');
    expect(config.api.docs).toBe(true);
    expect(loadConfig({ ...minimal, NODE_ENV: 'production' }).api.docs).toBe(false);
    expect(loadConfig({ ...minimal, NODE_ENV: 'production', API_DOCS: 'true' }).api.docs).toBe(
      true,
    );
    expect(config.auth.cookiePath).toBe('/auth');
    expect(config.s3.forcePathStyle).toBe(true);
    expect(config.rateLimit).toEqual({ max: 300, windowMs: 60_000, keyPrefix: 'rl' });
    expect(config.media).toEqual({ ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' });
    expect(config.worker).toEqual({ concurrency: 2, queuePrefix: 'mp', minDurationMs: 30_000 });
    expect(config.stream).toEqual({ urlTtlSec: 600 });
    expect(config.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('parses lists, numbers and booleans from strings', () => {
    const config = loadConfig({
      ...minimal,
      API_PORT: '8080',
      CORS_ORIGINS: 'https://a.example, https://b.example ,',
      TRUST_PROXY: 'true',
    });
    expect(config.api.port).toBe(8080);
    expect(config.api.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(config.api.trustProxy).toBe(true);
  });

  it('names invalid variables without leaking their values', () => {
    const run = () => loadConfig({ ...minimal, DATABASE_URL: 'mysql://secret-password@host' });
    expect(run).toThrow(ConfigError);
    expect(run).toThrow(/DATABASE_URL/);
    expect(run).not.toThrow(/secret-password/);
  });

  it('derives auth and mail settings', () => {
    const config = loadConfig({ ...minimal, WEB_APP_URL: 'https://app.example/' });
    expect(config.webAppUrl).toBe('https://app.example');
    expect(config.auth.accessTtlSec).toBe(900);
    expect(config.auth.cookieSecure).toBe(false);
    expect(loadConfig({ ...minimal, NODE_ENV: 'production' }).auth.cookieSecure).toBe(true);
    expect(config.mail).toMatchObject({ host: '127.0.0.1', port: 1025, secure: false });
  });

  it('rejects short JWT secrets and placeholders in production', () => {
    expect(() => loadConfig({ ...minimal, AUTH_JWT_SECRET: 'short' })).toThrow(/AUTH_JWT_SECRET/);
    const placeholder = { ...minimal, AUTH_JWT_SECRET: 'dev_only_jwt_secret_change_me_0123456789' };
    expect(() => loadConfig(placeholder)).not.toThrow();
    expect(() => loadConfig({ ...placeholder, NODE_ENV: 'production' })).toThrow(/placeholder/);
  });

  it('rejects every placeholder credential from .env.example in production', () => {
    const dev = {
      ...minimal,
      DATABASE_URL: 'postgres://mp:mp_dev_password@127.0.0.1:54320/mp',
      REDIS_URL: 'redis://:mp_dev_redis@127.0.0.1:63790/0',
      S3_ACCESS_KEY_ID: 'mp_dev_access',
      S3_SECRET_ACCESS_KEY: 'mp_dev_secret_change_me',
    };
    expect(() => loadConfig(dev)).not.toThrow();
    const run = () => loadConfig({ ...dev, NODE_ENV: 'production' });
    expect(run).toThrow(/DATABASE_URL: placeholder/);
    expect(run).toThrow(/REDIS_URL: placeholder/);
    expect(run).toThrow(/S3_ACCESS_KEY_ID: placeholder/);
    expect(run).toThrow(/S3_SECRET_ACCESS_KEY: placeholder/);
    expect(run).not.toThrow(/mp_dev_password/);
    expect(() => loadConfig({ ...minimal, NODE_ENV: 'production' })).not.toThrow();
  });

  it('reads the country header name, off by default', () => {
    expect(loadConfig(minimal).geo).toEqual({ countryHeader: null });
    expect(loadConfig({ ...minimal, GEO_COUNTRY_HEADER: 'CF-IPCountry' }).geo).toEqual({
      countryHeader: 'cf-ipcountry',
    });
    expect(() => loadConfig({ ...minimal, GEO_COUNTRY_HEADER: 'bad header' })).toThrow(
      /GEO_COUNTRY_HEADER/,
    );
  });

  it('keeps signed media links short-lived', () => {
    expect(loadConfig({ ...minimal, MEDIA_URL_TTL_SEC: '900' }).stream.urlTtlSec).toBe(900);
    expect(() => loadConfig({ ...minimal, MEDIA_URL_TTL_SEC: '86400' })).toThrow(
      /MEDIA_URL_TTL_SEC/,
    );
  });

  it('reports missing required variables', () => {
    expect(() => loadConfig({})).toThrow(/REDIS_URL/);
  });
});
