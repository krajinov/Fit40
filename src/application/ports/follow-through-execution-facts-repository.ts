/**
 * Read-only port for a run's follow-through execution facts (M17).
 *
 * The M16 plan follow-through derives each current planned occurrence's
 * outcome from session execution truth (completed activity / live in-progress
 * sessions) and the explicit not-performed settlement. Those facts are
 * mutually exclusive per occurrence — a completed session and a recorded fact
 * can never legitimately coexist — so they must come from ONE coherent
 * database snapshot. Two independent statements under READ COMMITTED can
 * observe different instants while `recordNotPerformed`'s inverse transition
 * (Undo → start → complete, committed atomically) replaces a recorded fact
 * with a completed session, handing the Domain BOTH facts for one occurrence
 * — which `resolveFollowThroughOutcome` correctly rejects as contradictory.
 * This port exists so the execution facts are one snapshot owned by
 * Infrastructure — the Application layer never assembles them from
 * independently mutable reads.
 *
 * The planned rows are deliberately NOT part of this port: they are calendar
 * intent, not execution truth, and the report's documented intent-vs-execution
 * cosmetic window is unchanged.
 *
 * **Reads only.** Every mutation of either fact is an enrollment-serialized
 * write owned by the separate `RunOccurrenceWriteRepository` authority; this
 * port declares no write method and never takes the enrollment write lock.
 *
 * The read contract:
 * - one snapshot: ONE SQL statement returning all three sets, so they can
 *   never be torn across a concurrent settlement transition.
 * - enrollment-scoped: the only key is the run's `EnrollmentId`; detached
 *   history is excluded structurally.
 * - deterministic: each set is ordered by `scheduled_workout_id`, never by
 *   implicit database order.
 *
 * It decides nothing: outcome precedence stays with the Domain's
 * `resolveFollowThroughOutcome` / `summarizeFollowThrough`.
 */

import type { NotPerformedOccurrence } from '@/domain/entities/not-performed-occurrence';
import type { PlannedWorkout } from '@/domain/entities/planned-workout';
import type { EnrollmentId, ProgramId, ScheduledWorkoutId, UserId } from '@/domain/types/ids';
import type { CompletedOccurrenceActivity } from './workout-session-repository';

/** A run's session execution truth and settlement facts from one snapshot. */
export interface FollowThroughExecutionFacts {
  /** The run's completed occurrences, with their completion instants. */
  readonly completedActivity: ReadonlyArray<CompletedOccurrenceActivity>;
  /** Occurrences with a live in-progress session. */
  readonly inProgressIds: ReadonlyArray<ScheduledWorkoutId>;
  /** Occurrences explicitly recorded as not performed (M17), with instants. */
  readonly notPerformedFacts: ReadonlyArray<NotPerformedOccurrence>;
}

/**
 * The FENCED projection: whether the caller's expected enrollment still exists
 * as the trusted (user, program) pair's run, and - only when it does - that
 * run's execution facts. `matched: false` is never reported as matched with
 * empty facts, which would misread a vanished run as a fresh one inside a
 * parent view still describing the old generation. Mirrors
 * `FencedRunClosureFacts` on the closure-facts port.
 */
export type FencedFollowThroughExecutionFacts =
  | {
      readonly matched: true;
      /**
       * The expected run's planned rows (calendar intent) from the SAME
       * snapshot as the facts below: a fenced read must never re-read planned
       * rows in a second statement, whose window a restart/leave could open.
       */
      readonly plannedRows: ReadonlyArray<PlannedWorkout>;
      readonly facts: FollowThroughExecutionFacts;
    }
  | { readonly matched: false };

export interface FollowThroughExecutionFactsRepository {
  /** All three execution-fact sets of one run, read from ONE snapshot. */
  listFollowThroughExecutionFactsByEnrollment(
    enrollmentId: EnrollmentId,
  ): Promise<FollowThroughExecutionFacts>;

  /**
   * The fenced variant for a caller composing this read into an
   * already-loaded run (program detail): ONE statement anchors on
   * `program_enrollments` (verifying the expected id AND the trusted
   * `userId` / `programId` in the same predicate) and projects the facts from
   * that same snapshot, so the answer is exactly one of the two coherent
   * states - matched with that run's facts, or not matched.
   */
  findFencedFollowThroughExecutionFactsByEnrollment(
    expectedEnrollmentId: EnrollmentId,
    userId: UserId,
    programId: ProgramId,
  ): Promise<FencedFollowThroughExecutionFacts>;
}
