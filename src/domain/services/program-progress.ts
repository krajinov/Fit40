/**
 * Pure domain logic for program scheduling, progress, and next-workout resolution.
 *
 * Operates on a TrainingProgram and a caller-supplied list of completed
 * ScheduledWorkoutIds. No repository or framework dependencies.
 */

import type { ScheduledWorkout, TrainingProgram } from '@/domain/entities/training-program';
import type { ScheduledWorkoutId } from '@/domain/types/ids';

/**
 * Returns every scheduled workout in deterministic program order:
 * by week number ascending, then by order within the week ascending.
 */
export function listScheduledWorkoutsInOrder(
  program: TrainingProgram,
): ReadonlyArray<ScheduledWorkout> {
  return program.weeks.flatMap((week) =>
    [...week.scheduledWorkouts].sort((a, b) => a.order - b.order),
  );
}

function uniqueIds(ids: ReadonlyArray<ScheduledWorkoutId>): ReadonlyArray<ScheduledWorkoutId> {
  return [...new Set(ids)];
}

/**
 * Structured result of calculating program progress.
 */
export interface ProgramProgress {
  readonly totalWorkouts: number;
  readonly completedWorkouts: number;
  readonly remainingWorkouts: number;
  readonly percentage: number;
  readonly unrecognizedIds: ReadonlyArray<ScheduledWorkoutId>;
}

/**
 * Calculates progress for a program given a caller-supplied list of completed
 * occurrence IDs.
 *
 * Behavior:
 * - Duplicates in completedIds are counted once.
 * - Unknown ids (not present in the program) are ignored in the count but
 *   returned in `unrecognizedIds` so callers can detect bad input.
 * - percentage is an integer 0..100.
 */
export function calculateProgramProgress(
  program: TrainingProgram,
  completedIds: ReadonlyArray<ScheduledWorkoutId>,
): ProgramProgress {
  const scheduledInOrder = listScheduledWorkoutsInOrder(program);
  const scheduledIdSet = new Set(scheduledInOrder.map((scheduled) => scheduled.id));
  const uniqueCompleted = uniqueIds(completedIds);

  const completedWorkouts = uniqueCompleted.filter((id) => scheduledIdSet.has(id)).length;
  const unrecognizedIds = uniqueCompleted.filter((id) => !scheduledIdSet.has(id));
  const totalWorkouts = scheduledInOrder.length;
  const remainingWorkouts = totalWorkouts - completedWorkouts;

  const percentage =
    totalWorkouts === 0 ? 0 : Math.round((completedWorkouts / totalWorkouts) * 100);

  return {
    totalWorkouts,
    completedWorkouts,
    remainingWorkouts,
    percentage,
    unrecognizedIds,
  };
}

/**
 * Returns the next scheduled workout in program order that is not marked as
 * completed.
 *
 * Behavior:
 * - Nothing completed → first workout.
 * - Some completed → first uncompleted workout in program order.
 * - Out-of-order completion → still returns the first uncompleted in program order.
 * - All completed → null.
 * - Unknown completed IDs → ignored.
 */
export function getNextWorkout(
  program: TrainingProgram,
  completedIds: ReadonlyArray<ScheduledWorkoutId>,
): ScheduledWorkout | null {
  const scheduledInOrder = listScheduledWorkoutsInOrder(program);
  const completedSet = new Set(completedIds);

  return scheduledInOrder.find((scheduled) => !completedSet.has(scheduled.id)) ?? null;
}