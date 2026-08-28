/**
 * Result of a profile Server Action, returned to the client.
 *
 * Expected application errors (validation failures, profile already exists,
 * profile not found) are returned as data so the UI can surface them inline.
 * Unexpected errors are never converted into this shape — they throw and are
 * handled by the error boundary.
 *
 * `ok === false` may carry the submitted field values so the form can preserve
 * them across expected errors. Profile fields carry no sensitive data, so all
 * echoed values are safe to return. `ok === true` carries `saved === true`
 * only when it is the result of a completed action; the idle initial state
 * has no `saved`, so success banners do not flash before any submission.
 */
export type ProfileActionErrorCode =
  | 'VALIDATION_ERROR'
  | 'PROFILE_ALREADY_EXISTS'
  | 'PROFILE_NOT_FOUND'
  | 'INVALID_PROFILE';

export interface ProfileActionError {
  readonly code: ProfileActionErrorCode;
  readonly message: string;
  readonly fieldErrors?: Readonly<Record<string, ReadonlyArray<string>>>;
}

/**
 * Raw submitted form values, echoed back for preservation on expected errors.
 */
export interface ProfileFormEcho {
  readonly birthYear: string;
  readonly experienceLevel: string;
  readonly primaryGoal: string;
  readonly availableEquipment: ReadonlyArray<string>;
  readonly physicalConsiderations: ReadonlyArray<string>;
  readonly preferredDaysPerWeek: string;
  readonly preferredSessionMinutes: string;
  readonly heightCm: string;
  readonly weightValue: string;
  readonly weightUnit: string;
}

export type ProfileActionState =
  | { readonly ok: true; readonly saved?: boolean }
  | { readonly ok: false; readonly values?: ProfileFormEcho; readonly error: ProfileActionError };
