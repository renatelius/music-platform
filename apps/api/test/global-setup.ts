import { runMigrations } from '../dist/db/migrate.js';
import { loadTestEnv } from './env.js';

/** Applies migrations to the test database once per test run. */
export default async function setup(): Promise<void> {
  loadTestEnv();
  await runMigrations(process.env.DATABASE_URL ?? '');
}
