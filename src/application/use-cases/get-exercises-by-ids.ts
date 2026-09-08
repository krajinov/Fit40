/**
 * Use case: resolve presentation-neutral exercise summaries for a batch of
 * exercise ids in ONE repository call.
 *
 * Built for session-driven screens (M9 Active Workout metadata resolution):
 * callers hand over the ids they already hold — e.g. a session snapshot's
 * performed ids — and receive catalog summaries for rendering, with no
 * per-id lookups (no N+1) and no catalog-list over-fetch.
 *
 * Semantics follow the repository port contract: unknown ids are omitted
 * (the caller decides whether absence is an error), and an empty input
 * short-circuits to an empty result without touching the repository.
 */

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import {
  toExerciseSummaryDto,
  type ExerciseSummaryDto,
} from '@/application/dto/exercise';
import { createExerciseId, type ExerciseId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type GetExercisesByIdsError = {
  readonly code: 'INVALID_INPUT';
  readonly message: string;
  readonly field?: string;
};

export interface GetExercisesByIdsInput {
  readonly exerciseIds: ReadonlyArray<string>;
}

export class GetExercisesByIdsUseCase {
  constructor(private readonly exerciseRepository: ExerciseRepository) {}

  async execute(
    input: GetExercisesByIdsInput,
  ): Promise<Result<ReadonlyArray<ExerciseSummaryDto>, GetExercisesByIdsError>> {
    // Validate every id BEFORE any repository access, so a malformed id in
    // any position fails the whole batch deterministically instead of
    // partially resolving.
    const exerciseIds: ExerciseId[] = [];
    for (const [index, raw] of input.exerciseIds.entries()) {
      const idResult = createExerciseId(raw);
      if (!idResult.ok) {
        return err({
          code: 'INVALID_INPUT',
          message: idResult.error.message,
          field: `exerciseIds[${index}]`,
        });
      }
      exerciseIds.push(idResult.data);
    }

    // Empty input resolves to an empty result without querying — the same
    // short-circuit the port documents for itself.
    if (exerciseIds.length === 0) {
      return ok([]);
    }

    // Deduplicate before the single batched call so duplicate ids in the
    // input never widen the query. The port already collapses duplicates;
    // this keeps the call scoped to exactly the distinct exercises.
    const distinctIds = [...new Set(exerciseIds)];
    const exercises = await this.exerciseRepository.findByIds(distinctIds);

    // Unknown ids are omitted (port contract); ordering follows the
    // repository's result, deduplicated exactly as returned.
    return ok(exercises.map(toExerciseSummaryDto));
  }
}
