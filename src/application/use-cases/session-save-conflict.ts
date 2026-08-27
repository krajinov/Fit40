/**
 * Shared translation of a rejected session save on the update path of the
 * workout-session use cases (complete, log set, update set, delete set).
 *
 * A session's identity never changes once it exists: it stays attached to the
 * same scheduled workout occurrence, so the repository's "one session per
 * occurrence" constraint cannot be violated by an update. If such a conflict is
 * reported anyway, the stored data is already inconsistent and no caller can
 * recover from it, so it is surfaced as an unexpected error (logged, shown to the
 * user as a generic failure).
 *
 * A `concurrent-modification` conflict is different: it is the ordinary outcome
 * of two requests that loaded the same revision of a session and raced to write
 * it. The loser's write was refused by storage, nothing was changed, and the
 * caller is expected to reload and retry, so it becomes the typed
 * `SESSION_MODIFIED` error.
 */

import type { WorkoutSessionSaveConflict } from '@/application/ports/workout-session-repository';

/** Expected conflict: the session moved on while the caller held a stale copy. */
export interface SessionModifiedError {
  readonly code: 'SESSION_MODIFIED';
  readonly sessionId: string;
  readonly message: string;
}

export function toSessionModifiedError(
  conflict: WorkoutSessionSaveConflict,
  sessionId: string,
): SessionModifiedError {
  if (conflict.reason === 'concurrent-modification') {
    return {
      code: 'SESSION_MODIFIED',
      sessionId,
      message:
        `Session "${sessionId}" was modified by another request after it was loaded ` +
        `(revision ${conflict.expectedVersion} is no longer current); reload it before saving`,
    };
  }

  throw new Error(
    `Session "${sessionId}" conflicts with the session stored for scheduled workout ` +
      `"${conflict.scheduledWorkoutId}"; stored sessions are inconsistent`,
  );
}
