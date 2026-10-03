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
import type { EnrollmentId, ScheduledWorkoutId } from '@/domain/types/ids';
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

export interface FollowThroughExecutionFactsRepository {
  /** All three execution-fact sets of one run, read from ONE snapshot. */
  listFollowThroughExecutionFactsByEnrollment(
    enrollmentId: EnrollmentId,
  ): Promise<FollowThroughExecutionFacts>;
}
