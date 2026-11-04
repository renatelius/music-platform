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
    expect(config.api.trustProxy).toBe(false);
    expect(config.s3.forcePathStyle).toBe(true);
    expect(config.rateLimit).toEqual({ max: 300, windowMs: 60_000, keyPrefix: 'rl' });
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

  it('reports missing required variables', () => {
    expect(() => loadConfig({})).toThrow(/REDIS_URL/);
  });
});
