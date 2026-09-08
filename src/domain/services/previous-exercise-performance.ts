/**
 * One completed performance (one occurrence) of one exercise, as passed to
 * the progression engine inside a newest-first history window.
 *
 * Reuses the domain's own prescription and set-log shapes — no parallel
 * history types. Set logs are expected ordered by set number, as produced by
 * the history port.
 *
 * Mirrors the load-relevant slice of the application port's history
 * projection (prescription + sets): that projection is structurally
 * assignable to this input, so callers can pass it unchanged.
 *
 * The engine never bounds the window it receives — the Application layer
 * owns the history limit; the domain only consumes what it is given.
 */
import type { SetLog } from '@/domain/entities/workout-session';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

export interface PreviousExercisePerformance {
  readonly prescription: RepPrescription;
  readonly sets: ReadonlyArray<SetLog>;
}
