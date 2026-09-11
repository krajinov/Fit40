/**
 * PURE user-facing copy for session action errors (M9/M10): deterministic
 * error-code → sentence mapping for the substitution/restore, skip/unskip
 * and move controls, in the existing Fit40 session-action tone.
 *
 * Raw error codes never reach users. `SESSION_MODIFIED` is intentionally NOT
 * mapped here — `SessionActionError` already renders its reload/retry
 * message, and callers additionally trigger `router.refresh()` on it. Copy
 * may only promise an automatic reload for codes the swap panel actually
 * refreshes on (see `session-mutation-refresh.ts`); every other label points
 * the user at a manual reload instead.
 *
 * This module is the single home of session action failure copy so the
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
      // Shared by the M9 swap path and the M10 skip path: logged sets must
      // be deleted explicitly before the occurrence can be skipped or
      // swapped — no mutation removes them implicitly.
      return 'This exercise has logged sets. Delete them first before it can be skipped or swapped.';
    case 'SUBSTITUTION_NO_CHANGE':
      return 'That exercise is already selected here. Reloading the latest state…';
    case 'ADJUSTMENT_NO_CHANGE':
      return 'That exercise is already in this state. Reloading the latest workout…';
    case 'MOVE_OUT_OF_RANGE':
      // The move controls only render when the page believes the occurrence
      // has a neighbor in that direction; this code means that belief is
      // stale, and the move path refreshes on it.
      return 'That exercise can no longer be moved in that direction. Reloading the latest workout…';
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
