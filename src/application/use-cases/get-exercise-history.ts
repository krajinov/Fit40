/**
 * Use case: the authenticated user's global history of one exercise, for the
 * per-exercise history screen.
 *
 * Read-only. The userId must come from the trusted authenticated session at
 * the presentation layer, never from client input; the slug is URL input
 * and validated here before any repository is touched; the request clock is an
 * explicit input (the `issue-session` convention), so a request is
 * deterministic for a given instant.
 *
 * Four reads of the same resolved exercise (all user-scoped), none of which
 * feeds another:
 * - the bounded occurrence window (newest first) with its working-load trend;
 * - the exercise's exact current all-time personal bests (M12), which span
 *   ALL completed history rather than the bounded window and never influence
 *   the trend, the ordering, or any progression input;
 * - the bounded window's historical PR events (M18 Slice 7, memo §8.6): the
 *   window's logged sets become M12 candidates and ONE batched
 *   `findBestValuesBefore` evaluates them against COMPLETE user-global prior
 *   history — the 50-occurrence bound limits presentation only and never
 *   detection. The resolved `max-load` events mark their occurrences.
 * - the 13-week PERIOD's occurrences, read UNCAPPED from the horizon's start
 *   (M18 Slice 8, memo §7): the comparison is scoped to the period, so the
 *   display bound can never truncate it. The Domain resolves first/latest over
 *   exactly those rows; this layer adds no comparison rule.
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
  type ExerciseHistoryComparisonDto,
  type ExerciseHistoryDto,
  type ExerciseHistoryRecordMarker,
  EXERCISE_HISTORY_OCCURRENCE_LIMIT,
} from '@/application/dto/exercise-history';
import { toPersonalBestDto } from '@/application/dto/personal-records';
import { PROGRESS_HORIZON_WEEK_COUNT } from '@/application/dto/training-progress';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { PersonalRecordRepository } from '@/application/ports/personal-record-repository';
import type {
  CompletedExerciseOccurrence,
  TrainingHistoryRepository,
} from '@/application/ports/training-history-repository';
import {
  resolveOccurrenceWorkingLoad,
  resolveWorkingLoadComparison,
} from '@/domain/services/occurrence-working-load';
import { RecordMetric, toRecordCandidate } from '@/domain/services/personal-record-metrics';
import type { RecordCandidate } from '@/domain/services/personal-record-metrics';
import { resolveRecordEvents } from '@/domain/services/personal-records';
import type { RecordEvent } from '@/domain/services/personal-records';
import { listRecentTrainingWeekWindows } from '@/domain/services/training-week';
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
  /**
   * The request clock (M18 Slice 8). The comparison's 13-week horizon starts at
   * the oldest of `PROGRESS_HORIZON_WEEK_COUNT` UTC Monday weeks containing this
   * instant — the same horizon `docs/training-progress.md` §5 locks for every
   * M18 surface.
   */
  readonly now: Date;
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

    // The period's own bound: the oldest UTC Monday of the fixed M18 horizon
    // (§5). `since` is inclusive, so an occurrence completed exactly at that
    // Monday 00:00 belongs to the period.
    const period = requireProgressPeriod(input.now);

    // The four reads are independent and all address the resolved ExerciseId —
    // never the authored one, so substituted and user-added performances count
    // for the exercise actually trained. No record, marker or comparison value
    // is computed here: the Domain owns every eligibility and ordering rule.
    const [occurrences, personalBests, periodOccurrences] = await Promise.all([
      this.historyRepository.listCompletedExerciseOccurrences(
        userIdResult.data,
        exercise.id,
        EXERCISE_HISTORY_OCCURRENCE_LIMIT,
      ),
      this.personalRecordRepository.findCurrentPersonalBests(userIdResult.data, [exercise.id]),
      this.historyRepository.listCompletedExerciseOccurrencesSince(
        userIdResult.data,
        exercise.id,
        period.start,
        period.end,
      ),
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
        toComparisonDto(periodOccurrences),
      ),
    );
  }
}

/**
 * The inclusive start and exclusive end of the fixed request horizon.
 *
 * `listRecentTrainingWeekWindows` returns exactly the requested count of
 * windows, so a missing edge is a contract violation rather than a business
 * outcome: defaulting it would silently widen (or drop) the comparison's
 * period.
 */
function requireProgressPeriod(now: Date): { readonly start: Date; readonly end: Date } {
  const windows = listRecentTrainingWeekWindows(now, PROGRESS_HORIZON_WEEK_COUNT);
  const oldest = windows[0];
  const current = windows[windows.length - 1];
  if (oldest === undefined || current === undefined) {
    throw new Error('Exercise history contract violated: no horizon week window');
  }
  return { start: oldest.weekStart, end: current.weekEnd };
}

/**
 * Builds the period comparison DTO from the Domain's answer.
 *
 * The Domain decides first/latest, direction and the <2-points null; this
 * function only adds the §7.6 distinction between "the period logged no
 * external load at all" and "fewer than two loaded workouts", using the same
 * Domain load rule so eligibility never has a second definition.
 */
function toComparisonDto(
  occurrences: ReadonlyArray<CompletedExerciseOccurrence>,
): ExerciseHistoryComparisonDto {
  const comparison = resolveWorkingLoadComparison(occurrences);
  if (comparison !== null) {
    return {
      status: 'compared',
      first: {
        loadKg: comparison.first.loadKg,
        completedAt: comparison.first.completedAt.toISOString(),
      },
      latest: {
        loadKg: comparison.latest.loadKg,
        completedAt: comparison.latest.completedAt.toISOString(),
      },
      direction: comparison.direction,
    };
  }

  const hasLoadedOccurrence = occurrences.some(
    (occurrence) =>
      resolveOccurrenceWorkingLoad(occurrence.prescription, occurrence.sets).kind === 'external',
  );

  return {
    status: 'insufficient',
    reason:
      occurrences.length > 0 && !hasLoadedOccurrence
        ? 'no_external_load'
        : 'fewer_than_two_points',
  };
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
