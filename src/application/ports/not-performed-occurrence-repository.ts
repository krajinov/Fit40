/**
 * Read-only port for a run's recorded-not-performed execution facts (M17).
 *
 * A `NotPerformedOccurrence` is an explicit execution fact: the user recorded
 * that one authored occurrence of one enrollment/run was not performed. It is
 * never derived from a planned date, a past-due status, the absence of a
 * session or a schedule regeneration.
 *
 * **Reads only.** Every mutation of this fact — recording it and undoing it —
 * is a multi-table, enrollment-serialized write owned by the separate
 * `RunOccurrenceWriteRepository` (a later M17 slice). This port deliberately
 * declares no write method and no future mutation method: a read model must not
 * be able to change the fact it reports, and adding a write here would create a
 * second mutation authority beside the enrollment-lock discipline.
 *
 * The read contract:
 * - enrollment-scoped: the only key is the run's `EnrollmentId`. The caller
 *   resolves the run from the trusted user plus the program, so one user can
 *   never read another user's run and an occurrence id alone is never accepted
 *   (authored occurrence ids are shared by every run of a program, so they
 *   cannot identify a run).
 * - bounded: exactly ONE statement, no joins — not to `workout_sessions`, not
 *   to `planned_workouts`, not to the program catalog. Recording intent does not
 *   require a calendar row, so a fact whose planned row no longer exists is
 *   still reported.
 * - deterministic: ordered by `scheduled_workout_id` (the natural key's second
 *   column), never by implicit database order.
 * - loud: a persisted row that cannot satisfy the domain invariants throws
 *   rather than being normalized or skipped.
 */

import type { NotPerformedOccurrence } from '@/domain/entities/not-performed-occurrence';
import type { EnrollmentId } from '@/domain/types/ids';

export interface NotPerformedOccurrenceRepository {
  /** Every fact recorded for one run, deterministically ordered. */
  listByEnrollment(enrollmentId: EnrollmentId): Promise<ReadonlyArray<NotPerformedOccurrence>>;
}