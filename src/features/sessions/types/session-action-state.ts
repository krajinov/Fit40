/**
 * Result of a session Server Action, returned to the client.
 *
 * Expected application errors (including `SESSION_MODIFIED` and
 * `SESSION_ALREADY_EXISTS`) are returned as data so the UI can surface a
 * recovery message. Unexpected errors are never converted into this shape —
 * they throw and are handled by the error boundary.
 */
export type SessionActionErrorCode =
  | 'VALIDATION_ERROR'
  | 'SESSION_MODIFIED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_ALREADY_EXISTS'
  | 'SESSION_ALREADY_COMPLETED'
  | 'EXERCISE_LOG_NOT_FOUND'
  | 'SET_NOT_FOUND'
  | 'INVALID_SET_TYPE'
  | 'INVALID_SET_DATA'
  | 'CANNOT_COMPLETE_EMPTY_SESSION'
  | 'PROGRAM_NOT_FOUND'
  | 'SCHEDULED_WORKOUT_NOT_FOUND'
  | 'INVALID_WORKOUT_SESSION'
  | 'NOT_ENROLLED'
  | 'ENROLLMENT_CHANGED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT';

export interface SessionActionError {
  readonly code: SessionActionErrorCode;
  readonly message: string;
}

export type SessionActionState =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: SessionActionError };
