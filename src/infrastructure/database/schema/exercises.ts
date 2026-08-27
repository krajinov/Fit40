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
    // The primary muscle must not also appear in secondary_muscles (the domain
    // factory rejects this, so it is enforced at write time instead of
    // surfacing as read-time corruption).
    secondaryMusclesExclusionCheck: check(
      'exercises_secondary_muscles_exclusion_check',
      sql`NOT (${table.secondaryMuscles} @> ARRAY[${table.primaryMuscle}]::text[])`,
    ),
    // secondary_muscles must not contain duplicates: no element in the tail
    // (positions 2..n) may also appear in the head (positions 1..n-1).
    secondaryMusclesUniqueCheck: check(
      'exercises_secondary_muscles_unique_check',
      sql`(
        cardinality(${table.secondaryMuscles}) <= 1
        OR NOT (${table.secondaryMuscles}[2:cardinality(${table.secondaryMuscles})]
                <@ ${table.secondaryMuscles}[1:cardinality(${table.secondaryMuscles}) - 1])
      )`,
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
    // Enforces the domain shape of the considerations JSONB column: an array of
    // objects that each carry a valid `consideration` and `level`. Non-array
    // values, non-object elements, missing keys, and unsupported values are
    // rejected at write time instead of surfacing as read-time corruption in
    // mapExerciseRow(). Extra keys are tolerated, matching the mapper.
    considerationsCheck: check(
      'exercises_considerations_check',
      sql`(
        jsonb_typeof(${table.considerations}) = 'array'
        AND (jsonb_array_length(${table.considerations}) = 0
          OR (jsonb_path_exists(${table.considerations}, 'strict $[*].consideration')
              AND jsonb_path_exists(${table.considerations}, 'strict $[*].level')))
        AND NOT jsonb_path_exists(
          ${table.considerations},
          'strict $[*] ? ((@.consideration != "knee-sensitive" && @.consideration != "lower-back-sensitive" && @.consideration != "shoulder-sensitive" && @.consideration != "limited-mobility") || (@.level != "suitable" && @.level != "caution" && @.level != "unsuitable"))'
        )
      )`,
    ),
  }),
);
