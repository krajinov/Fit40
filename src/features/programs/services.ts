/**
 * Composition root for the programs feature.
 *
 * This is the single place where the concrete Drizzle repositories are wired
 * into the application use cases. To replace an adapter, change only this file.
 */

import { GetProgramBySlugUseCase } from '@/application/use-cases/get-program-by-slug';
import { GetScheduledWorkoutUseCase } from '@/application/use-cases/get-scheduled-workout';
import { ListProgramsUseCase } from '@/application/use-cases/list-programs';
import { exerciseRepository, programRepository } from '@/infrastructure/database/repositories';

export const listProgramsUseCase = new ListProgramsUseCase(programRepository);
export const getProgramBySlugUseCase = new GetProgramBySlugUseCase(programRepository);
export const getScheduledWorkoutUseCase = new GetScheduledWorkoutUseCase(
  programRepository,
  exerciseRepository,
);
