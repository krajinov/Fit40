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
import { sql } from 'drizzle-orm';
import { exercises } from './exercises';
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
  (table) => [
    // A session is either in progress or finished; a finished one cannot precede its start.
    check(
      'chk_workout_sessions_completed_at',
      sql`${table.completedAt} IS NULL OR ${table.completedAt} >= ${table.startedAt}`,
    ),
    // FK columns; `scheduled_workout_id` is already UNIQUE (index-backed).
    index('workout_sessions_workout_id_idx').on(table.workoutId),
    // Completed-session listings order by started_at.
    index('workout_sessions_started_at_idx').on(table.startedAt),
  ],
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
    // Logged exercises reference catalog rows that must not disappear underneath them.
    foreignKey({
      name: 'exercise_logs_exercise_id_fk',
      columns: [table.exerciseId],
      foreignColumns: [exercises.id],
    }).onDelete('restrict'),
    index('exercise_logs_exercise_id_idx').on(table.exerciseId),
    check('chk_exercise_logs_exercise_order', sql`${table.exerciseOrder} > 0`),
    check('chk_exercise_logs_sets', sql`${table.sets} > 0`),
    check('chk_exercise_logs_rest_seconds', sql`${table.restSeconds} >= 0`),
    check('chk_exercise_logs_min_reps', sql`${table.minReps} IS NULL OR ${table.minReps} > 0`),
    check('chk_exercise_logs_max_reps', sql`${table.maxReps} IS NULL OR ${table.maxReps} > 0`),
    check(
      'chk_exercise_logs_reps_range',
      sql`${table.minReps} IS NULL OR ${table.maxReps} IS NULL OR ${table.maxReps} >= ${table.minReps}`,
    ),
    check(
      'chk_exercise_logs_duration',
      sql`${table.durationSeconds} IS NULL OR ${table.durationSeconds} > 0`,
    ),
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
    // Paired with `exerciseOrder` in the composite foreign key below, which already
    // guarantees the session exists (exercise_logs owns the session FK).
    sessionId: text('session_id').notNull(),
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
    // Sets belong to an exercise log of the same session; deleting the log deletes its sets.
    foreignKey({
      name: 'set_logs_exercise_log_fk',
      columns: [table.sessionId, table.exerciseOrder],
      foreignColumns: [exerciseLogs.sessionId, exerciseLogs.exerciseOrder],
    }).onDelete('cascade'),
    check('chk_set_logs_set_number', sql`${table.setNumber} > 0`),
    check('chk_set_logs_reps', sql`${table.reps} IS NULL OR ${table.reps} > 0`),
    check(
      'chk_set_logs_duration',
      sql`${table.durationSeconds} IS NULL OR ${table.durationSeconds} > 0`,
    ),
    check('chk_set_logs_weight', sql`${table.weightKg} IS NULL OR ${table.weightKg} >= 0`),
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
