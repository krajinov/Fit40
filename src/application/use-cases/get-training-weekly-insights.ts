/**
 * Use case: the authenticated dashboard's weekly training insights (M13
 * Slice 3).
 *
 * Read-only. The `userId` must come from the trusted authenticated session at
 * the presentation layer, never from client input, and the request clock is an
 * explicit input (the `issue-session` convention) so a request is deterministic
 * for a given instant instead of reading `Date.now()` inside the application.
 *
 * Three bounded reads, no N+1:
 * - one activity read for the whole lookback (`since` = the oldest week's
 *   start), which the Domain then buckets into weeks;
 * - one current-best read over the same span, bounded above by `now` — a
 *   still-standing best can only have been established in the past;
 * - one batched catalog read for the recent candidates' identity, skipped
 *   entirely when there is nothing to name.
 *
 * Semantics are never re-decided here: week windows, week totals and deltas come
 * from the Domain's training-week service, and record eligibility, ownership and
 * values come from the repository as authoritative. This use case only
 * orchestrates and maps.
 */

import { toExerciseSummaryDto, type ExerciseSummaryDto } from '@/application/dto/exercise';
import {
  selectRecentPersonalBestCandidates,
  toTrainingWeeklyInsightsDto,
  type TrainingWeeklyInsightsDto,
} from '@/application/dto/training-insights';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { PersonalRecordRepository } from '@/application/ports/personal-record-repository';
import type { TrainingHistoryRepository } from '@/application/ports/training-history-repository';
import {
  compareTrainingWeeks,
  listRecentTrainingWeekWindows,
  summarizeTrainingWeeks,
} from '@/domain/services/training-week';
import { createUserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

/** How many recent UTC training weeks the insights cover. */
export const TRAINING_INSIGHTS_WEEK_COUNT = 8;

export type GetTrainingWeeklyInsightsError = {
  readonly code: 'INVALID_INPUT';
  readonly message: string;
  readonly field?: string;
};

export interface GetTrainingWeeklyInsightsInput {
  readonly userId: string;
  /** The request clock: the current week is the one containing this instant. */
  readonly now: Date;
}

export class GetTrainingWeeklyInsightsUseCase {
  constructor(
    private readonly historyRepository: TrainingHistoryRepository,
    private readonly personalRecordRepository: PersonalRecordRepository,
    private readonly exerciseRepository: ExerciseRepository,
  ) {}

  async execute(
    input: GetTrainingWeeklyInsightsInput,
  ): Promise<Result<TrainingWeeklyInsightsDto, GetTrainingWeeklyInsightsError>> {
    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({ code: 'INVALID_INPUT', message: userIdResult.error.message, field: 'userId' });
    }
    const userId = userIdResult.data;

    const windows = listRecentTrainingWeekWindows(input.now, TRAINING_INSIGHTS_WEEK_COUNT);
    const oldestWindow = requireItem(windows, 0, 'oldest week window');
    const since = oldestWindow.weekStart;

    // Independent reads, issued together. No repository is touched before the
    // id is validated, and each is a single bounded call.
    const [activity, bests] = await Promise.all([
      this.historyRepository.listCompletedSessionActivity(userId, since),
      this.personalRecordRepository.findCurrentPersonalBestsSetBetween(userId, since, input.now),
    ]);

    const summaries = summarizeTrainingWeeks(activity, windows);
    const currentSummary = requireItem(summaries, summaries.length - 1, 'current week summary');
    const previousSummary = requireItem(summaries, summaries.length - 2, 'previous week summary');
    const comparison = compareTrainingWeeks(currentSummary, previousSummary);

    // Only the candidates that can actually render need catalog identity —
    // deduplicated, one batched call, and none at all when nothing can render.
    const candidateIds = [
      ...new Set(selectRecentPersonalBestCandidates(bests).map((best) => best.exerciseId)),
    ];
    const exercises: ReadonlyArray<ExerciseSummaryDto> =
      candidateIds.length === 0
        ? []
        : (await this.exerciseRepository.findByIds(candidateIds)).map(toExerciseSummaryDto);

    return ok(
      toTrainingWeeklyInsightsDto({
        summaries,
        currentWeek: currentSummary,
        previousWeek: previousSummary,
        comparison,
        bests,
        exercises,
      }),
    );
  }
}

/**
 * The item at `index`, or a thrown contract violation.
 *
 * The window count is fixed and `summarizeTrainingWeeks` returns exactly one
 * summary per supplied window, so a miss is an invariant violation rather than
 * a business outcome: reporting it as an empty week would silently invent "no
 * training".
 */
function requireItem<T>(items: ReadonlyArray<T>, index: number, label: string): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Training weekly insights contract violated: missing ${label}`);
  }
  return item;
}