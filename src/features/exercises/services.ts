/**
 * Composition root for the exercises feature.
 *
 * This is the single place where the concrete in-memory repository is wired
 * into the application use cases. To replace the adapter (e.g. with Drizzle),
 * change only this file.
 */

import { GetExerciseBySlugUseCase } from '@/application/use-cases/get-exercise-by-slug';
import { ListExercisesUseCase } from '@/application/use-cases/list-exercises';
import { InMemoryExerciseRepository } from '@/infrastructure/exercises/in-memory-exercise-repository';

const exerciseRepository = new InMemoryExerciseRepository();

export const listExercisesUseCase = new ListExercisesUseCase(exerciseRepository);
export const getExerciseBySlugUseCase = new GetExerciseBySlugUseCase(exerciseRepository);