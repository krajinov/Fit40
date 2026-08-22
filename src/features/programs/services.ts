/**
 * Composition root for the programs feature.
 *
 * This is the single place where the concrete in-memory repositories are wired
 * into the application use cases. To replace an adapter (e.g. with Drizzle),
 * change only this file.
 */

import { GetProgramBySlugUseCase } from '@/application/use-cases/get-program-by-slug';
import { GetScheduledWorkoutUseCase } from '@/application/use-cases/get-scheduled-workout';
import { ListProgramsUseCase } from '@/application/use-cases/list-programs';
import { InMemoryExerciseRepository } from '@/infrastructure/exercises/in-memory-exercise-repository';
import { InMemoryProgramRepository } from '@/infrastructure/programs/in-memory-program-repository';

const programRepository = new InMemoryProgramRepository();
const exerciseRepository = new InMemoryExerciseRepository();

export const listProgramsUseCase = new ListProgramsUseCase(programRepository);
export const getProgramBySlugUseCase = new GetProgramBySlugUseCase(programRepository);
export const getScheduledWorkoutUseCase = new GetScheduledWorkoutUseCase(
  programRepository,
  exerciseRepository,
);