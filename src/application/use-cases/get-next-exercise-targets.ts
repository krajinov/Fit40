/**
 * Use case: compute next-workout load targets for a batch of requested
 * exercises using the progressive overload engine.
 *
 * For each request (exercise + the prescription it is scheduled under), the
 * use case loads the exercise from the catalog and the user's latest
 * completed performance of it, then delegates the decision to the pure
 * domain engine. It owns no progression rules of its own: it is the
 * orchestration boundary that connects the history projection and the
 * exercise catalog to `calculateNextExerciseTarget`.
 *
 * Success returns exactly one target per request, in request order, so
 * callers can zip requests and results by position. A request referencing
 * an exercise that no longer exists (a workout pointing at a deleted
 * catalog entry) fails the whole batch with `EXERCISE_NOT_FOUND`.
 */

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type {
  LatestCompletedExercisePerformance,
  WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import type { ExerciseTargetDto } from '@/application/dto/exercise';
import type { Exercise } from '@/domain/entities/exercise';
import { calculateNextExerciseTarget } from '@/domain/services/exercise-progression';
import type { ExerciseId } from '@/domain/types/ids';
import { createUserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

export type GetNextExerciseTargetsError =
  | { readonly code: 'EXERCISE_NOT_FOUND'; readonly exerciseId: ExerciseId; readonly message: string }
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string };

/** One requested exercise: its catalog id and the prescription to progress under. */
export interface NextExerciseTargetRequest {
  readonly exerciseId: ExerciseId;
  readonly prescription: RepPrescription;
}

export interface GetNextExerciseTargetsInput {
  readonly userId: string;
  readonly requests: ReadonlyArray<NextExerciseTargetRequest>;
}

export class GetNextExerciseTargetsUseCase {
  constructor(
    private readonly exerciseRepository: ExerciseRepository,
    private readonly sessionRepository: WorkoutSessionRepository,
  ) {}

  async execute(
    input: GetNextExerciseTargetsInput,
  ): Promise<Result<ReadonlyArray<ExerciseTargetDto>, GetNextExerciseTargetsError>> {
    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({
        code: 'INVALID_INPUT',
        message: userIdResult.error.message,
        field: 'userId',
      });
    }

    if (input.requests.length === 0) {
      return ok([]);
    }

    // Both ports collapse duplicate ids by contract; deduplicating here keeps
    // the queries scoped to exactly the distinct exercises involved.
    const exerciseIds: ExerciseId[] = [...new Set(input.requests.map((r) => r.exerciseId))];

    const exercises = await this.exerciseRepository.findByIds(exerciseIds);
    const exerciseById = new Map<ExerciseId, Exercise>(exercises.map((e) => [e.id, e]));

    const performances = await this.sessionRepository.listLatestCompletedExercisePerformances(
      userIdResult.data,
      exerciseIds,
    );
    const performanceByExercise = new Map<ExerciseId, LatestCompletedExercisePerformance>(
      performances.map((p) => [p.exerciseId, p]),
    );

    const targets: ExerciseTargetDto[] = [];

    for (const request of input.requests) {
      const exercise = exerciseById.get(request.exerciseId);

      if (exercise === undefined) {
        return err({
          code: 'EXERCISE_NOT_FOUND',
          exerciseId: request.exerciseId,
          message: `Exercise "${request.exerciseId}" was not found in the exercise catalog`,
        });
      }

      // The history projection is structurally assignable to the engine's
      // PreviousExercisePerformance input (prescription + sets); absence of
      // history is the engine's first-exposure case.
      const target = calculateNextExerciseTarget(
        exercise,
        request.prescription,
        performanceByExercise.get(request.exerciseId) ?? null,
      );

      targets.push({ exerciseId: request.exerciseId, target });
    }

    return ok(targets);
  }
}