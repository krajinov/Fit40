/**
 * Pure bridge from workout sessions to program progress.
 *
 * Extracts completed ScheduledWorkoutIds from an array of sessions.
 * In-progress sessions are ignored.
 */

import type { WorkoutSession } from '@/domain/entities/workout-session';
import type { ScheduledWorkoutId } from '@/domain/types/ids';

/**
 * Returns the ScheduledWorkoutIds of all completed sessions.
 *
 * Rules:
 * - Only sessions with `completedAt !== null` are included.
 * - Duplicate IDs are removed.
 * - Order is preserved from the input array.
 */
export function getCompletedScheduledWorkoutIds(
  sessions: ReadonlyArray<WorkoutSession>,
): ReadonlyArray<ScheduledWorkoutId> {
  const ids: ScheduledWorkoutId[] = [];
  const seen = new Set<string>();

  for (const session of sessions) {
    if (session.completedAt !== null && !seen.has(session.scheduledWorkoutId)) {
      seen.add(session.scheduledWorkoutId);
      ids.push(session.scheduledWorkoutId);
    }
  }

  return ids;
}