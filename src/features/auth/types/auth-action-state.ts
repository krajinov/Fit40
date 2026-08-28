/**
 * Result of an auth Server Action, returned to the client.
 *
 * Expected application errors (duplicate email, invalid credentials,
 * validation failures) are returned as data so the UI can surface them
 * inline. Unexpected errors are never converted into this shape — they
 * throw and are handled by the error boundary.
 */
export type AuthActionErrorCode =
  | 'VALIDATION_ERROR'
  | 'EMAIL_ALREADY_EXISTS'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_USER';

export interface AuthActionError {
  readonly code: AuthActionErrorCode;
  readonly message: string;
  readonly fieldErrors?: Readonly<Record<string, ReadonlyArray<string>>>;
}

export type AuthActionState =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: AuthActionError };
