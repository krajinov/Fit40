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
import type { EnrollmentId, ScheduledWorkoutId } from '@/domain/types/ids';

/** One occurrence's execution truth from one coherent database snapshot. */
export interface OccurrenceExecutionFacts {
  /** The run's session for this occurrence, or null when none exists. */
  readonly session: WorkoutSession | null;
  /** Whether this occurrence carries an explicit not-performed record. */
  readonly notPerformedRecorded: boolean;
}

export interface OccurrenceExecutionFactsRepository {
  /** Session state and settlement state of one occurrence, one snapshot. */
  findOccurrenceExecutionFacts(
    enrollmentId: EnrollmentId,
    scheduledWorkoutId: ScheduledWorkoutId,
  ): Promise<OccurrenceExecutionFacts>;
}
