/**
 * Composition root for the Drizzle repositories.
 *
 * Exports singleton instances wired to the shared production database client.
 * Integration tests construct their own instances with a test client instead.
 */

import { db } from '../client';
import { DrizzleExerciseRepository } from './drizzle-exercise-repository';
import { DrizzleProgramRepository } from './drizzle-program-repository';
import { DrizzleWorkoutSessionRepository } from './drizzle-workout-session-repository';

export const exerciseRepository = new DrizzleExerciseRepository(db);
export const programRepository = new DrizzleProgramRepository(db);
export const workoutSessionRepository = new DrizzleWorkoutSessionRepository(db);

export { DrizzleExerciseRepository } from './drizzle-exercise-repository';
export { DrizzleProgramRepository } from './drizzle-program-repository';
export {
  DrizzleWorkoutSessionRepository,
  WorkoutSessionConflictError,
} from './drizzle-workout-session-repository';
