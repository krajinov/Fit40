import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * Exercise reference data.
 *
 * `secondary_muscles` is a flat list of muscle-group enum values and
 * `considerations` is a JSONB array of `{ consideration, level }` objects.
 * Both are always loaded together with the exercise row, so they are stored
 * inline rather than normalized into join tables.
 */
export const exercises = pgTable('exercises', {
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
});
