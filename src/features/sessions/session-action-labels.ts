/**
 * PURE user-facing copy for session action errors (M9): deterministic
 * error-code → sentence mapping for the substitution/restore controls, in
 * the existing Fit40 session-action tone.
 *
 * Raw error codes never reach users. `SESSION_MODIFIED` is intentionally NOT
 * mapped here — `SessionActionError` already renders its reload/retry
 * message, and callers additionally trigger `router.refresh()` on it. Copy
 * may only promise an automatic reload for codes the swap panel actually
 * refreshes on (see `session-mutation-refresh.ts`); every other label points
 * the user at a manual reload instead.
 *
 * This module is the single home of substitution failure copy so the two
 * actions and their tests share one deterministic mapping.
 */

import type { SessionActionErrorCode } from '@/features/sessions/types/session-action-state';

export function sessionActionErrorLabel(code: SessionActionErrorCode, fallback: string): string {
  switch (code) {
    case 'SESSION_NOT_FOUND':
      return 'This session no longer exists. Reload the page to see the latest state.';
    case 'NOT_ENROLLED':
      return 'You are no longer enrolled in this program, so this session can no longer be modified.';
    case 'SESSION_ALREADY_COMPLETED':
      return 'This workout is already completed, so its exercises can no longer be changed.';
    case 'EXERCISE_LOG_NOT_FOUND':
      return 'This exercise could not be found in the session. Reload the page to see the latest state.';
    case 'EXERCISE_HAS_LOGGED_SETS':
      return 'This exercise has logged sets. Delete them first to swap the exercise.';
    case 'SUBSTITUTION_NO_CHANGE':
      return 'That exercise is already selected here. Reloading the latest state…';
    case 'EXERCISE_NOT_FOUND':
      return 'That exercise is no longer available in the exercise catalog.';
    case 'INVALID_INPUT':
      return 'Invalid selection — choose an exercise and try again.';
    case 'VALIDATION_ERROR':
    case 'SESSION_MODIFIED':
    case 'SESSION_ALREADY_EXISTS':
    case 'SET_NOT_FOUND':
    case 'EXERCISE_OCCURRENCE_SKIPPED':
    case 'INVALID_SET_TYPE':
    case 'INVALID_SET_DATA':
    case 'CANNOT_COMPLETE_EMPTY_SESSION':
    case 'PROGRAM_NOT_FOUND':
    case 'SCHEDULED_WORKOUT_NOT_FOUND':
    case 'INVALID_WORKOUT_SESSION':
    case 'ENROLLMENT_CHANGED':
    case 'FORBIDDEN':
      return fallback;
  }
}
