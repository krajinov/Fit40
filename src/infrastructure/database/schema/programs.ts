import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { exercises } from './exercises';

export const trainingPrograms = pgTable(
  'training_programs',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    difficulty: text('difficulty').notNull(),
    goal: text('goal').notNull(),
    durationWeeks: integer('duration_weeks').notNull(),
    workoutsPerWeek: integer('workouts_per_week').notNull(),
  },
  (table) => [
    check('chk_training_programs_duration_weeks', sql`${table.durationWeeks} > 0`),
    check('chk_training_programs_workouts_per_week', sql`${table.workoutsPerWeek} > 0`),
    check('chk_training_programs_difficulty', sql`${table.difficulty} IN ('beginner', 'intermediate', 'advanced')`),
    check(
      'chk_training_programs_goal',
      sql`${table.goal} IN ('strength', 'hypertrophy', 'endurance', 'mobility', 'general-fitness', 'weight-loss', 'strength-and-mobility')`,
    ),
  ],
);

export const workouts = pgTable(
  'workouts',
  {
    id: text('id').primaryKey(),
    programId: text('program_id')
      .notNull()
      .references(() => trainingPrograms.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    estimatedDurationMinutes: integer('estimated_duration_minutes').notNull(),
  },
  (table) => [
    check('chk_workouts_estimated_duration', sql`${table.estimatedDurationMinutes} > 0`),
    // Key that lets other tables prove a workout belongs to *their* program: a
    // composite foreign key has to reference the owning column together with the id.
    uniqueIndex('workouts_program_id_id_idx').on(table.programId, table.id),
    // FK column + "find workouts by program" lookups.
    index('workouts_program_id_idx').on(table.programId),
  ],
);

export const workoutExercises = pgTable(
  'workout_exercises',
  {
    workoutId: text('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    exerciseOrder: integer('exercise_order').notNull(),
    exerciseId: text('exercise_id').notNull(),
    prescriptionType: text('prescription_type').notNull(),
    sets: integer('sets').notNull(),
    minReps: integer('min_reps'),
    maxReps: integer('max_reps'),
    durationSeconds: integer('duration_seconds'),
    restSeconds: integer('rest_seconds').notNull().default(0),
    notes: text('notes'),
  },
  (table) => [
    primaryKey({ columns: [table.workoutId, table.exerciseOrder], name: 'workout_exercises_pkey' }),
    // Exercise templates reference catalog rows that must not disappear underneath them.
    foreignKey({
      name: 'workout_exercises_exercise_id_fk',
      columns: [table.exerciseId],
      foreignColumns: [exercises.id],
    }).onDelete('restrict'),
    index('workout_exercises_exercise_id_idx').on(table.exerciseId),
    check('chk_workout_exercises_sets', sql`${table.sets} > 0`),
    check('chk_workout_exercises_exercise_order', sql`${table.exerciseOrder} > 0`),
    check('chk_workout_exercises_rest_seconds', sql`${table.restSeconds} >= 0`),
    check('chk_workout_exercises_min_reps', sql`${table.minReps} IS NULL OR ${table.minReps} > 0`),
    check('chk_workout_exercises_max_reps', sql`${table.maxReps} IS NULL OR ${table.maxReps} > 0`),
    check(
      'chk_workout_exercises_duration',
      sql`${table.durationSeconds} IS NULL OR ${table.durationSeconds} > 0`,
    ),
    check(
      'chk_workout_exercises_prescription',
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
    check(
      'chk_workout_exercises_reps_range',
      sql`${table.minReps} IS NULL OR ${table.maxReps} IS NULL OR ${table.maxReps} >= ${table.minReps}`,
    ),
  ],
);

export const programWeeks = pgTable(
  'program_weeks',
  {
    programId: text('program_id')
      .notNull()
      .references(() => trainingPrograms.id, { onDelete: 'cascade' }),
    weekNumber: integer('week_number').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.programId, table.weekNumber], name: 'program_weeks_pkey' }),
    check('chk_program_weeks_week_number', sql`${table.weekNumber} > 0`),
  ],
);

export const scheduledWorkouts = pgTable(
  'scheduled_workouts',
  {
    id: text('id').primaryKey(),
    programId: text('program_id')
      .notNull()
      .references(() => trainingPrograms.id, { onDelete: 'cascade' }),
    weekNumber: integer('week_number').notNull(),
    workoutId: text('workout_id').notNull(),
    orderInWeek: integer('order_in_week').notNull(),
  },
  (table) => [
    check('chk_scheduled_workouts_order', sql`${table.orderInWeek} > 0`),
    check('chk_scheduled_workouts_week_number', sql`${table.weekNumber} > 0`),
    // Schedule entries must point at a week that belongs to the same program.
    foreignKey({
      name: 'scheduled_workouts_program_week_fk',
      columns: [table.programId, table.weekNumber],
      foreignColumns: [programWeeks.programId, programWeeks.weekNumber],
    }).onDelete('cascade'),
    // ...and at a workout owned by that same program: referencing the
    // workouts (program_id, id) key makes "program A schedules program B's
    // workout" a violation instead of quietly inconsistent data. Deleting a
    // workout still removes its occurrences, as the single-column key did.
    foreignKey({
      name: 'scheduled_workouts_workout_program_fk',
      columns: [table.programId, table.workoutId],
      foreignColumns: [workouts.programId, workouts.id],
    }).onDelete('cascade'),
    // FK column: deleting a workout must find its scheduled occurrences.
    index('scheduled_workouts_workout_id_idx').on(table.workoutId),
    uniqueIndex('scheduled_workouts_program_week_order_idx').on(
      table.programId,
      table.weekNumber,
      table.orderInWeek,
    ),
  ],
);
