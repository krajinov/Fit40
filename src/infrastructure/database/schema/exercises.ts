import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * Exercise reference data.
 *
 * `secondary_muscles` is a flat list of muscle-group enum values and
 * `considerations` is a JSONB array of `{ consideration, level }` objects.
 * Both are always loaded together with the exercise row, so they are stored
 * inline rather than normalized into join tables.
 *
 * The enum-valued text columns carry CHECK constraints so invalid values are
 * rejected at write time instead of surfacing as read-time corruption.
 */
export const exercises = pgTable(
  'exercises',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    primaryMuscle: text('primary_muscle').notNull(),
    secondaryMuscles: text('secondary_muscles').array().notNull().default(sql`'{}'::text[]`),
    equipment: text('equipment').notNull(),
    difficulty: text('difficulty').notNull(),
    movementPattern: text('movement_pattern').notNull(),
    considerations: jsonb('considerations').notNull().default(sql`'[]'::jsonb`),
  },
  (table) => ({
    primaryMuscleCheck: check(
      'exercises_primary_muscle_check',
      sql`${table.primaryMuscle} IN ('chest','back','shoulders','quadriceps','hamstrings','glutes','calves','biceps','triceps','core','full-body')`,
    ),
    secondaryMusclesCheck: check(
      'exercises_secondary_muscles_check',
      sql`${table.secondaryMuscles} <@ ARRAY['chest','back','shoulders','quadriceps','hamstrings','glutes','calves','biceps','triceps','core','full-body']::text[]`,
    ),
    equipmentCheck: check(
      'exercises_equipment_check',
      sql`${table.equipment} IN ('bodyweight','dumbbell','barbell','resistance-band','kettlebell','bench','machine','pull-up-bar')`,
    ),
    difficultyCheck: check(
      'exercises_difficulty_check',
      sql`${table.difficulty} IN ('beginner','intermediate','advanced')`,
    ),
    movementPatternCheck: check(
      'exercises_movement_pattern_check',
      sql`${table.movementPattern} IN ('squat','hinge','push-horizontal','push-vertical','pull-horizontal','pull-vertical','carry','core','isolation','locomotion')`,
    ),
  }),
);
