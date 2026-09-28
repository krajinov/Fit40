/**
 * NotPerformedOccurrence entity (M17 execution fact).
 *
 * One authored occurrence of one enrollment/run that the user explicitly
 * recorded as NOT performed:
 *
 *   identity = (enrollmentId, scheduledWorkoutId)
 *
 * There is deliberately no surrogate id (the `PlannedWorkout` convention): the
 * run and the authored occurrence already identify the fact, and every public
 * route/action addresses the occurrence through its authored coordinates
 * (program slug, week number, workout order) resolved server-side.
 *
 * This is execution truth, not calendar intent. A fact exists on its own terms:
 * no PlannedWorkout row is required for it (it outlives the calendar row being
 * regenerated away), and no WorkoutSession is created, attributed, completed or
 * deleted by it. It is also NOT date-derived — a past-due or future occurrence
 * is never implicitly "not performed", and M15's `past-due` focus state remains
 * a separate concept. M10 owns exercise-level skip semantics; this entity is the
 * workout-occurrence-level fact and shares no vocabulary with it.
 *
 * The fact is immutable and reversible only by DELETION (an application
 * concern). There is therefore deliberately no status column, no
 * restored/undone flag, no reason or note, no planned date, no session id, no
 * user id (the enrollment already carries the owner) and no lifecycle flag:
 * any of them would let a second truth about the same occurrence exist.
 *
 * Invariants enforced at construction:
 * - enrollmentId must be a valid branded EnrollmentId
 * - scheduledWorkoutId must be a valid branded ScheduledWorkoutId
 * - recordedAt must be a valid Date instant
 */

import { err, ok, type Result } from '@/domain/types/result';

import type { EnrollmentId, ScheduledWorkoutId } from '@/domain/types/ids';
import { createEnrollmentId, createScheduledWorkoutId } from '@/domain/types/ids';

export interface NotPerformedOccurrence {
  readonly enrollmentId: EnrollmentId;
  readonly scheduledWorkoutId: ScheduledWorkoutId;
  /** The instant the user recorded the fact (caller-supplied clock). */
  readonly recordedAt: Date;
}

export interface CreateNotPerformedOccurrenceInput {
  readonly enrollmentId: string;
  readonly scheduledWorkoutId: string;
  readonly recordedAt: Date;
}

export interface NotPerformedOccurrenceValidationError {
  readonly code: 'INVALID_NOT_PERFORMED_OCCURRENCE';
  readonly message: string;
  readonly field?: 'enrollmentId' | 'scheduledWorkoutId' | 'recordedAt';
}

function invalid(
  message: string,
  field: NotPerformedOccurrenceValidationError['field'],
): NotPerformedOccurrenceValidationError {
  return { code: 'INVALID_NOT_PERFORMED_OCCURRENCE', message, field };
}

/**
 * Creates a validated NotPerformedOccurrence.
 *
 * `recordedAt` is validated as an instant (the `ProgramEnrollment.enrolledAt`
 * rule) and stored as supplied: the caller owns the clock, so the domain never
 * reads one.
 */
export function createNotPerformedOccurrence(
  input: CreateNotPerformedOccurrenceInput,
): Result<NotPerformedOccurrence, NotPerformedOccurrenceValidationError> {
  const enrollmentIdResult = createEnrollmentId(input.enrollmentId);
  if (!enrollmentIdResult.ok) {
    return err(invalid(enrollmentIdResult.error.message, 'enrollmentId'));
  }

  const scheduledWorkoutIdResult = createScheduledWorkoutId(input.scheduledWorkoutId);
  if (!scheduledWorkoutIdResult.ok) {
    return err(invalid(scheduledWorkoutIdResult.error.message, 'scheduledWorkoutId'));
  }

  if (!(input.recordedAt instanceof Date) || Number.isNaN(input.recordedAt.getTime())) {
    return err(invalid('recordedAt must be a valid Date', 'recordedAt'));
  }

  return ok({
    enrollmentId: enrollmentIdResult.data,
    scheduledWorkoutId: scheduledWorkoutIdResult.data,
    recordedAt: input.recordedAt,
  });
}
