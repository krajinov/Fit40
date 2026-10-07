/**
 * In-memory implementation of the PlannedWorkoutRepository port.
 *
 * Stores each run's planning in a private Map keyed by enrollment, cloned on
 * every read and write so callers can never mutate stored state. Ordering
 * mirrors the Drizzle read exactly (planned_date ascending, then
 * scheduled_workout_id ascending).
 *
 * Persistence limitations (as every InMemory adapter in this repository):
 * - state resets when the Node process restarts, and HMR may reset module
 *   state during development;
 * - it deliberately does NOT model cross-repository foreign-key behavior.
 *
 * Consequence for this port: the fake has no way to observe whether an
 * enrollment exists — that knowledge lives in `program_enrollments`, another
 * repository's aggregate, and modelling it here would couple the fakes. So the
 * enrollment-missing outcomes (`replaceAllForEnrollment` returning false for a
 * vanished run, and the same possibility for `reschedule`) are NOT reproduced;
 * the fake always reports the write it performed. PostgreSQL integration tests
 * are the authority for those lifecycle outcomes, exactly as they are for the
 * enrollment fake's ON DELETE SET NULL boundary.
 *
 * Every other port guarantee IS reproduced single-threadedly: input validation
 * before mutation, whole-set replacement, one occurrence and one date per run,
 * deterministic ordering, `false` for a missing planned row, and
 * PlannedDateConflictError for an occupied date.
 */

import {
  assertReplaceablePlannedWorkoutSet,
  PlannedDateConflictError,
  type PlannedWorkoutRepository,
} from '@/application/ports/planned-workout-repository';
import {
  reschedulePlannedWorkout,
  type PlannedWorkout,
} from '@/domain/entities/planned-workout';
import type { EnrollmentId, ScheduledWorkoutId } from '@/domain/types/ids';
import { comparePlannedDates, type PlannedDate } from '@/domain/value-objects/planned-date';

export class InMemoryPlannedWorkoutRepository implements PlannedWorkoutRepository {
  /** enrollment id → scheduled workout id → planned workout. */
  private readonly plannedByEnrollment = new Map<string, Map<string, PlannedWorkout>>();

  async listByEnrollment(enrollmentId: EnrollmentId): Promise<ReadonlyArray<PlannedWorkout>> {
    const rows = this.plannedByEnrollment.get(enrollmentId);
    if (rows === undefined) {
      return [];
    }

    return [...rows.values()].sort(comparePlannedWorkouts).map((row) => structuredClone(row));
  }

  async replaceAllForEnrollment(
    enrollmentId: EnrollmentId,
    planned: ReadonlyArray<PlannedWorkout>,
  ): Promise<boolean> {
    // Invariants before mutation, exactly as the Drizzle adapter: an invalid
    // set must fail loudly without destroying the run's current planning.
    assertReplaceablePlannedWorkoutSet(enrollmentId, planned);

    const replacement = new Map<string, PlannedWorkout>();
    for (const row of planned) {
      replacement.set(row.scheduledWorkoutId, structuredClone(row));
    }
    this.plannedByEnrollment.set(enrollmentId, replacement);

    // The enrollment the caller addressed is assumed to exist: this fake never
    // models the enrollment aggregate's rows (see the class note).
    return true;
  }

  async reschedule(
    enrollmentId: EnrollmentId,
    scheduledWorkoutId: ScheduledWorkoutId,
    plannedDate: PlannedDate,
  ): Promise<boolean> {
    const rows = this.plannedByEnrollment.get(enrollmentId);
    const existing = rows?.get(scheduledWorkoutId);
    if (rows === undefined || existing === undefined) {
      return false;
    }

    // One planned workout per calendar date per run: the date unique
    // constraint's rule, enforced here because the fake has no database.
    const occupied = [...rows.values()].some(
      (row) => row.scheduledWorkoutId !== scheduledWorkoutId && row.plannedDate === plannedDate,
    );
    if (occupied) {
      throw new PlannedDateConflictError(enrollmentId, plannedDate);
    }

    rows.set(scheduledWorkoutId, structuredClone(reschedulePlannedWorkout(existing, plannedDate)));
    return true;
  }
}

/** The Drizzle read's ORDER BY: planned_date ascending, then occurrence id. */
function comparePlannedWorkouts(a: PlannedWorkout, b: PlannedWorkout): number {
  const byDate = comparePlannedDates(a.plannedDate, b.plannedDate);
  if (byDate !== 0) {
    return byDate;
  }
  if (a.scheduledWorkoutId === b.scheduledWorkoutId) {
    return 0;
  }
  return a.scheduledWorkoutId < b.scheduledWorkoutId ? -1 : 1;
}
