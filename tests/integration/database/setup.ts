import { afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

import * as schema from '@/infrastructure/database/schema';

if (process.env.TEST_DATABASE_URL === undefined || process.env.TEST_DATABASE_URL.length === 0) {
  throw new Error('TEST_DATABASE_URL environment variable is required for integration tests');
}

const connectionString = process.env.TEST_DATABASE_URL;
const client = postgres(connectionString, { max: 1 });
export const testDb = drizzle(client, { schema });

export async function setupTestDb(): Promise<void> {
  await testDb.execute('DROP SCHEMA IF EXISTS public CASCADE;');
  await testDb.execute('DROP SCHEMA IF EXISTS drizzle CASCADE;');
  await testDb.execute('CREATE SCHEMA public;');
  await migrate(testDb, { migrationsFolder: 'src/infrastructure/database/migrations' });
}

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
