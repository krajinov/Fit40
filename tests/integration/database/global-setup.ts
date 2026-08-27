import path from 'path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { getTestDatabaseUrl } from './test-env';

/**
 * Applies the generated migrations to the test database once, before any
 * integration test file runs.
 */
export default async function globalSetup(): Promise<void> {
  const client = postgres(getTestDatabaseUrl(), { max: 1 });
  const db = drizzle(client);

  await migrate(db, {
    migrationsFolder: path.resolve(process.cwd(), 'src/infrastructure/database/migrations'),
  });

  await client.end();
}
