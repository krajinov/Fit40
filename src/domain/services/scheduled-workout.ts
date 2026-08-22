/**
 * Pure helper to resolve a scheduled workout occurrence from a TrainingProgram.
 *
 * Extracts the scheduled occurrence and its corresponding workout template
 * given program slug, week number, and workout order.
 */

import type { ScheduledWorkout, TrainingProgram } from '@/domain/entities/training-program';
import type { Workout } from '@/domain/entities/workout';

export interface ScheduledWorkoutOccurrence {
  readonly scheduled: ScheduledWorkout;
  readonly workout: Workout;
}

/**
 * Finds a scheduled workout occurrence and its workout template.
 *
 * Returns null if:
 * - The week number does not exist in the program.
 * - The workout order does not exist in that week.
 * - The workout template referenced by the occurrence is not found in the program.
 */
export function findScheduledWorkoutOccurrence(
  program: TrainingProgram,
  weekNumber: number,
  workoutOrder: number,
): ScheduledWorkoutOccurrence | null {
  const week = program.weeks.find((w) => w.weekNumber === weekNumber);
  if (week === undefined) return null;

  const scheduled = week.scheduledWorkouts.find((s) => s.order === workoutOrder);
  if (scheduled === undefined) return null;

  const workout = program.workouts.find((w) => w.id === scheduled.workoutId);
  if (workout === undefined) return null;

  return { scheduled, workout };
}