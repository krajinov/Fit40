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
} from 'drizzle-orm/pg-core';

import { exercises } from './exercises';
import { scheduledWorkouts, workouts } from './programs';

/**
 * Workout session aggregate tables: sessions, exercise log snapshots, and
 * individual set logs.
 *
 * `version` is an optimistic-concurrency token: `save` only applies when the
 * caller's snapshot matches the current row version, preventing stale aggregate
 * saves from silently overwriting concurrent changes.
 */
export const workoutSessions = pgTable(
  'workout_sessions',
  {
    id: text('id').primaryKey(),
    scheduledWorkoutId: text('scheduled_workout_id')
      .notNull()
      .unique()
      .references(() => scheduledWorkouts.id, { onDelete: 'restrict' }),
    workoutId: text('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'restrict' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    version: integer('version').notNull().default(0),
  },
  (table) => ({
    workoutIdIdx: index('workout_sessions_workout_id_idx').on(table.workoutId),
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
