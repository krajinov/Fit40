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

import type { SetLog, WorkoutSession } from '@/domain/entities/workout-session';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';
import type { ExerciseId, UserId, WorkoutSessionId } from '@/domain/types/ids';

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
 * One historical occurrence of one exercise: the (sessionId, exerciseOrder)
 * position of its exercise log within one of the user's COMPLETED sessions.
 *
 * Identity is occurrence-based, so an exercise performed twice in one
 * session produces two entries — duplicates are never collapsed. The
 * prescription is the persisted snapshot (historical truth), the sets are
 * exactly what was logged, and `programName`/`workoutName` are the display
 * names resolved by join (detached history keeps the names of its origin).
 */
export interface CompletedExerciseOccurrence {
  readonly sessionId: WorkoutSessionId;
  /** Position of the exercise log within the session — its identity part. */
  readonly exerciseOrder: number;
  /** ISO instant of the owning session's completion — history recency. */
  readonly completedAt: Date;
  readonly programName: string;
  readonly workoutName: string;
  /** The persisted prescription snapshot of this occurrence. */
  readonly prescription: RepPrescription;
  /** The logged sets, ordered by set number; at least one by contract. */
  readonly sets: ReadonlyArray<SetLog>;
}

/**
 * One completed performance of one exercise, projected for the progression
 * engine's newest-first history window (Slice 2 of the progressive-overload
 * milestone).
 *
 * Shape-wise this is `CompletedExerciseOccurrence` minus display names:
 * the engine reads only the prescription snapshot and the logged sets, so
 * the projection deliberately carries no session coordinates beyond the
 * (sessionId, exerciseOrder) occurrence identity and no join-resolved names.
 * It is structurally assignable to the domain's `PreviousExercisePerformance`
 * input, so the use case passes occurrences through unchanged.
 *
 * `0 kg` is a real external load; only `weightKg === null` marks an
 * unweighted (bodyweight) set. `rpe` rides along in the set logs but the
 * engine ignores it.
 */
export interface ProgressionHistoryPerformance {
  /** The exercise this performance is history for. */
  readonly exerciseId: ExerciseId;
  readonly sessionId: WorkoutSessionId;
  /** Position of the exercise log within the session — its identity part. */
  readonly exerciseOrder: number;
  /** ISO instant of the owning session's completion — history recency. */
  readonly completedAt: Date;
  /** The persisted prescription snapshot of this occurrence. */
  readonly prescription: RepPrescription;
  /** The logged sets, ordered by set number; at least one by contract. */
  readonly sets: ReadonlyArray<SetLog>;
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
   * Returns the user's completed occurrences of one exercise, newest first
   * (the same deterministic recency ladder as the session history:
   * completedAt desc, startedAt desc, session id desc, exerciseOrder desc so
   * two occurrences in one session order truthfully by position).
   *
   * Contract:
   * - User-scoped (`user_id`) regardless of enrollment: detached history
   *   stays included.
   * - Completed sessions only; the exercise log must have at least one
   *   logged set — an exercise skipped in an otherwise completed session is
   *   not an occurrence.
   * - Bounded: `limit` occurrences at most. The bound is a hard ceiling on
   *   read cost, not pagination — there is deliberately no cursor.
   * - Implementation must batch set hydration (no per-occurrence queries).
   */
  listCompletedExerciseOccurrences(
    userId: UserId,
    exerciseId: ExerciseId,
    limit: number,
  ): Promise<ReadonlyArray<CompletedExerciseOccurrence>>;

