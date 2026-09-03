/**
 * Training-history repository port (read side).
 *
 * The user's training history is the user-global record of COMPLETED workout
 * sessions across every program — including sessions detached from their
 * enrollment after leaving a program. This port is deliberately separate from
 * `WorkoutSessionRepository` (the write-side aggregate port): history reads
 * need keyset pagination, program/workout display names, and completed-only
 * guarantees, none of which belong on the aggregate's persistence contract.
 *
 * Contract shared by all methods:
 * - Scopes to sessions OWNED by the user (`user_id`), regardless of
 *   enrollment: detached history is the user's training past and stays
 *   visible.
 * - Only completed sessions are history; in-progress sessions never appear,
 *   not even as zero-metric entries.
 * - Ordering is the deterministic keyset ladder `completedAt` desc,
 *   `startedAt` desc, session id desc. The session id tiebreaker makes the
 *   order total, so pagination is stable even when sessions share both
 *   timestamps.
 */

import type { WorkoutSession } from '@/domain/entities/workout-session';
import type { UserId, WorkoutSessionId } from '@/domain/types/ids';

/**
 * A `WorkoutSession` narrowed to its completed state: `completedAt` is
 * guaranteed non-null. Repository implementations enforce this invariant at
 * the boundary (they filter `completedAt IS NOT NULL` and treat a null value
 * despite the filter as corrupt data), so history consumers never see
 * `Date | null` for a field that is structurally always present.
 */
export type CompletedWorkoutSession = Omit<WorkoutSession, 'completedAt'> & {
  readonly completedAt: Date;
};

/**
 * A keyset position: the identity of the last row of the previous page in the
 * deterministic ordering. A page resumed "after" this position contains only
 * strictly older sessions (the tuple comparison is expanded into an
 * equivalent boolean predicate by implementations).
 */
export interface TrainingHistoryCursor {
  readonly completedAt: Date;
  readonly startedAt: Date;
  readonly sessionId: WorkoutSessionId;
}

/**
 * One history page request. `limit` is trusted by implementations: callers
 * normalize it (integer, clamped to 1–50) before reaching the port.
 * `after` is null for the first page.
 */
export interface TrainingHistoryQuery {
  readonly limit: number;
  readonly after: TrainingHistoryCursor | null;
}

/**
 * One completed session as history: the fully hydrated session aggregate
 * (exercise logs with their logged sets — the input to domain metrics) plus
 * the display names of its workout template and program, resolved by join.
 */
export interface TrainingHistoryEntry {
  readonly session: CompletedWorkoutSession;
  readonly programName: string;
  readonly workoutName: string;
}

/**
 * One history page: up to `query.limit` entries, and the keyset position to
 * resume from (`nextAfter`) when — and only when — more rows exist. There is
 * never a phantom trailing empty page.
 */
export interface TrainingHistoryPage {
  readonly entries: ReadonlyArray<TrainingHistoryEntry>;
  readonly nextAfter: TrainingHistoryCursor | null;
}

/**
 * Lifetime totals of the user's completed training. Deliberately plain
 * aggregates only: counts of completed sessions and of their logged sets.
 * Per-session metrics (reps, volume, duration) are derived in the
 * application layer from hydrated aggregates, never in SQL.
 */
export interface TrainingHistoryTotals {
  readonly completedSessions: number;
  readonly loggedSets: number;
}

/**
 * Read port for the user's training history.
 */
export interface TrainingHistoryRepository {
  /**
   * Returns one page of the user's completed sessions, newest first.
   *
   * Implemented as one page query over `workout_sessions` (with workout and
   * program name joins) plus batched exercise/set log queries for exactly the
   * returned page's sessions — no per-session queries.
   */
  listCompletedSessions(
    userId: UserId,
    query: TrainingHistoryQuery,
  ): Promise<TrainingHistoryPage>;

  /**
   * Returns the user's lifetime totals across all completed sessions,
   * including detached (left-program) history.
   */
  getTotals(userId: UserId): Promise<TrainingHistoryTotals>;

  /**
   * Returns one completed session of the user by id with its display
   * context, or null when the id does not address one of the user's
   * completed sessions. A missing, foreign, or still-in-progress session
   * is indistinguishable here (no existence leak): the completed-only and
   * ownership filters are structural parts of the query.
   */
  findCompletedSessionById(
    userId: UserId,
    sessionId: WorkoutSessionId,
  ): Promise<CompletedSessionContext | null>;
}

/**
 * One completed session with its display context: the hydrated aggregate
 * plus the workout-template and program display names resolved by join.
 * Exercise display metadata (current catalog names/equipment) is resolved
 * separately through the exercise-catalog port — current catalog state is
 * display-only and never part of the persisted historical record.
 */
export interface CompletedSessionContext {
  readonly session: CompletedWorkoutSession;
  readonly programName: string;
  readonly workoutName: string;
}
