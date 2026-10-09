/**
 * Use case: the authenticated user's global history of one exercise, for the
 * per-exercise history screen.
 *
 * Read-only. The userId must come from the trusted authenticated session at
 * the presentation layer, never from client input; the slug is URL input
 * and validated here before any repository is touched.
 *
 * Three independent reads of the same resolved exercise (all user-scoped):
 * - the bounded occurrence window (newest first) with its working-load trend;
 * - the exercise's exact current all-time personal bests (M12), which span
 *   ALL completed history rather than the bounded window and never influence
 *   the trend, the ordering, or any progression input;
 * - the bounded window's historical PR events (M18 Slice 7, memo §8.6): the
 *   window's logged sets become M12 candidates and ONE batched
 *   `findBestValuesBefore` evaluates them against COMPLETE user-global prior
 *   history — the 50-occurrence bound limits presentation only and never
 *   detection. The resolved `max-load` events mark their occurrences.
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
  type ExerciseHistoryRecordMarker,
  EXERCISE_HISTORY_OCCURRENCE_LIMIT,
} from '@/application/dto/exercise-history';
import { toPersonalBestDto } from '@/application/dto/personal-records';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { PersonalRecordRepository } from '@/application/ports/personal-record-repository';
import type {
  CompletedExerciseOccurrence,
  TrainingHistoryRepository,
} from '@/application/ports/training-history-repository';
import { RecordMetric, toRecordCandidate } from '@/domain/services/personal-record-metrics';
import type { RecordCandidate } from '@/domain/services/personal-record-metrics';
import { resolveRecordEvents } from '@/domain/services/personal-records';
import type { RecordEvent } from '@/domain/services/personal-records';
import type { ExerciseId } from '@/domain/types/ids';
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

    // The window's logged sets are the marker candidates (Domain eligibility:
    // every set maps to exactly one metric). Nothing logged in the window means
    // no prior-best read is issued at all (the M14/M18 early-return pattern).
    const candidates = toWindowCandidates(exercise.id, occurrences);
    const priorBests =
      candidates.length === 0
        ? []
        : await this.personalRecordRepository.findBestValuesBefore(userIdResult.data, candidates);

    return ok(
      toExerciseHistoryDto(
        exercise,
        occurrences,
        personalBests.map(toPersonalBestDto),
        toMaxLoadRecordMarkers(resolveRecordEvents(priorBests)),
      ),
    );
  }
}

/**
 * Builds the M12 candidates of the DISPLAYED occurrences: one candidate per
 * logged set, positioned by the Domain's full ladder. The exercise id is the
 * resolved one the screen is about — the occurrence read already addresses
 * PERFORMED ids, so a substituted occurrence's sets count for the replacement
 * and the authored exercise receives nothing (memo §9). A skipped occurrence
 * holds no sets, so it contributes no candidate.
 */
function toWindowCandidates(
  exerciseId: ExerciseId,
  occurrences: ReadonlyArray<CompletedExerciseOccurrence>,
): ReadonlyArray<RecordCandidate> {
  const candidates: RecordCandidate[] = [];
  for (const occurrence of occurrences) {
    for (const set of occurrence.sets) {
      candidates.push(
        toRecordCandidate(exerciseId, set, {
          completedAt: occurrence.completedAt,
          startedAt: occurrence.startedAt,
          sessionId: occurrence.sessionId,
          exerciseOrder: occurrence.exerciseOrder,
          setNumber: set.setNumber,
        }),
      );
    }
  }
  return candidates;
}

/**
 * Projects the resolved events onto occurrence identities for the trend
 * markers (memo §8.6): `max-load` events only — an unloaded event has no trend
 * point to mark — and one entry per `(sessionId, exerciseOrder)`, carrying the
 * HEAVIEST event value of that occurrence. Events inside one occurrence are
 * strictly increasing by set number (each strictly exceeds everything before
 * it), so the heaviest is also the last. Insertion order follows the candidate
 * order, which the port preserves, so the result is deterministic.
 */
function toMaxLoadRecordMarkers(
  events: ReadonlyArray<RecordEvent>,
): ReadonlyArray<ExerciseHistoryRecordMarker> {
  const heaviestByOccurrence = new Map<string, ExerciseHistoryRecordMarker>();
  for (const event of events) {
    if (event.metric !== RecordMetric.MaxLoad) continue;
    const key = `${event.position.sessionId}#${event.position.exerciseOrder}`;
    const current = heaviestByOccurrence.get(key);
    if (current !== undefined && current.recordKg >= event.value) continue;
    heaviestByOccurrence.set(key, {
      sessionId: event.position.sessionId,
      exerciseOrder: event.position.exerciseOrder,
      recordKg: event.value,
    });
  }
  return [...heaviestByOccurrence.values()];
}