  /**
   * Returns the user's recent completed performances of MANY exercises —
   * the progression engine's batched, bounded, newest-first history windows
   * (progressive-overload milestone, Slice 2).
   *
   * Contract:
   * - Scopes to sessions OWNED by the user (`user_id`), regardless of
   *   enrollment: detached history (sessions left behind after leaving a
   *   program) is still the user's training past and therefore included.
   * - Completed sessions only; in-progress sessions never appear, even when
   *   started more recently (current-session logs never influence the next
   *   workout's targets). Occurrences are user-global across programs.
   * - Every returned occurrence must have at least one logged set: an
   *   exercise log with zero sets (the exercise was skipped in an otherwise
   *   completed session) is not a performance and never enters the window,
   *   so it never shadows an older real performance.
   * - Duplicate occurrences of one exercise inside one session are distinct
   *   occurrences, identified by `(sessionId, exerciseOrder)`; both may appear
   *   in the window.
   * - Within one exercise, occurrences are ordered newest first by the
   *   deterministic recency ladder: `completed_at` desc, `started_at` desc,
   *   session id desc, `exercise_order` desc (a repeated exercise inside one
   *   session resolves to its later position). Sets within one occurrence are
   *   ordered by set number.
   * - Bounded per exercise: at most `limitPerExercise` occurrences each. The
   *   bound is a hard ceiling on read cost — an INFRASTRUCTURE OVER-FETCH
   *   BOUND, deliberately NOT the domain's progression decision horizon.
   *   Eligibility (scheme compatibility, completeness, load) is domain logic
   *   and never moves into this query: the engine receives raw occurrences
   *   newest first and skips ineligible ones itself. When the raw bound hides
   *   the first eligible prior behind more consecutive ineligible occurrences
   *   than it can span, the engine degrades conservatively (it holds instead
   *   of regressing — never an unsafe load change).
   * - No N+1: implementations must batch hydration for all requested
   *   exercises (at most a constant number of queries, never one per
   *   exercise), so a whole workout's targets read in one bounded call.
   * - An empty `exerciseIds` returns an empty result without querying.
   * - The result is grouped and ordered by exercise id ascending; the
   *   projection is an isolated snapshot (mutating it never affects stored
   *   sessions).
   */
  listRecentCompletedExercisePerformances(
    userId: UserId,
    exerciseIds: ReadonlyArray<ExerciseId>,
    limitPerExercise: number,
  ): Promise<ReadonlyArray<ProgressionHistoryPerformance>>;

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

  /**
   * Returns the user's completed sessions with `completedAt >= since`, newest
   * first, as a lightweight activity projection — never hydrated aggregates.
   *
   * Contract:
   * - Scopes to sessions OWNED by the user (`user_id`), regardless of
   *   enrollment: detached (left-program) history is the user's training past
   *   and counts, and no enrollment filter is applied.
   * - Completed sessions only; an in-progress session never appears.
   * - `since` is INCLUSIVE: a session completed exactly at `since` is returned.
   * - Ordering is the deterministic history recency ladder with no window
   *   dependence: `completedAt` desc, `startedAt` desc, session id desc.
   * - Deliberately NOT paginated and NOT capped: the caller's `since` is the
   *   only bound, so an aggregate over the returned rows can never be
   *   incomplete because of a page size.
   * - Exactly one entry per completed session, carrying the display names of
   *   its workout template and program (resolved by join) and `loggedSets` as a
   *   plain COUNT of the session's persisted set rows. Because the count is
   *   plain, a completed session with no persisted set rows reports `0` instead
   *   of being dropped — a defensive guarantee for rows the domain's completion
   *   gate never produces (legacy or externally written data), never an
   *   invitation to infer performance from a session. This read never redefines
   *   what a completed workout is.
   * - Implementations must answer in a bounded number of statements (one
   *   session query plus one batched set-count query), never one per session.
   */
  listCompletedSessionActivity(
    userId: UserId,
    since: Date,
  ): Promise<ReadonlyArray<CompletedSessionActivityEntry>>;
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

/**
 * One bounded activity row: a completed session WITHOUT its aggregate
 * hydration. It exists so a date-windowed read (recent-activity aggregates)
 * can be answered from the session row plus a plain set count, instead of
 * loading exercise logs and set logs it would only summarise.
 *
 * `loggedSets` is the number of persisted set rows of the session — the same
 * fact the lifetime totals count. The domain's completion gate requires at
 * least one logged set, so `0` is a defensive answer for a session the write
 * path never produces; either way the entry is returned, never dropped.
 */
export interface CompletedSessionActivityEntry {
  readonly sessionId: WorkoutSessionId;
  readonly workoutName: string;
  readonly programName: string;
  readonly startedAt: Date;
  /** Non-null: the read is completed-only by construction. */
  readonly completedAt: Date;
  readonly loggedSets: number;
}
