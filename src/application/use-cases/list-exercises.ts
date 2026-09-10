/**
 * Use case: list and filter exercises in the catalog.
 *
 * No expected failure path exists for listing, so this returns the array directly.
 * Unexpected infrastructure errors are allowed to propagate to the error boundary.
 */

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import {
  toExerciseSummaryDto,
  type ExerciseSummaryDto,
} from '@/application/dto/exercise';
import { filterExercises } from '@/domain/services/exercise-filtering';
import type { ExerciseFilterCriteria } from '@/domain/types/exercise';

export class ListExercisesUseCase {
  constructor(private readonly exerciseRepository: ExerciseRepository) {}

  async execute(
    criteria: ExerciseFilterCriteria,
  ): Promise<ReadonlyArray<ExerciseSummaryDto>> {
    const exercises = await this.exerciseRepository.list();
    const filtered = filterExercises(exercises, criteria);
    return filtered.map(toExerciseSummaryDto);
  }
}