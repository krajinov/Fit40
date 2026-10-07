import { and, asc, eq } from 'drizzle-orm';

import {
  assertReplaceablePlannedWorkoutSet,
  PlannedDateConflictError,
  type PlannedWorkoutRepository,
} from '@/application/ports/planned-workout-repository';
import type { PlannedWorkout } from '@/domain/entities/planned-workout';
import type { EnrollmentId, ScheduledWorkoutId } from '@/domain/types/ids';
import type { PlannedDate } from '@/domain/value-objects/planned-date';

import type { Database } from '../client';
import {
  mapPlannedWorkoutToRow,
  mapRowToPlannedWorkout,
} from '../mappers/planned-workout-mapper';
import { isUniqueViolation, pgConstraintName } from '../pg-error';
import { plannedWorkouts, programEnrollments } from '../schema';

/**
 * The (enrollment_id, planned_date) unique constraint created by migration
 * 0013. A unique violation is translated to PlannedDateConflictError ONLY when
 * it names exactly this constraint, so a primary-key collision or any unrelated
 * unique violation can never masquerade as an occupied calendar date.
 */
const ENROLLMENT_DATE_UNIQUE_CONSTRAINT = 'planned_workouts_enrollment_date_unique';

/**
 * Drizzle implementation of the PlannedWorkoutRepository port.
 *
 * Every write runs in ONE transaction that locks the parent enrollment row
 * with `FOR NO KEY UPDATE` BEFORE touching any planned row (see the port's
 * concurrency contract). That lock is what makes two concurrent scheduling
 * writes serialize into one complete schedule each, and what makes a lifecycle
 * write (M14's restart delete-and-replace, or leave) and a scheduling write
 * contend on the same row in the same parent-first order.
 *
 * The unique constraints are invariants, not the concurrency mechanism: with
 * the enrollment lock held and a validated input set they cannot fire, so they
 * are never translated into a business race outcome.
 */
export class DrizzlePlannedWorkoutRepository implements PlannedWorkoutRepository {
  constructor(private readonly db: Database) {}

  async listByEnrollment(enrollmentId: EnrollmentId): Promise<ReadonlyArray<PlannedWorkout>> {
    // One statement; deterministic order comes from the query (never from
    // implicit database order). The date unique constraint makes ties
    // impossible, and the id tie-break keeps the order total regardless.
    const rows = await this.db
      .select()
      .from(plannedWorkouts)
      .where(eq(plannedWorkouts.enrollmentId, enrollmentId))
      .orderBy(asc(plannedWorkouts.plannedDate), asc(plannedWorkouts.scheduledWorkoutId));

    return rows.map(mapRowToPlannedWorkout);
  }

  async replaceAllForEnrollment(
    enrollmentId: EnrollmentId,
    planned: ReadonlyArray<PlannedWorkout>,
  ): Promise<boolean> {
    // Invariants first, before the transaction opens: an invalid set must fail
    // loudly WITHOUT destroying the run's current planning.
    assertReplaceablePlannedWorkoutSet(enrollmentId, planned);

    return this.db.transaction(async (tx) => {
      // Parent-first lock. The enrollment row is the run's identity and the
      // only serialization point for planning writes; M14 restart/leave take
      // the same row lock first, so the orders match and no cycle is possible.
      const locked = await tx
        .select({ id: programEnrollments.id })
        .from(programEnrollments)
        .where(eq(programEnrollments.id, enrollmentId))
        .for('no key update');

      if (locked.length === 0) {
        // A concurrent leave/restart removed the run. Write nothing: the
        // replacement enrollment of a restart has its own id and must never
        // receive the old run's planning.
        return false;
      }

      await tx.delete(plannedWorkouts).where(eq(plannedWorkouts.enrollmentId, enrollmentId));

      if (planned.length > 0) {
        await tx
          .insert(plannedWorkouts)
          .values(planned.map((plannedWorkout) => mapPlannedWorkoutToRow(plannedWorkout)));
      }

      return true;
    });
  }

  async reschedule(
    enrollmentId: EnrollmentId,
    scheduledWorkoutId: ScheduledWorkoutId,
    plannedDate: PlannedDate,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: programEnrollments.id })
        .from(programEnrollments)
        .where(eq(programEnrollments.id, enrollmentId))
        .for('no key update');

      if (locked.length === 0) {
        // The run is gone (concurrent leave/restart): nothing to move.
        return false;
      }

      try {
        const updated = await tx
          .update(plannedWorkouts)
          .set({ plannedDate })
          .where(
            and(
              eq(plannedWorkouts.enrollmentId, enrollmentId),
              eq(plannedWorkouts.scheduledWorkoutId, scheduledWorkoutId),
            ),
          )
          .returning({ enrollmentId: plannedWorkouts.enrollmentId });

        // No row means this run has no planning for that occurrence (never
        // planned, or removed by a regeneration that completed it). No retry.
        return updated.length > 0;
      } catch (error) {
        if (
          isUniqueViolation(error) &&
          pgConstraintName(error) === ENROLLMENT_DATE_UNIQUE_CONSTRAINT
        ) {
          // The one expected conflict: another planned workout of this run
          // already holds the target date.
          throw new PlannedDateConflictError(enrollmentId, plannedDate);
        }
        throw error;
      }
    });
  }
}
