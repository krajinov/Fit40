/**
 * Read-only port for a run's schedule execution facts (M17).
 *
 * The M15 calendar derives each planned occurrence's status from session
 * execution truth (completed / in-progress) and the explicit not-performed
 * settlement. Those sets are mutually exclusive per occurrence — a live
 * session and a recorded fact can never legitimately coexist — so they must
 * come from ONE coherent database snapshot. Two independent statements under
 * READ COMMITTED can observe different instants while `recordNotPerformed`
 * atomically replaces an abandoned session with the fact (delete session +
 * insert fact + commit), handing `resolvePlannedWorkoutStatus` a stale
 * in-progress session beside the fresh fact — and in-progress precedence
 * would render Resume for a session that no longer exists. This port exists
 * so the execution facts are one snapshot owned by Infrastructure — the
 * Application layer never assembles them from independently mutable reads.
 *
 * The planned rows are deliberately NOT part of this port: they are calendar
 * intent, not execution truth, and the schedule read's documented cosmetic
 * window for intent-vs-execution skew is unchanged.
 *
 * **Reads only.** Every mutation of either fact is an enrollment-serialized
 * write owned by the separate `RunOccurrenceWriteRepository` authority; this
 * port declares no write method and never takes the enrollment write lock.
 *
 * The read contract:
 * - one snapshot: ONE SQL statement returning all three sets, so they can
 *   never be torn across a concurrent settlement transition.
 * - enrollment-scoped: the only key is the run's `EnrollmentId`; detached
 *   (leave/restart) history is excluded structurally.
 * - bounded: id projections and the fact rows only — no session aggregate,
 *   exercise log or set log is hydrated.
 * - deterministic: each set is ordered by `scheduled_workout_id`, never by
 *   implicit database order.
 *
 * It decides nothing: status precedence and focus stay with the Domain's
 * `resolvePlannedWorkoutStatus` / `resolveScheduleFocus`.
 */

import type { NotPerformedOccurrence } from '@/domain/entities/not-performed-occurrence';
import type { EnrollmentId, ProgramId, ScheduledWorkoutId, UserId } from '@/domain/types/ids';

/** A run's session execution truth and settlement facts from one snapshot. */
export interface ScheduleExecutionFacts {
  /** Occurrences with a completed session (M14). */
  readonly completedIds: ReadonlyArray<ScheduledWorkoutId>;
  /** Occurrences with a live in-progress session. */
  readonly inProgressIds: ReadonlyArray<ScheduledWorkoutId>;
  /** Occurrences explicitly recorded as not performed (M17), with instants. */
  readonly notPerformedFacts: ReadonlyArray<NotPerformedOccurrence>;
}

/**
 * The FENCED projection: whether the caller's expected enrollment still exists
 * as the trusted (user, program) pair's run, and - only when it does - that
 * run's execution facts. `matched: false` (gone, replaced, foreign) is NEVER
 * reported as matched with empty facts, which would misread a vanished run as
 * an unconfigured one inside a parent view still describing the old
 * generation. Mirrors `FencedRunClosureFacts` on the closure-facts port.
 */
export type FencedScheduleExecutionFacts =
  | { readonly matched: true; readonly facts: ScheduleExecutionFacts }
  | { readonly matched: false };

export interface ScheduleExecutionFactsRepository {
  /** All three execution-fact sets of one run, read from ONE snapshot. */
  listScheduleExecutionFactsByEnrollment(
    enrollmentId: EnrollmentId,
  ): Promise<ScheduleExecutionFacts>;

  /**
   * The fenced variant for a caller composing this read into an
   * already-loaded run (the dashboard, program detail): ONE statement
   * anchors on `program_enrollments` (verifying the expected id AND the
   * trusted `userId` / `programId` in the same predicate) and projects the
   * facts from that same snapshot, so the answer is exactly one of the two
   * coherent states - matched with that run's facts, or not matched. Never a
   * validated-but-vanished enrollment whose empty facts would be rendered as
   * a fresh unconfigured run beside old-generation parent data.
   */
  findFencedScheduleExecutionFactsByEnrollment(
    expectedEnrollmentId: EnrollmentId,
    userId: UserId,
    programId: ProgramId,
  ): Promise<FencedScheduleExecutionFacts>;
}
