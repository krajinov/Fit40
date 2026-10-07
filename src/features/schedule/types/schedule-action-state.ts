/**
 * Result of an M15 scheduling Server Action, returned to the client.
 *
 * Expected application errors (validation, lifecycle/stale state, date rules)
 * are returned as data so the UI can surface them inline. Unexpected errors are
 * never converted into this shape — they throw and are handled by the error
 * boundary.
 */
export type ScheduleActionErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_INPUT'
  | 'PROGRAM_NOT_FOUND'
  | 'NOT_ENROLLED'
  | 'INVALID_TRAINING_DAYS'
  | 'SCHEDULED_WORKOUT_NOT_FOUND'
  | 'SCHEDULE_NOT_CONFIGURED'
  | 'PLANNED_WORKOUT_NOT_FOUND'
  | 'INVALID_DATE'
  | 'DATE_IN_PAST'
  | 'WORKOUT_ALREADY_COMPLETED'
  | 'SESSION_IN_PROGRESS'
  | 'DATE_ALREADY_PLANNED'
  | 'SCHEDULE_CHANGED'
  /**
   * M17 Slice 8: the occurrence is recorded as not performed, so it is settled
   * execution truth and cannot be moved. The rendering leaf prints the use
   * case's own message, so this member adds no copy.
   */
  | 'OCCURRENCE_RECORDED_NOT_PERFORMED'
  /**
   * M17 Slice 11 — the settlement actions' vocabulary. Every member below is a
   * Slice 7 Application outcome; the rendering leaf prints the use case's own
   * message, so this union adds no copy of its own and a new Application code
   * fails type-checking here until it is added.
   */
  | 'OCCURRENCE_ALREADY_RECORDED'
  | 'OCCURRENCE_ALREADY_PERFORMED'
  | 'OCCURRENCE_HAS_LOGGED_WORK'
  | 'OCCURRENCE_NOT_RECORDED'
  | 'ENROLLMENT_CHANGED';

export interface ScheduleActionError {
  readonly code: ScheduleActionErrorCode;
  readonly message: string;
}

export type ScheduleActionState =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ScheduleActionError };