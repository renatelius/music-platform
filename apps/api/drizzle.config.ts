import { defineConfig } from 'drizzle-kit';

// Schema is the source of truth. `pnpm db:generate` writes SQL migrations to ./drizzle,
// which are committed and applied with `pnpm db:migrate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
