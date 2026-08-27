import { db } from '../client';
import { DrizzleExerciseRepository } from './drizzle-exercise-repository';
import { DrizzleProgramRepository } from './drizzle-program-repository';
import { DrizzleWorkoutSessionRepository } from './drizzle-workout-session-repository';

export const exerciseRepository = new DrizzleExerciseRepository(db);
export const programRepository = new DrizzleProgramRepository(db);
export const workoutSessionRepository = new DrizzleWorkoutSessionRepository(db);
