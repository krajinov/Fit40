/**
 * PlannedWorkout repository port (M15 Slice 2).
 *
 * Persistence boundary for one run's calendar intent: at most one planned
 * workout per authored occurrence and per calendar date inside the current
 * enrollment (`program_enrollments` id). The enrollment IS the run — so a fresh
 * enrollment (a rejoin after leaving, or the replacement M14 restart creates)
 * starts with zero planning rows, and a deleted enrollment takes its planning
 * with it.
 *
 * ## Concurrency contract: parent-first locking
 *
 * The composite primary key and `planned_workouts_enrollment_date_unique` are
 * INVARIANTS and backstops. They are NOT the concurrency mechanism. Every
 * planning write serializes on the current enrollment row:
 *
 * ```sql
 * SELECT id FROM program_enrollments WHERE id = ? FOR NO KEY UPDATE
 * ```
 *
 * The parent row is always locked BEFORE any child row is touched. That order
 * is deliberate: M14's restart (`replaceExpectedWithNew`) and leave (`delete`)
 * remove the parent enrollment row and cascade to its children under the
 * strongest row lock, so M15's writes and the lifecycle writes contend on the
 * same row in the same order and can never form a lock cycle. A write whose
 * locking read finds zero rows means a lifecycle write won: it writes nothing
 * and returns `false`. A write that wins commits first and its rows are then
 * removed by the lifecycle cascade.
 *
 * `FOR NO KEY UPDATE` (rather than `FOR UPDATE`) keeps the lock compatible with
 * the `FOR KEY SHARE` a WorkoutSession INSERT takes on the same row for its
 * foreign-key check: recording a workout is never blocked by scheduling, and
 * scheduling waits are never extended by training.
 *
 * Consequences:
 * - Concurrent scheduling writes against the same run serialize, so the stored
 *   schedule is always exactly one complete replacement set — never a union of
 *   two, never a partial state — and a concurrent regeneration cannot lose rows
 *   to a stale delete-then-insert window.
 * - A regeneration and a reschedule against the same run are last-writer-wins
 *   on the affected rows; no write can ever land in another run.
 * - Unique-constraint violations stay bugs, not race outcomes: with the parent
 *   lock held and a valid input set they cannot fire. The single exception is
 *   `reschedule` targeting a date another planned workout of the run already
 *   holds, which is a genuine business conflict translated to
 *   {@link PlannedDateConflictError}.
 */

import type { PlannedWorkout } from '@/domain/entities/planned-workout';
import type { EnrollmentId, ScheduledWorkoutId } from '@/domain/types/ids';
import type { PlannedDate } from '@/domain/value-objects/planned-date';

/**
 * Thrown by `reschedule` when a unique violation names exactly
 * `planned_workouts_enrollment_date_unique`: another planned workout of the
 * same run already holds the target calendar date. This is the one expected
 * (business) database conflict of this port.
 */
export class PlannedDateConflictError extends Error {
  constructor(
    readonly enrollmentId: string,
    readonly plannedDate: string,
  ) {
    super(
      `Planned date "${plannedDate}" is already taken for enrollment "${enrollmentId}"`,
    );
    this.name = 'PlannedDateConflictError';
  }
}

/**
 * Thrown by `replaceAllForEnrollment` when a supplied row belongs to a
 * different enrollment than the one being replaced. This is a
 * persistence-backstop invariant, never a business outcome: the replacement
 * set is built for one run, so a foreign row means the caller is about to leak
 * planning across runs. It is thrown BEFORE any mutation and is never
 * translated by callers (it propagates as an unexpected error).
 */
export class PlannedWorkoutEnrollmentMismatchError extends Error {
  constructor(
    readonly enrollmentId: string,
    readonly offendingScheduledWorkoutId: string,
  ) {
    super(
      `Planned workout for scheduled workout "${offendingScheduledWorkoutId}" does not belong to enrollment "${enrollmentId}"`,
    );
    this.name = 'PlannedWorkoutEnrollmentMismatchError';
  }
}

/**
 * Thrown by `replaceAllForEnrollment` when the supplied set itself violates a
 * store invariant — the same occurrence twice, or two occurrences on one
 * calendar date. Like the enrollment identity guard, this is a
 * persistence-backstop invariant rather than a business outcome: it is thrown
 * before any mutation (so nothing is destroyed) and is never translated.
 */
export class PlannedWorkoutSetConflictError extends Error {
  constructor(
    readonly enrollmentId: string,
    reason: string,
  ) {
    super(`Invalid planned workout replacement set for enrollment "${enrollmentId}": ${reason}`);
    this.name = 'PlannedWorkoutSetConflictError';
  }
}

