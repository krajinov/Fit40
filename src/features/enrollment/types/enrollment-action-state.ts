/**
 * Result of an enrollment Server Action, returned to the client.
 *
 * Expected application errors (already enrolled, not enrolled, unknown
 * program) are returned as data so the UI can surface them inline.
 * Unexpected errors are never converted into this shape — they throw and are
 * handled by the error boundary.
 */
export type EnrollmentActionErrorCode =
  | 'VALIDATION_ERROR'
  | 'PROGRAM_NOT_FOUND'
  | 'ALREADY_ENROLLED'
  | 'NOT_ENROLLED'
  | 'ENROLLMENT_CHANGED'
  | 'INVALID_ENROLLMENT';

export interface EnrollmentActionError {
  readonly code: EnrollmentActionErrorCode;
  readonly message: string;
}

export type EnrollmentActionState =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: EnrollmentActionError };
