/**
 * The latest previous performance of one exercise.
 *
 * Reuses the domain's own prescription and set-log shapes — no parallel
 * history types. Set logs are expected ordered by set number, as produced by
 * the history port.
 *
 * Mirrors the load-relevant slice of the application port's
 * `LatestCompletedExercisePerformance` projection (prescription + sets):
 * that projection is structurally assignable to this input, so callers can
 * pass it unchanged.
 */
import type { SetLog } from '@/domain/entities/workout-session';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

export interface PreviousExercisePerformance {
  readonly prescription: RepPrescription;
  readonly sets: ReadonlyArray<SetLog>;
}
