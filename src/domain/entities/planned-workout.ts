/**
 * PlannedWorkout entity (M15 calendar intent).
 *
 * A PlannedWorkout records when the user *intends* to perform one authored
 * program occurrence inside the current enrollment/run:
 *
 *   identity = (enrollmentId, scheduledWorkoutId)
 *
 * There is deliberately no surrogate PlannedWorkoutId: the authored occurrence
 * and the run already identify the intent, and every public route/action
 * addresses the occurrence through its authored coordinates (program slug,
 * week number, workout order) resolved server-side.
 *
 * Calendar intent only. It is NOT execution: what the user actually did lives
 * in WorkoutSession, and progress/completion read only completed sessions.
 * Moving a PlannedWorkout can therefore never complete a workout, change
 * training history, or advance progression.
 *
 * Invariants enforced at construction:
 * - enrollmentId must be a valid branded EnrollmentId
 * - scheduledWorkoutId must be a valid branded ScheduledWorkoutId
 * - plannedDate is a validated PlannedDate value object
 */

import { err, ok, type Result } from '@/domain/types/result';

import type { EnrollmentId, ScheduledWorkoutId } from '@/domain/types/ids';
import { createEnrollmentId, createScheduledWorkoutId } from '@/domain/types/ids';
import type { PlannedDate } from '@/domain/value-objects/planned-date';

export interface PlannedWorkout {
  readonly enrollmentId: EnrollmentId;
  readonly scheduledWorkoutId: ScheduledWorkoutId;
  readonly plannedDate: PlannedDate;
}

export interface CreatePlannedWorkoutInput {
  readonly enrollmentId: string;
  readonly scheduledWorkoutId: string;
  /** A validated date value object; the value object is the date's gate. */
  readonly plannedDate: PlannedDate;
}

export interface PlannedWorkoutValidationError {
  readonly code: 'INVALID_PLANNED_WORKOUT';
  readonly message: string;
  readonly field?: 'enrollmentId' | 'scheduledWorkoutId';
}

function invalid(
  message: string,
  field: PlannedWorkoutValidationError['field'],
): PlannedWorkoutValidationError {
  return { code: 'INVALID_PLANNED_WORKOUT', message, field };
}

/**
 * Creates a validated PlannedWorkout.
 *
 * `plannedDate` is deliberately not re-validated: a PlannedDate can only exist
 * through `createPlannedDate`, so the value object already enforces the date
 * invariant (the `RepPrescription` convention).
 */
export function createPlannedWorkout(
  input: CreatePlannedWorkoutInput,
): Result<PlannedWorkout, PlannedWorkoutValidationError> {
  const enrollmentIdResult = createEnrollmentId(input.enrollmentId);
  if (!enrollmentIdResult.ok) {
    return err(invalid(enrollmentIdResult.error.message, 'enrollmentId'));
  }

  const scheduledWorkoutIdResult = createScheduledWorkoutId(input.scheduledWorkoutId);
  if (!scheduledWorkoutIdResult.ok) {
    return err(invalid(scheduledWorkoutIdResult.error.message, 'scheduledWorkoutId'));
  }

  return ok({
    enrollmentId: enrollmentIdResult.data,
    scheduledWorkoutId: scheduledWorkoutIdResult.data,
    plannedDate: input.plannedDate,
  });
}

/**
 * Returns a new PlannedWorkout moved to `plannedDate`.
 *
 * Pure, total and immutable: the input is never mutated. Eligibility is
 * deliberately NOT decided here — whether a move is allowed (the date is not
 * in the past, no other planned workout of the run occupies it, and the
 * occurrence's session is neither in progress nor completed) depends on the
 * run's current facts, which this entity does not know. Moving to the same
 * date is allowed and yields an equal value.
 */
export function reschedulePlannedWorkout(
  plannedWorkout: PlannedWorkout,
  plannedDate: PlannedDate,
): PlannedWorkout {
  return {
    enrollmentId: plannedWorkout.enrollmentId,
    scheduledWorkoutId: plannedWorkout.scheduledWorkoutId,
    plannedDate,
  };
}
