/**
 * Pure domain logic for deriving session metrics.
 *
 * Volume calculation rules:
 * - Rep sets contribute `reps × weightKg` when `weightKg` is non-null.
 * - Duration sets are excluded from volume.
 * - Bodyweight/unweighted rep sets (weightKg === null) are excluded.
 * - Zero weight contributes zero.
 */

import type { WorkoutSession } from '@/domain/entities/workout-session';

export interface SessionMetrics {
  readonly totalSets: number;
  readonly totalReps: number;
  readonly totalDurationSeconds: number;
  readonly volume: number;
}

export function calculateSessionMetrics(session: WorkoutSession): SessionMetrics {
  let totalSets = 0;
  let totalReps = 0;
  let totalDurationSeconds = 0;
  let volume = 0;

  for (const log of session.exerciseLogs) {
    for (const set of log.sets) {
      totalSets += 1;

      if (set.type === 'reps') {
        totalReps += set.reps;
        if (set.weightKg !== null) {
          volume += set.reps * set.weightKg;
        }
      } else if (set.type === 'duration') {
        totalDurationSeconds += set.durationSeconds;
      }
    }
  }

  return {
    totalSets,
    totalReps,
    totalDurationSeconds,
    volume,
  };
}