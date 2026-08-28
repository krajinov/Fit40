import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/infrastructure/database/schema';
import { DrizzleExerciseRepository } from '@/infrastructure/database/repositories/drizzle-exercise-repository';
import { DrizzleProgramRepository } from '@/infrastructure/database/repositories/drizzle-program-repository';
import { DrizzleRegistrationRepository } from '@/infrastructure/database/repositories/drizzle-registration-repository';
import { DrizzleSessionRepository } from '@/infrastructure/database/repositories/drizzle-session-repository';
import { DrizzleUserRepository } from '@/infrastructure/database/repositories/drizzle-user-repository';
import { DrizzleWorkoutSessionRepository } from '@/infrastructure/database/repositories/drizzle-workout-session-repository';
import { seedDatabase } from '@/infrastructure/database/seed';

import { getTestDatabaseUrl } from './test-env';

const client = postgres(getTestDatabaseUrl(), { max: 1 });

export const db = drizzle(client, { schema });

export const exerciseRepository = new DrizzleExerciseRepository(db);
export const programRepository = new DrizzleProgramRepository(db);
export const workoutSessionRepository = new DrizzleWorkoutSessionRepository(db);
export const userRepository = new DrizzleUserRepository(db);
export const sessionRepository = new DrizzleSessionRepository(db);
export const registrationRepository = new DrizzleRegistrationRepository(db);

/**
 * Truncates every table, providing deterministic per-test isolation.
 */
export async function resetDatabase(): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      auth_sessions,
      set_logs,
      exercise_logs,
      workout_sessions,
      scheduled_workouts,
      program_weeks,
      workout_exercises,
      workouts,
      training_programs,
      exercises,
      users
    CASCADE
  `);
}

/**
 * Seeds reference data (exercises + programs) into the test database.
 */
export async function seedReferenceData(): Promise<void> {
  await seedDatabase(db);
}

/**
 * Convenience wrapper used in `beforeEach` to reset and reseed in one step.
 */
export async function resetAndSeed(): Promise<void> {
  await resetDatabase();
  await seedReferenceData();
}

export async function closeDatabase(): Promise<void> {
  await client.end();
}
