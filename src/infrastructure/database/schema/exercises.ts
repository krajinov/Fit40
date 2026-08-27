import { check, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const exercises = pgTable(
  'exercises',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    primaryMuscle: text('primary_muscle').notNull(),
    secondaryMuscles: text('secondary_muscles').array().notNull().default([]),
    equipment: text('equipment').notNull(),
    difficulty: text('difficulty').notNull(),
    movementPattern: text('movement_pattern').notNull(),
    considerations: jsonb('considerations').notNull().default('[]'),
  },
  (table) => [
    check('chk_exercises_difficulty', sql`${table.difficulty} IN ('beginner', 'intermediate', 'advanced')`),
    check(
      'chk_exercises_movement_pattern',
      sql`${table.movementPattern} IN ('squat', 'hinge', 'push-horizontal', 'push-vertical', 'pull-horizontal', 'pull-vertical', 'carry', 'core', 'isolation', 'locomotion')`,
    ),
  ],
);
