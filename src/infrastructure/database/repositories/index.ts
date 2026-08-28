/**
 * Composition root for the Drizzle repositories.
 *
 * Exports singleton instances wired to the shared production database client.
 * Integration tests construct their own instances with a test client instead.
 */

import { db } from '../client';
import { DrizzleExerciseRepository } from './drizzle-exercise-repository';
import { DrizzleProgramRepository } from './drizzle-program-repository';
import { DrizzleRegistrationRepository } from './drizzle-registration-repository';
import { DrizzleSessionRepository } from './drizzle-session-repository';
import { DrizzleUserRepository } from './drizzle-user-repository';
import { DrizzleUserProfileRepository } from './drizzle-user-profile-repository';
import { DrizzleWorkoutSessionRepository } from './drizzle-workout-session-repository';

export const exerciseRepository = new DrizzleExerciseRepository(db);
export const programRepository = new DrizzleProgramRepository(db);
export const workoutSessionRepository = new DrizzleWorkoutSessionRepository(db);
export const userRepository = new DrizzleUserRepository(db);
export const sessionRepository = new DrizzleSessionRepository(db);
export const registrationRepository = new DrizzleRegistrationRepository(db);
export const userProfileRepository = new DrizzleUserProfileRepository(db);

export { DrizzleExerciseRepository } from './drizzle-exercise-repository';
export { DrizzleProgramRepository } from './drizzle-program-repository';
export { DrizzleRegistrationRepository } from './drizzle-registration-repository';
export { DrizzleSessionRepository } from './drizzle-session-repository';
export { DrizzleUserRepository } from './drizzle-user-repository';
export { DrizzleUserProfileRepository } from './drizzle-user-profile-repository';
export { DrizzleWorkoutSessionRepository } from './drizzle-workout-session-repository';
