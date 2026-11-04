import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads the repository .env and points DATABASE_URL at the TEST database.
 * Refuses to run against a database whose name does not end with `_test`.
 */
export function loadTestEnv(): void {
  const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const testUrl = process.env.DATABASE_URL_TEST;
  if (testUrl === undefined || testUrl === '') {
    throw new Error('DATABASE_URL_TEST is not set. Run setup.bat to create .env.');
  }
  if (!/\/[^/?]*_test(\?|$)/.test(testUrl)) {
    throw new Error('DATABASE_URL_TEST must point to a database whose name ends with _test.');
  }
  process.env.DATABASE_URL = testUrl;
  process.env.NODE_ENV = 'test';
}
