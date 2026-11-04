import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Pool } from 'pg';

import * as schema from './schema.js';

export function createPool(connectionString: string, max: number): Pool {
  return new pg.Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30_000,
  });
}

export function createDb(pool: Pool) {
  return drizzle({ client: pool, schema });
}

export type Database = ReturnType<typeof createDb>;
