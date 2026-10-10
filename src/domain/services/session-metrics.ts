/**
 * Pure domain logic for deriving session metrics.
 *
 * Volume calculation rules:
 * - Rep sets contribute `reps × weightKg` when `weightKg` is non-null.
 * - Duration sets are excluded from volume.
 * - Bodyweight/unweighted rep sets (weightKg === null) are excluded.
 * - Zero weight contributes zero.
 */

import type { SetLog, WorkoutSession } from '@/domain/entities/workout-session';

export interface SessionMetrics {
  readonly totalSets: number;
  readonly totalReps: number;
  readonly totalDurationSeconds: number;
  readonly volume: number;
  /** True for eligible loaded rep data, including genuine zero. */
  readonly hasExternalLoad: boolean;
}

export function calculateSessionMetrics(session: WorkoutSession): SessionMetrics {
  return calculateLoggedSetMetrics(
    session.exerciseLogs.flatMap((log) => log.sets),
  );
}

/** Shared authority for session metrics and M18's zero-versus-absence rule. */
export function calculateLoggedSetMetrics(
  sets: ReadonlyArray<SetLog>,
): SessionMetrics {
  let totalReps = 0;
  let totalDurationSeconds = 0;
  let volume = 0;
  let hasExternalLoad = false;
  for (const set of sets) {
    if (set.type === 'reps') {
      totalReps += set.reps;
      if (set.weightKg !== null) {
        hasExternalLoad = true;
        volume += set.reps * set.weightKg;
      }
    } else {
      totalDurationSeconds += set.durationSeconds;
    }
  }
  return { totalSets: sets.length, totalReps, totalDurationSeconds, volume, hasExternalLoad };
}
