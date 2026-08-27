import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { exercises } from './exercises';

/**
 * Training program aggregate tables: programs, workout templates, their
 * exercises, weeks, and scheduled occurrences.
 */
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
  (table) => ({
    durationWeeksCheck: check('training_programs_duration_weeks_check', sql`${table.durationWeeks} > 0`),
    workoutsPerWeekCheck: check(
      'training_programs_workouts_per_week_check',
      sql`${table.workoutsPerWeek} > 0`,
    ),
    difficultyCheck: check(
      'training_programs_difficulty_check',
      sql`${table.difficulty} IN ('beginner','intermediate','advanced')`,
    ),
    goalCheck: check(
      'training_programs_goal_check',
      sql`${table.goal} IN ('strength','hypertrophy','endurance','mobility','general-fitness','weight-loss','strength-and-mobility')`,
    ),
  }),
);

/**
 * Reusable workout templates owned by a single program.
 *
 * Note: `slug` and `estimated_duration_minutes` are part of the domain
 * `Workout` entity and are required to reconstruct it. They are persisted
 * alongside the other template fields.
 */
export const workouts = pgTable(
  'workouts',
  {
    id: text('id').primaryKey(),
    programId: text('program_id')
      .notNull()
      .references(() => trainingPrograms.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull(),
    estimatedDurationMinutes: integer('estimated_duration_minutes').notNull(),
  },
  (table) => ({
    programIdIdx: index('workouts_program_id_idx').on(table.programId),
    // Unique key used as the target of the scheduled_workouts ownership FK.
    programIdIdUnique: unique('workouts_program_id_id_unique').on(table.programId, table.id),
  }),
);

export const workoutExercises = pgTable(
  'workout_exercises',
  {
    workoutId: text('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
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
    notes: text('notes'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workoutId, table.exerciseOrder] }),
    exerciseIdIdx: index('workout_exercises_exercise_id_idx').on(table.exerciseId),
    exerciseOrderCheck: check('workout_exercises_exercise_order_check', sql`${table.exerciseOrder} > 0`),
    setsCheck: check('workout_exercises_sets_check', sql`${table.sets} > 0`),
    minRepsCheck: check('workout_exercises_min_reps_check', sql`${table.minReps} > 0`),
    maxRepsCheck: check('workout_exercises_max_reps_check', sql`${table.maxReps} >= ${table.minReps}`),
    durationSecondsCheck: check(
      'workout_exercises_duration_seconds_check',
      sql`${table.durationSeconds} > 0`,
    ),
    restSecondsCheck: check('workout_exercises_rest_seconds_check', sql`${table.restSeconds} >= 0`),
    prescriptionCheck: check(
      'workout_exercises_prescription_check',
      sql`(
        (${table.prescriptionType} = 'reps' AND ${table.minReps} IS NOT NULL AND ${table.maxReps} IS NOT NULL AND ${table.durationSeconds} IS NULL)
        OR
        (${table.prescriptionType} = 'duration' AND ${table.durationSeconds} IS NOT NULL AND ${table.minReps} IS NULL AND ${table.maxReps} IS NULL)
      )`,
    ),
  }),
);

export const programWeeks = pgTable(
  'program_weeks',
  {
    programId: text('program_id')
      .notNull()
      .references(() => trainingPrograms.id, { onDelete: 'cascade' }),
    weekNumber: integer('week_number').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.programId, table.weekNumber] }),
    weekNumberCheck: check('program_weeks_week_number_check', sql`${table.weekNumber} > 0`),
  }),
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
  (table) => ({
    positionUnique: uniqueIndex('scheduled_workouts_position_unique').on(
      table.programId,
      table.weekNumber,
      table.orderInWeek,
    ),
    workoutIdIdx: index('scheduled_workouts_workout_id_idx').on(table.workoutId),
    weekFk: foreignKey({
      columns: [table.programId, table.weekNumber],
      foreignColumns: [programWeeks.programId, programWeeks.weekNumber],
      name: 'scheduled_workouts_week_fk',
    }).onDelete('cascade'),
    // Enforces that a scheduled workout can only reference a workout template
    // owned by the same program. Replaces the previous single-column
    // workout_id FK, which allowed cross-program references that would break
    // aggregate reconstruction.
    programWorkoutFk: foreignKey({
      columns: [table.programId, table.workoutId],
      foreignColumns: [workouts.programId, workouts.id],
      name: 'scheduled_workouts_program_workout_fk',
    }).onDelete('cascade'),
    orderInWeekCheck: check('scheduled_workouts_order_in_week_check', sql`${table.orderInWeek} > 0`),
  }),
);
