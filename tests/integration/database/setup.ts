/**
 * Integration test database harness.
 *
 * IMPORTANT: `setupTestDb()` is destructive — it drops the `public` and
 * `drizzle` schemas and replays every migration. To make that impossible to
 * aim at a real database, the connection string is validated before any client
 * is created (see `test-database-url.ts`): it must come from `TEST_DATABASE_URL`
 * and name a database suffixed with `_test`.
 *
 * Tests run sequentially (`fileParallelism: false`) against this single shared
 * database, and each test file resets the data it depends on.
 */

import { afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

import * as schema from '@/infrastructure/database/schema';
import { assertSafeTestDatabaseUrl } from './test-database-url';

const connectionString = assertSafeTestDatabaseUrl({
  testUrl: process.env.TEST_DATABASE_URL,
  developmentUrl: process.env.DATABASE_URL,
});

// `onnotice` is silenced because the destructive setup intentionally emits
// "drop cascades to table ..." notices for every test.
const client = postgres(connectionString, { max: 1, onnotice: () => undefined });

export const testDb = drizzle(client, { schema });

/** Drops every schema object and re-applies the migration history. */
export async function setupTestDb(): Promise<void> {
  await testDb.execute('DROP SCHEMA IF EXISTS public CASCADE;');
  await testDb.execute('DROP SCHEMA IF EXISTS drizzle CASCADE;');
  await testDb.execute('CREATE SCHEMA public;');
  await migrate(testDb, { migrationsFolder: 'src/infrastructure/database/migrations' });
}

/** Removes all rows from every table, leaving the schema in place. */
export async function resetDatabase(): Promise<void> {
  await testDb.execute(`
    TRUNCATE TABLE
      set_logs,
      exercise_logs,
      workout_sessions,
      scheduled_workouts,
      program_weeks,
      workout_exercises,
      workouts,
      training_programs,
      exercises
    RESTART IDENTITY CASCADE;
  `);
}

afterAll(async () => {
  await client.end({ timeout: 5 });
});
