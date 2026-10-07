import { index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { programEnrollments } from './enrollments';
import { scheduledWorkouts } from './programs';

/**
 * Not-performed workouts: one row per authored program occurrence the user
 * EXPLICITLY recorded as not performed, scoped to one enrollment/run (M17).
 *
 * Run-scoped execution truth. It is deliberately NOT:
 * - calendar intent (`planned_workouts`): a fact neither needs nor changes a
 *   planned row, and it outlives that row being regenerated away;
 * - session history (`workout_sessions`): recording creates, completes and
 *   deletes nothing — no session is written, attributed or closed by it;
 * - user-global training history: the fact belongs to one run, and the
 *   enrollment-scoped reads keep it out of `/history`, progression, personal
 *   records and insights, which keep reading completed sessions only;
 * - program lifecycle history: restarting a run deletes the old enrollment and
 *   takes these facts with it. There is no detach-on-restart for facts (unlike
 *   sessions, which detach and survive) and no archive table.
 *
 * Identity is the natural pair `(enrollment_id, scheduled_workout_id)`, exactly
 * like `planned_workouts`: the authored occurrence inside one run. There is no
 * surrogate id, because nothing references a fact by identity — actions address
 * the occurrence through its authored coordinates and the server resolves the
 * run.
 *
 * `recorded_at` is the instant the user recorded the fact (a caller-supplied
 * clock, `timestamptz`, always UTC). It is NOT the planned workout date and NOT
 * a synthetic "missed" date: the planned date lives in `planned_workouts` and
 * may not exist at all.
 *
 * Foreign key policy:
 * - enrollment CASCADE: the fact dies with the run. Leaving a program deletes
 *   the enrollment, and M14's restart deletes the old enrollment inside its
 *   single replacement transaction — both remove these facts in the same
 *   database action, so a fresh enrollment can never inherit the old run's
 *   settlements.
 * - scheduled workout RESTRICT: authored program occurrences are seeded
 *   reference data and must not silently destroy a user's recorded facts.
 * - **No foreign key to `workout_sessions`.** A fact is independent of session
 *   existence: recording deletes a zero-set abandoned session, and a later
 *   session lifecycle change (or a session detaching on restart) must never
 *   null out or delete the fact. A session FK could only block that or corrupt
 *   the fact, so the column set deliberately stops at the two FKs above.
 *
 * The composite primary key is the I1 invariant — at most one settlement per
 * occurrence per run — and is enforced by the database, not by application
 * coordination. It is NOT the concurrency mechanism: writes serialize on the
 * parent enrollment row (`FOR NO KEY UPDATE`).
 *
 * A standalone `scheduled_workout_id` index is required for the same reason as
 * `planned_workouts_scheduled_workout_id_idx` and
 * `workout_sessions_scheduled_workout_id_idx`: the primary key leads with
 * `enrollment_id`, so it cannot serve a `scheduled_workout_id`-only predicate
 * or the FK RESTRICT check PostgreSQL runs when a scheduled workout row is
 * deleted.
 *
 * Deliberately absent columns (each would create a second truth or a
 * non-fact): user_id (the enrollment carries the owner), planned_date, session
 * id, reason, note, status, source, kind, concluded_at, any lifecycle/undo flag
 * (undo is a row DELETE, never a mutation), and any timestamp other than
 * `recorded_at`.
 */
export const notPerformedWorkouts = pgTable(
  'not_performed_workouts',
  {
    enrollmentId: text('enrollment_id')
      .notNull()
      .references(() => programEnrollments.id, { onDelete: 'cascade' }),
    scheduledWorkoutId: text('scheduled_workout_id')
      .notNull()
      .references(() => scheduledWorkouts.id, { onDelete: 'restrict' }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.enrollmentId, table.scheduledWorkoutId] }),
    scheduledWorkoutIdIdx: index('not_performed_workouts_scheduled_workout_id_idx').on(
      table.scheduledWorkoutId,
    ),
  }),
);