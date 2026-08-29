/**
 * Repetition/duration prescription for a workout exercise.
 *
 * A value object: immutable, no identity, compared by value.
 * Factory functions enforce invariants.
 */

import { err, ok, type Result } from '@/domain/types/result';

export interface PrescriptionValidationError {
  readonly code: 'INVALID_PRESCRIPTION';
  readonly message: string;
}

function invalid(message: string): PrescriptionValidationError {
  return { code: 'INVALID_PRESCRIPTION', message };
}

/**
 * Rep-based prescription, e.g. 3 x 8 or 3 x 8-10.
 */
export interface RepScheme {
  readonly type: 'reps';
  readonly sets: number;
  readonly minReps: number;
  readonly maxReps: number;
}

/**
 * Duration-based prescription, e.g. 3 x 30 seconds.
 */
export interface DurationScheme {
  readonly type: 'duration';
  readonly sets: number;
  readonly seconds: number;
}

export type RepPrescription = RepScheme | DurationScheme;

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * Creates a rep-based prescription.
 *
 * Invariants:
 * - sets, minReps must be positive integers
 * - maxReps must be >= minReps
 */
export function createRepScheme(
  sets: number,
  minReps: number,
  maxReps: number,
): Result<RepPrescription, PrescriptionValidationError> {
  if (!isPositiveInteger(sets)) {
    return err(invalid('sets must be a positive integer'));
  }

  if (!isPositiveInteger(minReps)) {
    return err(invalid('minReps must be a positive integer'));
  }

  if (!Number.isInteger(maxReps) || maxReps < minReps) {
    return err(invalid('maxReps must be an integer >= minReps'));
  }

  return ok({ type: 'reps', sets, minReps, maxReps });
}

/**
 * Creates a duration-based prescription.
 *
 * Invariants:
 * - sets must be a positive integer
 * - seconds must be a positive integer
 */
export function createDurationScheme(
  sets: number,
  seconds: number,
): Result<RepPrescription, PrescriptionValidationError> {
  if (!isPositiveInteger(sets)) {
    return err(invalid('sets must be a positive integer'));
  }

  if (!isPositiveInteger(seconds)) {
    return err(invalid('seconds must be a positive integer'));
  }

  return ok({ type: 'duration', sets, seconds });
}