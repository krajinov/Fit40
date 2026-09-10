/**
 * Use case: list substitution candidates for one source exercise.
 *
 * Resolves the source from the catalog and delegates ALL candidate selection
 * semantics (tier fallback, ranking, deduplication, the limit) to the pure
 * domain selector via the shared DTO mapper. The use case owns no ranking
 * rules of its own.
 *
 * ONE CATALOG READ: candidate matches can live anywhere in the catalog, so
 * `execute` performs exactly one full `list()` per call — the source resolves
 * from that same read. Callers that need candidate lists for MANY source
 * exercises in one request (the M9 Active Workout) must instead load the
 * catalog once and map each source with the exported pure mapper
 * `toExerciseSubstitutionCandidatesDto`, which this use case also uses.
 *
 * Expected failures are returned as data: INVALID_INPUT (malformed source id)
 * and EXERCISE_NOT_FOUND (the id addresses no catalog exercise).
 */

import {
  toExerciseSubstitutionCandidatesDto,
  type ExerciseSubstitutionCandidatesDto,
} from '@/application/dto/substitution-candidates';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import { createExerciseId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type GetExerciseSubstitutionCandidatesError =
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string }
  | { readonly code: 'EXERCISE_NOT_FOUND'; readonly exerciseId: string; readonly message: string };

export interface GetExerciseSubstitutionCandidatesInput {
  readonly sourceExerciseId: string;
}

export class GetExerciseSubstitutionCandidatesUseCase {
  constructor(private readonly exerciseRepository: ExerciseRepository) {}

  async execute(
    input: GetExerciseSubstitutionCandidatesInput,
  ): Promise<Result<ExerciseSubstitutionCandidatesDto, GetExerciseSubstitutionCandidatesError>> {
    const idResult = createExerciseId(input.sourceExerciseId);
    if (!idResult.ok) {
      return err({
        code: 'INVALID_INPUT',
        message: idResult.error.message,
        field: 'sourceExerciseId',
      });
    }

    // One full catalog read: matches may be any catalog exercise, and the
    // source resolves from the same read — no second lookup.
    const catalog = await this.exerciseRepository.list();
    const source = catalog.find((exercise) => exercise.id === idResult.data);
    if (source === undefined) {
      return err({
        code: 'EXERCISE_NOT_FOUND',
        exerciseId: input.sourceExerciseId,
        message: `Exercise "${input.sourceExerciseId}" was not found in the exercise catalog`,
      });
    }

    return ok(toExerciseSubstitutionCandidatesDto(source, catalog));
  }
}
