/**
 * Use case: the authenticated user's global history of one exercise, for the
 * per-exercise history screen.
 *
 * Read-only. The userId must come from the trusted authenticated session at
 * the presentation layer, never from client input; the slug is URL input
 * and validated here before any repository is touched.
 *
 * Two independent reads of the same resolved exercise (both user-scoped):
 * - the bounded occurrence window (newest first) with its working-load trend;
 * - the exercise's exact current all-time personal bests (M12), which span
 *   ALL completed history rather than the bounded window and never influence
 *   the trend, the ordering, or any progression input.
 *
 * Error contract:
 * - INVALID_INPUT: a malformed userId.
 * - EXERCISE_NOT_FOUND: the slug addresses no catalog exercise — the route
 *   renders 404. A catalog exercise with NO user history is NOT an error:
 *   the use case returns the exercise with empty entries/trend/personal
 *   bests, so the screen can render its empty state.
 * - Ownership is enforced structurally by the queries (user-scoped), and an
 *   exercise that exists but was never performed simply has no rows —
 *   no existence leak to worry about beyond the slug itself.
 */

import {
  toExerciseHistoryDto,
  type ExerciseHistoryDto,
  EXERCISE_HISTORY_OCCURRENCE_LIMIT,
} from '@/application/dto/exercise-history';
import { toPersonalBestDto } from '@/application/dto/personal-records';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { PersonalRecordRepository } from '@/application/ports/personal-record-repository';
import type { TrainingHistoryRepository } from '@/application/ports/training-history-repository';
import { createUserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type GetExerciseHistoryError =
  | {
      readonly code: 'INVALID_INPUT';
      readonly message: string;
      readonly field?: string;
    }
  | {
      readonly code: 'EXERCISE_NOT_FOUND';
      readonly slug: string;
      readonly message: string;
    };

/**
 * Hard ceiling on the occurrences read per request (no pagination). Owned by
 * the DTO module (the training-history convention); re-exported here for the
 * use case's public surface.
 */
export { EXERCISE_HISTORY_OCCURRENCE_LIMIT };

export interface GetExerciseHistoryInput {
  readonly userId: string;
  readonly slug: string;
}

export class GetExerciseHistoryUseCase {
  constructor(
    private readonly historyRepository: TrainingHistoryRepository,
    private readonly exerciseRepository: ExerciseRepository,
    private readonly personalRecordRepository: PersonalRecordRepository,
  ) {}

  async execute(
    input: GetExerciseHistoryInput,
  ): Promise<Result<ExerciseHistoryDto, GetExerciseHistoryError>> {
    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({ code: 'INVALID_INPUT', message: userIdResult.error.message, field: 'userId' });
    }

    const exercise = await this.exerciseRepository.findBySlug(input.slug);
    if (exercise === null) {
      return err({
        code: 'EXERCISE_NOT_FOUND',
        slug: input.slug,
        message: `Exercise "${input.slug}" not found`,
      });
    }

    // The two reads are independent (the bounded occurrence window and the
    // exact all-time records) and both address the resolved ExerciseId — never
    // the authored one, so substituted and user-added performances count for
    // the exercise actually trained. No record value is computed here: the
    // repository owns every eligibility and ordering rule.
    const [occurrences, personalBests] = await Promise.all([
      this.historyRepository.listCompletedExerciseOccurrences(
        userIdResult.data,
        exercise.id,
        EXERCISE_HISTORY_OCCURRENCE_LIMIT,
      ),
      this.personalRecordRepository.findCurrentPersonalBests(userIdResult.data, [exercise.id]),
    ]);

    return ok(
      toExerciseHistoryDto(exercise, occurrences, personalBests.map(toPersonalBestDto)),
    );
  }
}
