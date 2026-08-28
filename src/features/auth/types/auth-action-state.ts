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

/**
 * `AuthActionState.ok === false` may carry the user-submitted email so the
 * form can preserve it across expected errors (validation failure, duplicate
 * email, invalid credentials). Credentials are NEVER part of action state —
 * password fields intentionally clear after submission.
 */
export type AuthActionState =
  | { readonly ok: true }
  | { readonly ok: false; readonly email?: string; readonly error: AuthActionError };
