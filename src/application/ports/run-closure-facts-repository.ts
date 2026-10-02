/**
 * Read-only port for a run's closure-facts projection (M17).
 *
 * A run-closure summary is derived from TWO execution facts of the same run:
 * the completed authored occurrences (M14, `workout_sessions`) and the
 * explicit not-performed records (M17, `not_performed_workouts`). Both sets
 * describe the SAME run state, so they must come from ONE coherent database
 * snapshot: two independent statements under PostgreSQL READ COMMITTED can
 * observe different database instants and manufacture a contradiction (one
 * authored occurrence in BOTH sets) that the persisted state never held,
 * failing `resolveRunClosure` for a run that is actually valid. This port
 * exists so the projection is a single snapshot read owned by the closure
 * read — the Application layer never assembles the facts from two
 * independently mutable reads.
 *
 * **Reads only.** Every mutation of either fact is an enrollment-serialized
 * write owned by the separate `RunOccurrenceWriteRepository` authority. This
 * port deliberately declares no write method: a read model must not be able
 * to change the facts it reports.
 *
 * The read contract:
 * - one snapshot: ONE SQL statement returning both fact sets, so the two
 *   sets can never be torn across a concurrent settlement transition
 *   (a legitimate `undo → start → complete` in flight produces exactly one
 *   of the two valid states, never a mix).
 * - enrollment-scoped: the only key is the run's `EnrollmentId`; an
 *   occurrence id alone can never identify a run, and detached (leave /
 *   restart) history is excluded structurally.
 * - bounded: no session hydration, no planned-row read, no catalog query,
 *   and no lock — a read-only projection never serializes behind the
 *   enrollment write lock.
 * - deterministic: each set is ordered by `scheduled_workout_id`, never by
 *   implicit database order.
 *
 * It decides nothing: it projects facts only. Contradiction detection,
 * conclusion, counts and authored order stay with the Domain's
 * `resolveRunClosure`, which the returned shape feeds directly.
 */

import type { RunClosureFacts } from '@/domain/services/run-closure';
import type { EnrollmentId } from '@/domain/types/ids';

export interface RunClosureFactsRepository {
  /** Both execution-fact sets of one run, read from ONE database snapshot. */
  listClosureFactsByEnrollment(enrollmentId: EnrollmentId): Promise<RunClosureFacts>;
}
