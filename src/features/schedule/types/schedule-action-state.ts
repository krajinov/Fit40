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
  | 'SCHEDULE_CHANGED';

export interface ScheduleActionError {
  readonly code: ScheduleActionErrorCode;
  readonly message: string;
}

export type ScheduleActionState =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ScheduleActionError };