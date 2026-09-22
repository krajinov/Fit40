/**
 * Boundary mapping for the M11 Add use case's EXPLICIT prescription choice.
 *
 * M11 locked product decision: the user explicitly chooses the prescription
 * when adding an exercise. Reps persist `minReps = maxReps = targetReps` (one
 * explicit target, never an invented range); duration persists
 * `seconds = durationSeconds`. Nothing is inferred from the catalog, the
 * exercise's movement pattern or any built-in default — there are no catalog
 * defaults, no "3x10" default and no AI recommendation.
 *
 * Split from the use case by responsibility (`add-session-exercise.ts`):
 * this module owns the boundary shape validation and the construction of the
 * domain value object, so the orchestration file stays focused.
 */

import { err, ok, type Result } from '@/domain/types/result';
import {
  createDurationScheme,
  createRepScheme,
  type RepPrescription,
} from '@/domain/value-objects/rep-prescription';

// ─── Scheme choices ──────────────────────────────────────────────────────────

/** Explicit REP choice: a number of sets and one rep target. */
export interface AddSessionExerciseRepsChoice {
  readonly scheme: 'reps';
  readonly sets: number;
  readonly targetReps: number;
}

/** Explicit DURATION choice: a number of sets and a duration target. */
export interface AddSessionExerciseDurationChoice {
  readonly scheme: 'duration';
  readonly sets: number;
  readonly durationSeconds: number;
}

/**
 * The explicit prescription choice. The discriminated union makes the two
 * schemes non-interchangeable: a reps choice has no `durationSeconds`, and a
 * duration choice has no `targetReps`, so neither can drive the other's
 * prescription.
 */
export type AddSessionExerciseChoice =
  | AddSessionExerciseRepsChoice
  | AddSessionExerciseDurationChoice;

// ─── Errors & product rules ──────────────────────────────────────────────────

/** Malformed boundary input; surfaces as the caller's `INVALID_INPUT`. */
export interface AddSessionExercisePrescriptionError {
  readonly code: 'INVALID_INPUT';
  readonly message: string;
  readonly field?: string;
}

/**
 * The M11 product rule: a session-added occurrence has NO authored/template
 * rest prescription, so its rest snapshot is an explicit 0 (which the history
 * view already renders as "no rest prescribed"). There is no client or
 * application input for this — it is a product decision, not a user choice.
 */
export const SESSION_ADDED_REST_SECONDS = 0;

// ─── Validation & construction ───────────────────────────────────────────────

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * Shape-validates the explicit prescription choice and returns the field-level
 * rejection, or null when well-formed. This keeps malformed external input
 * from reaching persistence; the authoritative construction below still goes
 * through the domain prescription factories.
 */
export function prescriptionInputError(
  input: AddSessionExerciseChoice,
): AddSessionExercisePrescriptionError | null {
  // Defense at the untrusted boundary: a runtime scheme outside the union is
  // rejected rather than falling through to the wrong factory.
  if (input.scheme !== 'reps' && input.scheme !== 'duration') {
    return {
      code: 'INVALID_INPUT',
      message: "scheme must be 'reps' or 'duration'",
      field: 'scheme',
    };
  }

  if (!isPositiveInteger(input.sets)) {
    return { code: 'INVALID_INPUT', message: 'sets must be a positive integer', field: 'sets' };
  }

  // Only the field belonging to the chosen scheme is authoritative; the other
  // scheme's field is not even present on the narrowed choice.
  if (input.scheme === 'reps') {
    if (!isPositiveInteger(input.targetReps)) {
      return {
        code: 'INVALID_INPUT',
        message: 'targetReps must be a positive integer',
        field: 'targetReps',
      };
    }
    return null;
  }

  if (!isPositiveInteger(input.durationSeconds)) {
    return {
      code: 'INVALID_INPUT',
      message: 'durationSeconds must be a positive integer',
      field: 'durationSeconds',
    };
  }
  return null;
}

/**
 * Builds the occurrence's explicit prescription through the domain value
 * objects. A factory rejection is a malformed input, not an unexpected
 * failure.
 */
export function buildSessionAddedPrescription(
  input: AddSessionExerciseChoice,
): Result<RepPrescription, AddSessionExercisePrescriptionError> {
  const built =
    input.scheme === 'reps'
      ? createRepScheme(input.sets, input.targetReps, input.targetReps)
      : createDurationScheme(input.sets, input.durationSeconds);

  if (!built.ok) {
    return err({ code: 'INVALID_INPUT', message: built.error.message, field: 'prescription' });
  }
  return ok(built.data);
}
