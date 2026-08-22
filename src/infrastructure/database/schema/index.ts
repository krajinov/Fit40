// Fit40 Database Schema
//
// This is the entry point for all Drizzle table definitions.
// Domain tables will be added here as features are implemented.
//
// Rules (see docs/database.md):
// - Table names: snake_case, plural (e.g., workout_sessions)
// - Column names: snake_case (e.g., created_at)
// - Primary keys: id UUID
// - Timestamps: timestamptz, always UTC
// - Foreign keys: always explicit
//
// Expected future schema files:
// - users.ts (users, profiles)
// - exercises.ts (exercises, muscle_groups)
// - programs.ts (training_programs, program_weeks, workouts, workout_exercises)
// - sessions.ts (workout_sessions, exercise_logs, set_logs)
// - enrollments.ts (program_enrollments)

// No tables defined yet. This file will export all tables as they are created.
export {};