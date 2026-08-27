/**
 * Result of a session mutation Server Action, returned to the client.
 *
 * Expected application errors (including `SESSION_MODIFIED`) are returned as
 * data so the UI can surface a recovery message. Unexpected errors are never
 * converted into this shape — they throw and are handled by the error boundary.
 */
export type SessionActionErrorCode =
  | 'VALIDATION_ERROR'
  | 'SESSION_MODIFIED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_ALREADY_COMPLETED'
  | 'EXERCISE_LOG_NOT_FOUND'
  | 'SET_NOT_FOUND'
  | 'INVALID_SET_TYPE'
  | 'INVALID_SET_DATA'
  | 'CANNOT_COMPLETE_EMPTY_SESSION'
  | 'INVALID_INPUT';

export interface SessionActionError {
  readonly code: SessionActionErrorCode;
  readonly message: string;
}

export type SessionActionState =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: SessionActionError };
