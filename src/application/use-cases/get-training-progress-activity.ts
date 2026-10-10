/**
 * Use case: the authenticated user's training-progress activity over the
 * fixed M18 horizon — `docs/training-progress.md` §4.1–§4.5, §5.
 *
 * Read-only. The `userId` must come from the trusted authenticated session at
 * the presentation layer, never from client input, and the request clock is
 * an explicit input (the `issue-session` convention), so a request is
 * deterministic for a given instant instead of reading `Date.now()` inside
 * the application.
 *
 * One bounded read, no N+1: the horizon's 13 windows are derived from `now`
 * with the Domain's `training-week` service, the repository answers the whole
 * window in a constant number of statements (`since` = the oldest window's
 * start, inclusive), and every week/period/average fact is decided by the
 * Domain's progress service — this use case only orchestrates and maps.
 *
 * The horizon is fixed at `PROGRESS_HORIZON_WEEK_COUNT`; there is no
 * user-selectable range in M18.
 */

import {
  PROGRESS_HORIZON_WEEK_COUNT,
  toProgressActivityDto,
  type ProgressActivityDto,
} from '@/application/dto/training-progress';
import type { TrainingHistoryRepository } from '@/application/ports/training-history-repository';
import {
  resolveAverageWorkoutsPerWeek,
  summarizeProgressPeriod,
  summarizeProgressWeeks,
} from '@/domain/services/training-progress';
import {
  listRecentTrainingWeekWindows,
} from '@/domain/services/training-week';
import { createUserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type GetTrainingProgressActivityError = {
  readonly code: 'INVALID_INPUT';
  readonly message: string;
  readonly field?: string;
};

export interface GetTrainingProgressActivityInput {
  readonly userId: string;
  /** The request clock: the current week is the one containing this instant. */
  readonly now: Date;
}

export class GetTrainingProgressActivityUseCase {
  constructor(private readonly historyRepository: TrainingHistoryRepository) {}

  async execute(
    input: GetTrainingProgressActivityInput,
  ): Promise<Result<ProgressActivityDto, GetTrainingProgressActivityError>> {
    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({ code: 'INVALID_INPUT', message: userIdResult.error.message, field: 'userId' });
    }

    const windows = listRecentTrainingWeekWindows(input.now, PROGRESS_HORIZON_WEEK_COUNT);
    const oldestWindow = requireItem(windows, 0, 'oldest week window');
    const currentWindow = requireItem(windows, windows.length - 1, 'current week window');

    // ONE uncapped read over the request's [oldest start, current week end).
    // The exclusive end remains the week's end, not the request instant.
    const activity = await this.historyRepository.listProgressSessionActivity(
      userIdResult.data,
      oldestWindow.weekStart,
      currentWindow.weekEnd,
    );

    const summaries = summarizeProgressWeeks(activity, windows);

    return ok(
      toProgressActivityDto({
        summaries,
        totals: summarizeProgressPeriod(summaries),
        average: resolveAverageWorkoutsPerWeek(summaries),
      }),
    );
  }
}

/**
 * The item at `index`, or a thrown contract violation.
 *
 * The window count is fixed and `listRecentTrainingWeekWindows` returns
 * exactly `count` windows, so a miss is a contract violation rather than a
 * business outcome: reporting it as an empty horizon would silently invent
 * "no training".
 */
function requireItem<T>(items: ReadonlyArray<T>, index: number, label: string): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Training progress activity contract violated: missing ${label}`);
  }
  return item;
}
