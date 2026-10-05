/**
 * Read-only port for one occurrence's execution facts (M17).
 *
 * The workout detail surface answers ONE question about ONE occurrence of ONE
 * run: what is its session state, and is it recorded as not performed? Those
 * two truths are mutually exclusive — a live session and a recorded fact can
 * never legitimately coexist — so they must come from ONE coherent database
 * snapshot. Two independent statements under READ COMMITTED can observe
 * different database instants while `recordNotPerformed` atomically replaces
 * an abandoned zero-set session with the fact (delete session + insert fact +
 * commit), manufacturing a pair the persisted state never held: the old
 * session beside the new fact (the UI renders a session that no longer
 * exists), or neither (the DTO says startable while the authoritative start
 * refuses with OCCURRENCE_RECORDED_NOT_PERFORMED). This port exists so the
 * read is one snapshot owned by Infrastructure — the Application layer never
 * assembles the pair from two independently mutable reads.
 *
 * **Reads only.** Every mutation of either fact is an enrollment-serialized
 * write owned by the separate `RunOccurrenceWriteRepository` authority; this
 * port declares no write method and never takes the enrollment write lock.
 *
 * The read contract:
 * - one snapshot: the session aggregate AND the settlement state describe the
 *   same database instant. Because the session aggregate spans multiple rows
 *   (session, exercise logs, set logs), the coherent read is ONE bounded,
 *   read-only REPEATABLE READ transaction — never a retry loop, never
 *   SERIALIZABLE, never a lock.
 * - enrollment- and occurrence-scoped: both halves answer for exactly one
 *   occurrence of exactly one run; another user's run and detached history
 *   are excluded structurally.
 * - factual: it projects `session | null` and the record's existence. It
 *   decides nothing — interpretation (which controls to show) stays with
 *   Application/Domain and presentation.
 */

import type { WorkoutSession } from '@/domain/entities/workout-session';
import type { EnrollmentId, ProgramId, ScheduledWorkoutId, UserId } from '@/domain/types/ids';

/** One occurrence's execution truth from one coherent database snapshot. */
export interface OccurrenceExecutionFacts {
  /** The run's session for this occurrence, or null when none exists. */
  readonly session: WorkoutSession | null;
  /** Whether this occurrence carries an explicit not-performed record. */
  readonly notPerformedRecorded: boolean;
}

/**
 * The FENCED projection: whether the caller's expected enrollment still exists
 * as the trusted (user, program) pair's run, and - only when it does - the
 * occurrence's execution facts of THAT run. `matched: false` (gone, replaced,
 * foreign) is never reported as matched: a preview composed into a parent view
 * of the old run must never be built from the replacement run's session state.
 */
export type FencedOccurrenceExecutionFacts =
  | { readonly matched: true; readonly facts: OccurrenceExecutionFacts }
  | { readonly matched: false };

export interface OccurrenceExecutionFactsRepository {
  /** Session state and settlement state of one occurrence, one snapshot. */
  findOccurrenceExecutionFacts(
    enrollmentId: EnrollmentId,
    scheduledWorkoutId: ScheduledWorkoutId,
  ): Promise<OccurrenceExecutionFacts>;

  /**
   * The fenced variant for a caller composing a preview/session read into an
   * already-loaded run (the dashboard's next-workout preview, program
   * detail): ONE snapshot establishes that the expected enrollment is still
   * this user's run of this program AND that occurrence's session/settlement
   * state, so the answer is exactly one of the two coherent states - matched
   * with that run's occurrence truth, or not matched - never the replacement
   * run's not-started state beside old-generation parent data.
   */
  findFencedOccurrenceExecutionFacts(
    expectedEnrollmentId: EnrollmentId,
    scheduledWorkoutId: ScheduledWorkoutId,
    userId: UserId,
    programId: ProgramId,
  ): Promise<FencedOccurrenceExecutionFacts>;
}
