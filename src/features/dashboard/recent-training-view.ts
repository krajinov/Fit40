/**
 * Recent Training view state and mapping (M13 Slice 4).
 *
 * Behavior-preserving extraction from dashboard-view.ts: the card's state
 * types and the history-page DTO → view mapping now live beside their own
 * label helpers. dashboard-view.ts re-exports the state types so existing
 * importers (e.g. RecentTrainingCard) are unaffected.
 */

import type { TrainingHistoryPageDto } from '@/application/dto/training-history';
import { formatHistoryCount, formatHistoryDate } from '@/features/history/history-labels';

/** One recent-completed-session row of the Recent Training card. */
export interface RecentTrainingSession {
  readonly sessionId: string;
  readonly workoutName: string;
  readonly programName: string;
  /** Concise UTC date label, e.g. "Feb 15, 2026". */
  readonly completedAtLabel: string;
  /** "12 sets" — the session's logged-set count. */
  readonly setsLabel: string;
}

/**
 * Recent Training card state, built from the user-global history read model
 * (bounded to the dashboard's row limit, newest first). A discriminated
 * union so a failed history read cannot be represented as — or conflated
 * with — the genuine empty history: `loaded` with an empty array is "no
 * completed training yet", `unavailable` is "the read failed" (rendered as
 * its own truthful card state, never as empty).
 */
export type RecentTrainingState =
  | { readonly status: 'loaded'; readonly sessions: ReadonlyArray<RecentTrainingSession> }
  | { readonly status: 'unavailable' };

/**
 * Maps the history page DTO into the card's view rows. The repository's
 * order (the recency ladder, newest first) is preserved exactly — nothing
 * is re-sorted, trimmed, or fabricated.
 */
export function toRecentTraining(page: TrainingHistoryPageDto | null): RecentTrainingState {
  if (page === null) {
    return { status: 'unavailable' };
  }

  return {
    status: 'loaded',
    sessions: page.sessions.map((session) => ({
      sessionId: session.sessionId,
      workoutName: session.workoutName,
      programName: session.programName,
      completedAtLabel: formatHistoryDate(session.completedAt),
      setsLabel: `${formatHistoryCount(session.metrics.totalSets)} ${
        session.metrics.totalSets === 1 ? 'set' : 'sets'
      }`,
    })),
  };
}
