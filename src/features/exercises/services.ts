/**
 * Composition root for the exercises feature.
 *
 * This is the single place where the concrete Drizzle repository is wired into
 * the application use cases.
 */

import { GetExerciseBySlugUseCase } from '@/application/use-cases/get-exercise-by-slug';
import { ListExercisesUseCase } from '@/application/use-cases/list-exercises';
import { exerciseRepository } from '@/infrastructure/database/repositories';

export const listExercisesUseCase = new ListExercisesUseCase(exerciseRepository);
export const getExerciseBySlugUseCase = new GetExerciseBySlugUseCase(exerciseRepository);