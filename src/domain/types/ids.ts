/**
 * Branded ID types for the Fit40 domain.
 *
 * Branded types prevent accidentally passing an ID of one entity type
 * where another is expected, while still compiling to plain strings at runtime.
 */

import { err, ok, type Result } from '@/lib/result';

/**
 * Unique identifier for an Exercise.
 */
export type ExerciseId = string & { readonly __brand: 'ExerciseId' };

/**
 * Creates a validated ExerciseId.
 *
 * Returns a Result so callers can handle the empty-string case without throwing.
 * The cast to ExerciseId is safe because we have just validated the input and the
 * runtime value remains a plain string; the brand is a compile-time-only marker.
 */
export function createExerciseId(value: string): Result<ExerciseId, { readonly message: string }> {
  if (value.trim().length === 0) {
    return err({ message: 'ExerciseId cannot be empty' });
  }

  return ok(value as ExerciseId);
}

/**
 * Unique identifier for a TrainingProgram.
 */
export type ProgramId = string & { readonly __brand: 'ProgramId' };

/**
 * Creates a validated ProgramId.
 */
export function createProgramId(value: string): Result<ProgramId, { readonly message: string }> {
  if (value.trim().length === 0) {
    return err({ message: 'ProgramId cannot be empty' });
  }

  return ok(value as ProgramId);
}

/**
 * Unique identifier for a reusable Workout template.
 */
export type WorkoutId = string & { readonly __brand: 'WorkoutId' };

/**
 * Creates a validated WorkoutId.
 */
export function createWorkoutId(value: string): Result<WorkoutId, { readonly message: string }> {
  if (value.trim().length === 0) {
    return err({ message: 'WorkoutId cannot be empty' });
  }

  return ok(value as WorkoutId);
}

/**
 * Unique identifier for a scheduled Workout occurrence inside a program.
 */
export type ScheduledWorkoutId = string & { readonly __brand: 'ScheduledWorkoutId' };

/**
 * Creates a validated ScheduledWorkoutId.
 */
export function createScheduledWorkoutId(
  value: string,
): Result<ScheduledWorkoutId, { readonly message: string }> {
  if (value.trim().length === 0) {
    return err({ message: 'ScheduledWorkoutId cannot be empty' });
  }

  return ok(value as ScheduledWorkoutId);
}

/**
 * Unique identifier for a User.
 */
export type UserId = string & { readonly __brand: 'UserId' };

/**
 * Creates a validated UserId.
 */
export function createUserId(value: string): Result<UserId, { readonly message: string }> {
  if (value.trim().length === 0) {
    return err({ message: 'UserId cannot be empty' });
  }

  return ok(value as UserId);
}

/**
 * Unique identifier for a WorkoutSession.
 */
export type WorkoutSessionId = string & { readonly __brand: 'WorkoutSessionId' };

/**
 * Creates a validated WorkoutSessionId.
 */
export function createWorkoutSessionId(
  value: string,
): Result<WorkoutSessionId, { readonly message: string }> {
  if (value.trim().length === 0) {
    return err({ message: 'WorkoutSessionId cannot be empty' });
  }

  return ok(value as WorkoutSessionId);
}