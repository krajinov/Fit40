import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

import { programEnrollments } from './enrollments';
import { exercises } from './exercises';
import { scheduledWorkouts, workouts } from './programs';
import { users } from './users';

/**
 * Workout session aggregate tables: sessions, exercise log snapshots, and
 * individual set logs.
 *
 * Every session is owned by exactly one user (`user_id`, NOT NULL): sessions
 * are user-owned training history, and per-user program progress is derived
 * from owned sessions. `enrollment_id` ties the session to the program
 * enrollment it counts toward; it is nullable because leaving a program
 * deletes the enrollment and detaches its sessions (SET NULL), keeping the
 * history while excluding it from every program's progress.
 *
 * `version` is an optimistic-concurrency token: `save` only applies when the
 * caller's snapshot matches the current row version, preventing stale aggregate
 * saves from silently overwriting concurrent changes.
 */
export const workoutSessions = pgTable(
  'workout_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    enrollmentId: text('enrollment_id').references(() => programEnrollments.id, {
      onDelete: 'set null',
    }),
    scheduledWorkoutId: text('scheduled_workout_id')
      .notNull()
      .references(() => scheduledWorkouts.id, { onDelete: 'restrict' }),
    workoutId: text('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'restrict' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    version: integer('version').notNull().default(0),
  },
  (table) => ({
    userIdIdx: index('workout_sessions_user_id_idx').on(table.userId),
    workoutIdIdx: index('workout_sessions_workout_id_idx').on(table.workoutId),
    // At most one session per enrollment per scheduled occurrence (the
    // previous global one-session-per-occurrence rule made a second user's
    // session for the same occurrence impossible). PostgreSQL treats NULL
    // enrollment ids as distinct, so detached historical sessions never
    // collide with a fresh enrollment's sessions after rejoining.
    enrollmentOccurrenceUnique: unique('workout_sessions_enrollment_occurrence_unique').on(
      table.enrollmentId,
      table.scheduledWorkoutId,
    ),
    // Enforces that a session's (scheduled_workout_id, workout_id) matches the
    // actual scheduled occurrence and its template, preventing a session from
    // being attributed to one occurrence while carrying another template's
    // identity. RESTRICT keeps historical sessions from being silently deleted.
    occurrenceTemplateFk: foreignKey({
      columns: [table.scheduledWorkoutId, table.workoutId],
      foreignColumns: [scheduledWorkouts.id, scheduledWorkouts.workoutId],
      name: 'workout_sessions_occurrence_template_fk',
    }).onDelete('restrict'),
  }),
);

/**
 * Self-contained historical snapshot of one exercise performed in a session.
 * The prescription (and rest period) are copied from the workout template at
 * session start, so the log remains meaningful if the template later changes.
 */
export const exerciseLogs = pgTable(
  'exercise_logs',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    exerciseOrder: integer('exercise_order').notNull(),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),
    prescriptionType: text('prescription_type').notNull(),
    sets: integer('sets').notNull(),
    minReps: integer('min_reps'),
    maxReps: integer('max_reps'),
    durationSeconds: integer('duration_seconds'),
    restSeconds: integer('rest_seconds').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sessionId, table.exerciseOrder] }),
    exerciseIdIdx: index('exercise_logs_exercise_id_idx').on(table.exerciseId),
    exerciseOrderCheck: check('exercise_logs_exercise_order_check', sql`${table.exerciseOrder} > 0`),
    setsCheck: check('exercise_logs_sets_check', sql`${table.sets} > 0`),
    minRepsCheck: check('exercise_logs_min_reps_check', sql`${table.minReps} > 0`),
    maxRepsCheck: check('exercise_logs_max_reps_check', sql`${table.maxReps} >= ${table.minReps}`),
    durationSecondsCheck: check('exercise_logs_duration_seconds_check', sql`${table.durationSeconds} > 0`),
    restSecondsCheck: check('exercise_logs_rest_seconds_check', sql`${table.restSeconds} >= 0`),
    prescriptionCheck: check(
      'exercise_logs_prescription_check',
      sql`(
        (${table.prescriptionType} = 'reps' AND ${table.minReps} IS NOT NULL AND ${table.maxReps} IS NOT NULL AND ${table.durationSeconds} IS NULL)
        OR
        (${table.prescriptionType} = 'duration' AND ${table.durationSeconds} IS NOT NULL AND ${table.minReps} IS NULL AND ${table.maxReps} IS NULL)
      )`,
    ),
  }),
);

export const setLogs = pgTable(
  'set_logs',
  {
    sessionId: text('session_id').notNull(),
    exerciseOrder: integer('exercise_order').notNull(),
    setNumber: integer('set_number').notNull(),
    type: text('type').notNull(),
    reps: integer('reps'),
    durationSeconds: integer('duration_seconds'),
    weightKg: numeric('weight_kg', { precision: 6, scale: 2, mode: 'number' }),
    rpe: integer('rpe'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sessionId, table.exerciseOrder, table.setNumber] }),
    logFk: foreignKey({
      columns: [table.sessionId, table.exerciseOrder],
      foreignColumns: [exerciseLogs.sessionId, exerciseLogs.exerciseOrder],
      name: 'set_logs_exercise_log_fk',
    }).onDelete('cascade'),
    setNumberCheck: check('set_logs_set_number_check', sql`${table.setNumber} > 0`),
    repsCheck: check('set_logs_reps_check', sql`${table.reps} > 0`),
    durationSecondsCheck: check('set_logs_duration_seconds_check', sql`${table.durationSeconds} > 0`),
    weightKgCheck: check('set_logs_weight_kg_check', sql`${table.weightKg} >= 0`),
    rpeCheck: check('set_logs_rpe_check', sql`${table.rpe} >= 1 AND ${table.rpe} <= 10`),
    typeCheck: check(
      'set_logs_type_check',
      sql`(
        (${table.type} = 'reps' AND ${table.reps} IS NOT NULL AND ${table.durationSeconds} IS NULL)
        OR
        (${table.type} = 'duration' AND ${table.durationSeconds} IS NOT NULL AND ${table.reps} IS NULL)
      )`,
    ),
  }),
);
