/**
 * Server-side view assembly for the training-history screen.
 *
 * `toHistoryView` is the pure DTO → view-model mapping — labels are
 * formatted here so the components stay presentational. `buildHistoryView`
 * orchestrates the two read use cases through the feature composition root.
 *
 * Everything rendered is data the application layer already exposes. The
 * aggregate's `totalDurationSeconds` is deliberately omitted from the view:
 * it is the sum of logged timed work, not the workout's duration, and
 * labeling it "duration" would misrepresent the metric. Zero-value reps and
 * volume are suppressed (e.g. bodyweight-only sessions) instead of showing
 * misleading "0" badges.
 */

import type {
  TrainingHistoryPageDto,
  TrainingTotalsDto,
} from '@/application/dto/training-history';
import { err, ok, type Result } from '@/domain/types/result';
import {
  formatHistoryCount,
  formatHistoryDate,
  formatHistoryVolume,
} from '@/features/history/history-labels';
import {
  getTrainingTotalsUseCase,
  listTrainingHistoryUseCase,
} from '@/features/history/services';

export interface HistoryTotalsView {
  readonly completedWorkouts: string;
  readonly loggedSets: string;
}

export interface HistorySessionView {
  readonly sessionId: string;
  readonly workoutName: string;
  readonly programName: string;
  readonly completedAtLabel: string;
  readonly setsLabel: string;
  /** Null when the session logged no reps (e.g. duration-only training). */
  readonly repsLabel: string | null;
  /** Null when the session produced no external-load volume. */
  readonly volumeLabel: string | null;
}

export interface HistoryView {
  readonly totals: HistoryTotalsView;
  readonly sessions: ReadonlyArray<HistorySessionView>;
  /** `/history?cursor=…` when an older page exists, else null. */
  readonly olderPageHref: string | null;
}

export interface HistoryViewError {
  readonly code: 'INVALID_INPUT';
  readonly message: string;
}

/**
 * Pure DTO → view-model mapping. Session order is preserved exactly as the
 * application layer delivered it (newest first); nothing is sorted, trimmed,
 * or fabricated here.
 */
export function toHistoryView(
  page: TrainingHistoryPageDto,
  totals: TrainingTotalsDto,
): HistoryView {
  const sessions = page.sessions.map((session) => ({
    sessionId: session.sessionId,
    workoutName: session.workoutName,
    programName: session.programName,
    completedAtLabel: formatHistoryDate(session.completedAt),
    setsLabel: `${formatHistoryCount(session.metrics.totalSets)} ${
      session.metrics.totalSets === 1 ? 'set' : 'sets'
    }`,
    repsLabel:
      session.metrics.totalReps > 0
        ? `${formatHistoryCount(session.metrics.totalReps)} reps`
        : null,
    volumeLabel:
      session.metrics.volume > 0 ? formatHistoryVolume(session.metrics.volume) : null,
  }));

  return {
    totals: {
      completedWorkouts: formatHistoryCount(totals.completedSessions),
      loggedSets: formatHistoryCount(totals.loggedSets),
    },
    sessions,
    olderPageHref:
      page.nextCursor === null
        ? null
        : `/history?cursor=${encodeURIComponent(page.nextCursor)}`,
  };
}

/**
 * Builds the history view for one authenticated user and page position.
 *
 * The cursor is an opaque token from a previous page of this screen; a token
 * that fails validation is reported as INVALID_INPUT so the route can handle
 * it like any other unresolvable URL input.
 */
export async function buildHistoryView(
  userId: string,
  cursor: string | null,
): Promise<Result<HistoryView, HistoryViewError>> {
  const pageResult = await listTrainingHistoryUseCase.execute({ userId, cursor });
  if (!pageResult.ok) {
    return err({ code: pageResult.error.code, message: pageResult.error.message });
  }

  const totalsResult = await getTrainingTotalsUseCase.execute(userId);
  if (!totalsResult.ok) {
    return err({ code: totalsResult.error.code, message: totalsResult.error.message });
  }

  return ok(toHistoryView(pageResult.data, totalsResult.data));
}
