/**
 * Shared guard for session saves on the update path of the workout-session use
 * cases (complete, log set, update set, delete set).
 *
 * A session's identity never changes once it exists: it stays attached to the
 * same scheduled workout occurrence, so the repository's "one session per
 * occurrence" constraint cannot be violated by an update. If a conflict is
 * reported anyway, the stored data is already inconsistent and no caller can
 * recover from it, so it is surfaced as an unexpected error (logged, shown to
 * the user as a generic failure) instead of a typed business outcome.
 */

import type { SaveWorkoutSessionResult } from '@/application/ports/workout-session-repository';
import type { WorkoutSessionId } from '@/domain/types/ids';

export function assertSessionSaveSucceeded(
  result: SaveWorkoutSessionResult,
  sessionId: WorkoutSessionId,
): void {
  if (!result.ok) {
    throw new Error(
      `Session "${sessionId}" conflicts with the session already stored for scheduled workout ` +
        `"${result.error.scheduledWorkoutId}"; stored sessions are inconsistent`,
    );
  }
}
