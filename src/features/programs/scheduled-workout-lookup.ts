/**
 * Request-level cached scheduled-workout lookup.
 *
 * Restores the pre-redesign route pattern: `generateMetadata` and the
 * page/view assembly (workout detail and Active Workout session routes)
 * resolve the same occurrence through ONE GetScheduledWorkoutUseCase
 * execution per request instead of two.
 *
 * React `cache()` memoizes per server request — a per-request memo, not a
 * global mutable cache — and the arguments are primitives so the cache key
 * compares by value. Application semantics are unchanged: the same use case
 * runs with the same typed `Result` contract.
 */

import { cache } from 'react';

import { getScheduledWorkoutUseCase } from '@/features/programs/services';

export const lookupScheduledWorkout = cache(
  async (programSlug: string, weekNumber: number, workoutOrder: number) =>
    getScheduledWorkoutUseCase.execute({ programSlug, weekNumber, workoutOrder }),
);
