import { check, integer, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
    check('chk_workout_exercises_sets', sql`${table.sets} > 0`),
    check('chk_workout_exercises_exercise_order', sql`${table.exerciseOrder} > 0`),
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
    check('chk_workout_exercises_reps_range', sql`${table.maxReps} >= ${table.minReps}`),
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
    workoutId: text('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    orderInWeek: integer('order_in_week').notNull(),
  },
  (table) => [
    check('chk_scheduled_workouts_order', sql`${table.orderInWeek} > 0`),
    check('chk_scheduled_workouts_week_number', sql`${table.weekNumber} > 0`),
    uniqueIndex('scheduled_workouts_program_week_order_idx').on(
      table.programId,
      table.weekNumber,
      table.orderInWeek,
    ),
  ],
);
