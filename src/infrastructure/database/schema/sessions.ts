import { check, integer, numeric, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { scheduledWorkouts, workouts } from './programs';

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
  },
  (table) => [check('chk_workout_sessions_started_at', sql`${table.startedAt} IS NOT NULL`)],
);

export const exerciseLogs = pgTable(
  'exercise_logs',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    exerciseOrder: integer('exercise_order').notNull(),
    exerciseId: text('exercise_id').notNull(),
    prescriptionType: text('prescription_type').notNull(),
    sets: integer('sets').notNull(),
    minReps: integer('min_reps'),
    maxReps: integer('max_reps'),
    durationSeconds: integer('duration_seconds'),
    restSeconds: integer('rest_seconds').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.exerciseOrder], name: 'exercise_logs_pkey' }),
    check('chk_exercise_logs_exercise_order', sql`${table.exerciseOrder} > 0`),
    check('chk_exercise_logs_sets', sql`${table.sets} > 0`),
    check(
      'chk_exercise_logs_prescription',
      sql`
        (
          ${table.prescriptionType} = 'reps'
          AND ${table.minReps} IS NOT NULL
          AND ${table.maxReps} IS NOT NULL
          AND ${table.durationSeconds} IS NULL
        )
        OR
        (
          ${table.prescriptionType} = 'duration'
          AND ${table.durationSeconds} IS NOT NULL
          AND ${table.minReps} IS NULL
          AND ${table.maxReps} IS NULL
        )
      `,
    ),
  ],
);

export const setLogs = pgTable(
  'set_logs',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    exerciseOrder: integer('exercise_order').notNull(),
    setNumber: integer('set_number').notNull(),
    type: text('type').notNull(),
    reps: integer('reps'),
    durationSeconds: integer('duration_seconds'),
    weightKg: numeric('weight_kg', { precision: 6, scale: 2 }),
    rpe: integer('rpe'),
  },
  (table) => [
    primaryKey(
      { columns: [table.sessionId, table.exerciseOrder, table.setNumber], name: 'set_logs_pkey' },
    ),
    check('chk_set_logs_set_number', sql`${table.setNumber} > 0`),
    check(
      'chk_set_logs_type',
      sql`
        (
          ${table.type} = 'reps'
          AND ${table.reps} IS NOT NULL
          AND ${table.durationSeconds} IS NULL
        )
        OR
        (
          ${table.type} = 'duration'
          AND ${table.durationSeconds} IS NOT NULL
          AND ${table.reps} IS NULL
        )
      `,
    ),
    check('chk_set_logs_rpe_range', sql`${table.rpe} IS NULL OR (${table.rpe} >= 1 AND ${table.rpe} <= 10)`),
  ],
);
