import { date, index, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core';

import { programEnrollments } from './enrollments';
import { scheduledWorkouts } from './programs';

/**
 * Planned workouts: one row per authored program occurrence the user INTENDS
 * to perform, dated on the calendar, scoped to the current enrollment/run.
 *
 * M15 calendar intent, deliberately separate from authored program structure
 * (`scheduled_workouts`) and from execution truth (`workout_sessions`):
 * rescheduling a row here can never complete a workout, change training
 * history, or advance progression. Progress and completion keep reading
 * completed sessions only.
 *
 * Identity is the natural pair `(enrollment_id, scheduled_workout_id)`: the
 * authored occurrence inside one run. There is no surrogate id, because
 * nothing references a planned row by identity — actions address the occurrence
 * through its authored coordinates and the server resolves the run.
 *
 * `planned_date` is a PostgreSQL DATE carried as a `YYYY-MM-DD` string
 * (`mode: 'string'`), so the value never round-trips through JavaScript's
 * local-time `Date` semantics: it is a zoneless calendar day, exactly the
 * domain `PlannedDate`.
 *
 * Foreign key policy:
 * - enrollment CASCADE: a run's planning dies with the run. Leaving a program
 *   deletes the enrollment, and M14's restart deletes the old enrollment inside
 *   its single replacement transaction — both take their planned rows with them
 *   in the same database action, so a fresh enrollment can never inherit stale
 *   planning.
 * - scheduled workout RESTRICT: authored program occurrences are seeded
 *   reference data and must not silently destroy a user's planning.
 *
 * Invariants (both are database-enforced, and neither is a concurrency
 * mechanism — writes serialize on the parent enrollment row with
 * `FOR NO KEY UPDATE`):
 * - the primary key allows at most one planned workout per occurrence per run;
 * - `planned_workouts_enrollment_date_unique` allows at most one planned
 *   workout per calendar date per run, because a training day holds one
 *   workout.
 *
 * A standalone `scheduled_workout_id` index is required for the same reason as
 * `workout_sessions_scheduled_workout_id_idx`: the primary key leads with
 * `enrollment_id`, so it cannot serve a `scheduled_workout_id`-only predicate
 * or the FK RESTRICT check PostgreSQL runs when a scheduled workout row is
 * deleted.
 */
export const plannedWorkouts = pgTable(
  'planned_workouts',
  {
    enrollmentId: text('enrollment_id')
      .notNull()
      .references(() => programEnrollments.id, { onDelete: 'cascade' }),
    scheduledWorkoutId: text('scheduled_workout_id')
      .notNull()
      .references(() => scheduledWorkouts.id, { onDelete: 'restrict' }),
    plannedDate: date('planned_date', { mode: 'string' }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.enrollmentId, table.scheduledWorkoutId] }),
    enrollmentDateUnique: unique('planned_workouts_enrollment_date_unique').on(
      table.enrollmentId,
      table.plannedDate,
    ),
    scheduledWorkoutIdIdx: index('planned_workouts_scheduled_workout_id_idx').on(
      table.scheduledWorkoutId,
    ),
  }),
);
