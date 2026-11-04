// Usage: pnpm db:migrate        (DATABASE_URL)
//        pnpm db:migrate:test   (DATABASE_URL_TEST)
import { runMigrations } from './migrate.js';

const useTestDb = process.argv.includes('--test');
const variable = useTestDb ? 'DATABASE_URL_TEST' : 'DATABASE_URL';
const url = process.env[variable];

if (url === undefined || url === '') {
  console.error(`${variable} is not set. Check .env in the repository root.`);
  process.exit(1);
}

await runMigrations(url);
console.log(`Migrations applied (${variable}).`);
