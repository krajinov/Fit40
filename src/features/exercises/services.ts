/**
 * Composition root for the exercises feature.
 *
 * This is the single place where the concrete Drizzle repository is wired into
 * the application use cases. To replace the adapter, change only this file.
 */

import { GetExerciseBySlugUseCase } from '@/application/use-cases/get-exercise-by-slug';
import { GetExerciseHistoryPresenceUseCase } from '@/application/use-cases/get-exercise-history-presence';
import { ListExercisesUseCase } from '@/application/use-cases/list-exercises';
import { exerciseRepository, trainingHistoryRepository } from '@/infrastructure/database/repositories';

export const listExercisesUseCase = new ListExercisesUseCase(exerciseRepository);
export const getExerciseBySlugUseCase = new GetExerciseBySlugUseCase(exerciseRepository);
export const getExerciseHistoryPresenceUseCase = new GetExerciseHistoryPresenceUseCase(
  trainingHistoryRepository,
  exerciseRepository,
);
