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
import type { EnrollmentId, ProgramId, UserId } from '@/domain/types/ids';

/**
 * The FENCED projection: whether the caller's expected enrollment still exists
 * as the trusted (user, program) pair's run, and — only when it does — that
 * run's execution facts.
 *
 * `matched: false` means the expected enrollment is gone, replaced, or does not
 * belong to the trusted pair. It is NEVER reported as `matched: true` with
 * empty fact sets: that shape is how a vanished run used to be misread as a
 * fresh, fully-open one.
 */
export type FencedRunClosureFacts =
  | { readonly matched: true; readonly facts: RunClosureFacts }
  | { readonly matched: false };

export interface RunClosureFactsRepository {
  /** Both execution-fact sets of one run, read from ONE database snapshot. */
  listClosureFactsByEnrollment(enrollmentId: EnrollmentId): Promise<RunClosureFacts>;

  /**
   * The fenced variant: the caller already loaded a specific enrollment and is
   * composing this summary into that run's view, so identity and facts must be
   * established from ONE coherent snapshot.
   *
   * Validating the expected enrollment with a read and THEN reading its facts
   * is two statements, and a restart/leave committing between them makes the
   * second observe a run that no longer exists — empty facts for the vanished
   * id, which the summary would render as an open run with the OLD authored
   * structure. ONE statement removes that window: it anchors on
   * `program_enrollments` (verifying the id AND the trusted `userId` /
   * `programId` in the same predicate) and projects the facts from that same
   * snapshot, so the answer is exactly one of the two coherent states.
   *
   * `expectedEnrollmentId` is data for composition, never client-substitutable
   * authority: unauthorized ids resolve `matched: false` rather than another
   * user's facts.
   */
  findFencedClosureFactsByEnrollment(
    expectedEnrollmentId: EnrollmentId,
    userId: UserId,
    programId: ProgramId,
  ): Promise<FencedRunClosureFacts>;
}