/**
 * The shared invariant gate both implementations apply to a replacement set
 * BEFORE mutating anything:
 *
 * - every row must belong to `enrollmentId` (no cross-run leakage);
 * - no two rows may share a scheduled occurrence;
 * - no two rows may share a calendar date.
 *
 * It lives beside the contract because it IS part of the contract: both
 * adapters must enforce exactly this, and a divergence between them would be a
 * bug. It throws the port's invariant errors, which callers never translate.
 */
export function assertReplaceablePlannedWorkoutSet(
  enrollmentId: EnrollmentId,
  planned: ReadonlyArray<PlannedWorkout>,
): void {
  const occurrences = new Set<string>();
  const dates = new Set<string>();

  for (const row of planned) {
    if (row.enrollmentId !== enrollmentId) {
      throw new PlannedWorkoutEnrollmentMismatchError(enrollmentId, row.scheduledWorkoutId);
    }
    if (occurrences.has(row.scheduledWorkoutId)) {
      throw new PlannedWorkoutSetConflictError(
        enrollmentId,
        `scheduled workout "${row.scheduledWorkoutId}" appears twice`,
      );
    }
    if (dates.has(row.plannedDate)) {
      throw new PlannedWorkoutSetConflictError(
        enrollmentId,
        `planned date "${row.plannedDate}" is used twice`,
      );
    }

    occurrences.add(row.scheduledWorkoutId);
    dates.add(row.plannedDate);
  }
}

export interface PlannedWorkoutRepository {
  /**
   * Returns every planned workout of the run, ordered deterministically by
   * `planned_date` ascending and then `scheduled_workout_id` ascending.
   *
   * Contract:
   * - Enrollment-scoped: rows of other runs (including other users' runs) can
   *   never match an enrollment id, and a detached-then-replaced run is a
   *   different id, so planning never leaks across runs.
   * - An enrollment with no planning rows returns `[]` — absence is a normal
   *   state (a fresh run, or a pre-M15 enrollment that never configured days),
   *   not an error.
   * - Deterministic order comes from the query, never from implicit database
   *   order; the date unique constraint makes ties impossible, and the id
   *   tie-break keeps the order total even for corrupt data.
   * - One bounded statement regardless of how many rows the run holds.
   * - Persisted rows are reconstructed through the domain factory and date
   *   value object, so a corrupt row fails loudly instead of being silently
   *   normalized.
   */
  listByEnrollment(enrollmentId: EnrollmentId): Promise<ReadonlyArray<PlannedWorkout>>;

  /**
   * Atomically replaces the run's ENTIRE planning with `planned`, in one
   * transaction that locks the enrollment row first (see the concurrency
   * contract above).
   *
   * Contract:
   * - Returns `true` once the replacement committed: every previous row of the
   *   run is gone and the supplied set is the run's complete schedule.
   * - Returns `false` when the enrollment row no longer exists — a concurrent
   *   leave or M14 restart won. Nothing is written in that case, and the fresh
   *   enrollment of a restart is never touched.
   * - An empty set is valid and means "the run currently has no planned
   *   workouts": the existing rows are deleted and nothing is inserted.
   * - Every supplied row must belong to `enrollmentId`; otherwise
   *   {@link PlannedWorkoutEnrollmentMismatchError} is thrown before any
   *   mutation. Cross-run rows can never be written by this method.
   * - The supplied set itself must hold at most one row per occurrence and per
   *   calendar date; otherwise {@link PlannedWorkoutSetConflictError} is thrown
   *   before any mutation.
   * - Neither of those invariant errors is translated into a business outcome.
   *   With the enrollment lock held and a valid set, unique-constraint
   *   violations cannot occur, so they are never mapped to
   *   {@link PlannedDateConflictError}.
   */
  replaceAllForEnrollment(
    enrollmentId: EnrollmentId,
    planned: ReadonlyArray<PlannedWorkout>,
  ): Promise<boolean>;

  /**
   * Moves one planned workout of the run to `plannedDate`, in one transaction
   * that locks the enrollment row first (see the concurrency contract above).
   *
   * Contract:
   * - Returns `true` when the row was updated.
   * - Returns `false` — writing nothing — when the enrollment row no longer
   *   exists (a concurrent leave/restart won) or when the occurrence has no
   *   planned row in this run (never planned, or removed by a regeneration
   *   that completed it). Callers resolve that ambiguity from current state
   *   with a single read-only re-check.
   * - Throws {@link PlannedDateConflictError} when another planned workout of
   *   the same run already holds the target date: exactly one planned workout
   *   per calendar date is a business rule, and the database constraint naming
   *   `planned_workouts_enrollment_date_unique` is its final authority.
   * - No retry loop and no second write: one locking read and one UPDATE.
   */
  reschedule(
    enrollmentId: EnrollmentId,
    scheduledWorkoutId: ScheduledWorkoutId,
    plannedDate: PlannedDate,
  ): Promise<boolean>;
}
