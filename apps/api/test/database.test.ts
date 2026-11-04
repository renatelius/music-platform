import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../dist/db/client.js';
import { users } from '../dist/db/schema.js';
import { DB } from '../dist/infra/tokens.js';
import { startTestApp, type TestApp } from './helpers.js';

describe('database', () => {
  let t: TestApp;
  let db: Database;

  beforeAll(async () => {
    t = await startTestApp();
    db = t.app.get<Database>(DB);
  });

  afterAll(async () => {
    await t.close();
  });

  it('has migrations applied, UUID v7 ids and case-insensitive unique emails', async () => {
    const email = `Test-${randomUUID()}@Example.com`;
    const [created] = await db.insert(users).values({ email, displayName: 'Test' }).returning();
    if (created === undefined) throw new Error('insert returned no row');
    try {
      expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
      expect(created.status).toBe('active');
      expect(created.locale).toBe('en');

      const found = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      expect(found.map((u) => u.id)).toEqual([created.id]);

      await expect(
        db.insert(users).values({ email: email.toUpperCase(), displayName: 'Dup' }),
      ).rejects.toThrow();
    } finally {
      await db.delete(users).where(eq(users.id, created.id));
    }
  });
});
