import { createPlannedWorkout, type PlannedWorkout } from '@/domain/entities/planned-workout';
import { createPlannedDate } from '@/domain/value-objects/planned-date';

import type { plannedWorkouts } from '../schema/planned-workouts';

type PlannedWorkoutRow = typeof plannedWorkouts.$inferSelect;

/**
 * Reconstructs a domain PlannedWorkout from a persisted row.
 *
 * `planned_date` is a `date` column in string mode, so the row value is
 * already the canonical `YYYY-MM-DD` string and never passes through
 * JavaScript's local-time `Date` semantics. It is still validated through the
 * date value object and the entity factory: the database is trusted
 * structurally, so a row that cannot satisfy the domain invariants (a
 * malformed or impossible date, an empty id) indicates corruption and must
 * fail loudly rather than be silently normalized.
 */
export function mapRowToPlannedWorkout(row: PlannedWorkoutRow): PlannedWorkout {
  const rowLabel = `planned_workouts row "${row.enrollmentId}/${row.scheduledWorkoutId}"`;

  const plannedDate = createPlannedDate(row.plannedDate);
  if (!plannedDate.ok) {
    throw new Error(`Corrupt data in ${rowLabel}: ${plannedDate.error.message}`);
  }

  const result = createPlannedWorkout({
    enrollmentId: row.enrollmentId,
    scheduledWorkoutId: row.scheduledWorkoutId,
    plannedDate: plannedDate.data,
  });
  if (!result.ok) {
    throw new Error(`Corrupt data in ${rowLabel}: ${result.error.message}`);
  }

  return result.data;
}

/**
 * Maps a domain PlannedWorkout to its persistable row shape.
 *
 * The value object's canonical string IS the column value: the mapping is
 * identity, which is what keeps a calendar date from drifting across a
 * timezone boundary on the way to or from the database.
 */
export function mapPlannedWorkoutToRow(
  plannedWorkout: PlannedWorkout,
): typeof plannedWorkouts.$inferInsert {
  return {
    enrollmentId: plannedWorkout.enrollmentId,
    scheduledWorkoutId: plannedWorkout.scheduledWorkoutId,
    plannedDate: plannedWorkout.plannedDate,
  };
}
