import { sql } from 'drizzle-orm';
import { check, integer, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * User fitness profile table: one row per user, created by onboarding.
 *
 * The auth identity (`users`) and the fitness profile are separate concepts:
 * `user_id` is both the primary key (exactly one profile per user, verified by
 * the database as final authority) and a CASCADE foreign key — deleting an
 * account removes its profile. Profile mutations never touch `users`,
 * `auth_sessions`, or training-history tables.
 *
 * `birth_year` stores the birth year only (not a full date of birth): Fit40
 * needs age banding, not day precision, and this is the minimal personal data
 * that satisfies that need. Enum-valued columns carry CHECK constraints,
 * matching the storage style of the exercises table.
 */
export const profiles = pgTable(
  'profiles',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    birthYear: integer('birth_year').notNull(),
    experienceLevel: text('experience_level').notNull(),
    primaryGoal: text('primary_goal').notNull(),
    availableEquipment: text('available_equipment').array().notNull().default(sql`'{}'::text[]`),
    physicalConsiderations: text('physical_considerations')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    preferredDaysPerWeek: integer('preferred_days_per_week').notNull(),
    preferredSessionMinutes: integer('preferred_session_minutes').notNull(),
    heightCm: integer('height_cm'),
    weightKg: numeric('weight_kg', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Lower bound defends against absurd rows; the current-aware upper bound
    // (age <= 120 at submission time) is enforced by the domain factory and
    // the Zod boundary, because a CHECK constraint cannot track the calendar.
    birthYearCheck: check('profiles_birth_year_check', sql`${table.birthYear} >= 1900`),
    experienceLevelCheck: check(
      'profiles_experience_level_check',
      sql`${table.experienceLevel} IN ('beginner','intermediate','advanced')`,
    ),
    primaryGoalCheck: check(
      'profiles_primary_goal_check',
      sql`${table.primaryGoal} IN ('strength','hypertrophy','endurance','mobility','general-fitness','weight-loss','strength-and-mobility')`,
    ),
    availableEquipmentCheck: check(
      'profiles_available_equipment_check',
      sql`${table.availableEquipment} <@ ARRAY['bodyweight','dumbbell','barbell','resistance-band','kettlebell','bench','machine','pull-up-bar']::text[]`,
    ),
    availableEquipmentUniqueCheck: check(
      'profiles_available_equipment_unique_check',
      sql`NOT fit40_text_array_has_duplicates(${table.availableEquipment})`,
    ),
    availableEquipmentNonEmptyCheck: check(
      'profiles_available_equipment_non_empty_check',
      sql`cardinality(${table.availableEquipment}) > 0`,
    ),
    physicalConsiderationsCheck: check(
      'profiles_physical_considerations_check',
      sql`${table.physicalConsiderations} <@ ARRAY['knee-sensitive','lower-back-sensitive','shoulder-sensitive','limited-mobility']::text[]`,
    ),
    physicalConsiderationsUniqueCheck: check(
      'profiles_physical_considerations_unique_check',
      sql`NOT fit40_text_array_has_duplicates(${table.physicalConsiderations})`,
    ),
    daysPerWeekCheck: check(
      'profiles_days_per_week_check',
      sql`${table.preferredDaysPerWeek} >= 1 AND ${table.preferredDaysPerWeek} <= 7`,
    ),
    sessionMinutesCheck: check(
      'profiles_session_minutes_check',
      sql`${table.preferredSessionMinutes} >= 10 AND ${table.preferredSessionMinutes} <= 240`,
    ),
    heightCheck: check(
      'profiles_height_check',
      sql`${table.heightCm} IS NULL OR (${table.heightCm} >= 100 AND ${table.heightCm} <= 250)`,
    ),
    // Intentionally slightly wider than the domain range (30–400): the domain
    // factory is the spec, this is the last-line safety net against absurd rows.
    weightCheck: check(
      'profiles_weight_check',
      sql`${table.weightKg} >= 30 AND ${table.weightKg} <= 500`,
    ),
    updatedAtCheck: check(
      'profiles_updated_at_check',
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  }),
);
