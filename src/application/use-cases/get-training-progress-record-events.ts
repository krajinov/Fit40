/**
 * Use case: the authenticated user's historical personal-record events over the
 * fixed M18 Progress horizon — `docs/training-progress.md` §8.
 *
 * Read-only. The `userId` must come from the trusted authenticated session at
 * the presentation layer, never from client input, and the request clock is an
 * explicit input (the `issue-session` convention), so a request is
 * deterministic for a given instant.
 *
 * The M12 pipeline is reused verbatim — never re-implemented:
 *
 *   sessions completed in the horizon (user-global, detached-inclusive read)
 *     -> extractRecordCandidates(session)             // Domain: eligibility + positions
 *     -> findBestValuesBefore(userId, candidates)     // exact best strictly before, user-global
 *     -> resolveRecordEvents(priorBests)              // Domain: first/strictly-greater only
 *
 * Candidate ORIGIN is horizon-scoped; prior-best evaluation stays user-global
 * and exact — history older than the horizon, other programs and detached
 * sessions all count — so "a PR event during this period" means what was true at
 * that point in history (memo §8.1). EVERY candidate is supplied to the batched
 * prior-best read: there is no page size, offset, candidate cap or top-K
 * anywhere in this path (memo §8.2). The exact event count is computed before
 * the newest-N display selection, which therefore never alters it.
 *
 * Still-stands context is resolved for the DISPLAYED events only (one batched
 * current-best read over their exercises) and never influences the count.
 */

import { toExerciseSummaryDto, type ExerciseSummaryDto } from '@/application/dto/exercise';
import {
  PROGRESS_HORIZON_WEEK_COUNT,
  selectNewestProgressRecordEvents,
  toProgressRecordEventsDto,
  type ProgressRecordEventsDto,
} from '@/application/dto/training-progress';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { PersonalRecordRepository } from '@/application/ports/personal-record-repository';
import type { TrainingHistoryRepository } from '@/application/ports/training-history-repository';
import type { RecordCandidate } from '@/domain/services/personal-record-metrics';
import { extractRecordCandidates, resolveRecordEvents } from '@/domain/services/personal-records';
import type { PersonalBest } from '@/domain/services/personal-records';
import { listRecentTrainingWeekWindows } from '@/domain/services/training-week';
import { createUserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type GetTrainingProgressRecordEventsError = {
  readonly code: 'INVALID_INPUT';
  readonly message: string;
  readonly field?: string;
};

export interface GetTrainingProgressRecordEventsInput {
  readonly userId: string;
  /** The request clock: the horizon's current week contains this instant. */
  readonly now: Date;
}

export class GetTrainingProgressRecordEventsUseCase {
  constructor(
    private readonly historyRepository: TrainingHistoryRepository,
    private readonly personalRecordRepository: PersonalRecordRepository,
    private readonly exerciseRepository: ExerciseRepository,
  ) {}

  async execute(
    input: GetTrainingProgressRecordEventsInput,
  ): Promise<Result<ProgressRecordEventsDto, GetTrainingProgressRecordEventsError>> {
    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({ code: 'INVALID_INPUT', message: userIdResult.error.message, field: 'userId' });
    }
    const userId = userIdResult.data;

    const windows = listRecentTrainingWeekWindows(input.now, PROGRESS_HORIZON_WEEK_COUNT);
    const oldestWindow = requireItem(windows, 0, 'oldest week window');

    // ONE bounded hydration read of the horizon's completed sessions
    // (user-global, detached-inclusive). `since` is the only bound; a truncated
    // read would silently under-count the period, so none exists.
    const sessions = await this.historyRepository.listCompletedSessionsSince(
      userId,
      oldestWindow.weekStart,
    );

    const candidates: RecordCandidate[] = [];
    for (const session of sessions) {
      const extracted = extractRecordCandidates(session);
      if (!extracted.ok) {
        // A completed session whose rows violate a domain invariant is corrupt
        // data, never a business outcome: fail loudly instead of answering a
        // smaller number.
        throw new Error(
          `Corrupt data in completed session (id=${session.id}): ${extracted.error.message}`,
        );
      }
      candidates.push(...extracted.data);
    }

    // Nothing logged in the horizon: there is no record to look up, so the
    // exact prior-best read is not issued at all (the M14 early-return pattern).
    if (candidates.length === 0) {
      return ok({ recordEventCount: 0, events: [] });
    }

    // ONE batched prior-best read over EVERY candidate — the port's exactness
    // contract (no top-K, no page size), evaluated against complete user-global
    // history regardless of the horizon.
    const priorBests = await this.personalRecordRepository.findBestValuesBefore(
      userId,
      candidates,
    );
    const events = resolveRecordEvents(priorBests);

    // Display identity only: the exercises of the NEWEST events. The count
    // above is exact and is never affected by anything that follows.
    const displayExerciseIds = [
      ...new Set(selectNewestProgressRecordEvents(events).map((event) => event.exerciseId)),
    ];

    const currentBests: ReadonlyArray<PersonalBest> =
      displayExerciseIds.length === 0
        ? []
        : await this.personalRecordRepository.findCurrentPersonalBests(userId, displayExerciseIds);
    const exercises: ReadonlyArray<ExerciseSummaryDto> =
      displayExerciseIds.length === 0
        ? []
        : (await this.exerciseRepository.findByIds(displayExerciseIds)).map(toExerciseSummaryDto);

    return ok(toProgressRecordEventsDto({ events, currentBests, exercises }));
  }
}

/**
 * The item at `index`, or a thrown contract violation.
 *
 * The window count is fixed and `listRecentTrainingWeekWindows` returns exactly
 * `count` windows, so a miss is a contract violation rather than a business
 * outcome: reporting it as an empty horizon would silently invent "no events".
 */
function requireItem<T>(items: ReadonlyArray<T>, index: number, label: string): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Training progress record events contract violated: missing ${label}`);
  }
  return item;
}
