/**
 * Composition root for the Drizzle repositories.
 *
 * Exports singleton instances wired to the shared production database client.
 * Integration tests construct their own instances with a test client instead.
 */

import { db } from '../client';
import { DrizzleExerciseRepository } from './drizzle-exercise-repository';
import { DrizzleProgramRepository } from './drizzle-program-repository';
import { DrizzleSessionRepository } from './drizzle-session-repository';
import { DrizzleUserRepository } from './drizzle-user-repository';
import { DrizzleWorkoutSessionRepository } from './drizzle-workout-session-repository';

export const exerciseRepository = new DrizzleExerciseRepository(db);
export const programRepository = new DrizzleProgramRepository(db);
export const workoutSessionRepository = new DrizzleWorkoutSessionRepository(db);
export const userRepository = new DrizzleUserRepository(db);
export const sessionRepository = new DrizzleSessionRepository(db);

export { DrizzleExerciseRepository } from './drizzle-exercise-repository';
export { DrizzleProgramRepository } from './drizzle-program-repository';
export { DrizzleSessionRepository } from './drizzle-session-repository';
export { DrizzleUserRepository } from './drizzle-user-repository';
export { DrizzleWorkoutSessionRepository } from './drizzle-workout-session-repository';
