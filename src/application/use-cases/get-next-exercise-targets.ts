/**
 * Use case: compute next-workout load targets for a batch of requested
 * exercises using the progressive overload engine.
 *
 * For each request (exercise + the prescription it is scheduled under), the
 * use case loads the exercise from the catalog and the user's recent
 * completed history of it — user-global across programs — then delegates the
 * decision to the pure domain engine. It owns no progression rules of its
 * own: it is the orchestration boundary that connects the history projection
 * and the exercise catalog to `calculateNextExerciseTarget`.
 *
 * Success returns exactly one target per request, in request order, so
 * callers can zip requests and results by position. A request referencing
 * an exercise that no longer exists (a workout pointing at a deleted
 * catalog entry) fails the whole batch with `EXERCISE_NOT_FOUND`.
 */

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type {
  ProgressionHistoryPerformance,
  TrainingHistoryRepository,
} from '@/application/ports/training-history-repository';
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

/**
 * RAW OCCURRENCE FETCH BOUND (infrastructure over-fetch ceiling) — at most
 * this many of the user's newest RAW completed occurrences are read per
 * exercise, in ONE batched history call for the whole request.
 *
 * This is deliberately NOT the domain's progression decision horizon. The
 * engine reads the raw newest occurrence plus the first ELIGIBLE prior
 * (skipping scheme-incompatible, incomplete, and unloaded occurrences itself
 * — see `below-minimum-trend.ts`); eligibility is domain logic and never
 * enters the query. The horizon stays conceptually at the newest relevant
 * performances: raw-5 lets the engine skip across up to three consecutive
 * ineligible occurrences and still see the first eligible prior. When MORE
 * than three consecutive ineligible occurrences precede the first eligible
 * prior, the read degrades conservatively — the engine holds instead of
 * regressing — never an unsafe load change.
 */
const PROGRESSION_HISTORY_RAW_FETCH_BOUND = 5;

/** Newest-first raw performance window per exercise, grouped from the flat projection. */
function windowsByExercise(
  performances: ReadonlyArray<ProgressionHistoryPerformance>,
): Map<ExerciseId, ProgressionHistoryPerformance[]> {
  const windows = new Map<ExerciseId, ProgressionHistoryPerformance[]>();
  for (const performance of performances) {
    const window = windows.get(performance.exerciseId) ?? [];
    window.push(performance);
    windows.set(performance.exerciseId, window);
  }
  return windows;
}

export class GetNextExerciseTargetsUseCase {
  constructor(
    private readonly exerciseRepository: ExerciseRepository,
    private readonly historyRepository: TrainingHistoryRepository,
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

    // One batched, bounded history read for every requested exercise: the
    // user's newest RAW completed occurrences per exercise, newest first.
    // The projection is structurally assignable to the engine's window
    // input (prescription + sets), so it is passed through unchanged.
    const performances = await this.historyRepository.listRecentCompletedExercisePerformances(
      userIdResult.data,
      exerciseIds,
      PROGRESSION_HISTORY_RAW_FETCH_BOUND,
    );
    const historyByExercise = windowsByExercise(performances);

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

      // The raw window is already newest first (index 0 = most recent);
      // the engine reads it as-is and applies its own eligibility skipping.
      const history = historyByExercise.get(request.exerciseId) ?? [];

      const target = calculateNextExerciseTarget(
        exercise,
        request.prescription,
        history,
      );

      targets.push({ exerciseId: request.exerciseId, target });
    }

    return ok(targets);
  }
}