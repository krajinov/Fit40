/**
 * Two-occurrence regression protection — the eligibility and streak rules
 * behind the engine's regress decision (progressive overload v2, R2).
 *
 * A single below-minimum session is never load-reducing evidence on its
 * own — it may just be an off day. The engine may reduce a working load
 * only when the TWO NEWEST ELIGIBLE occurrences both fell below the
 * current prescription's minimum.
 *
 * ELIGIBILITY — an occurrence is judgeable against the current prescription
 * only when:
 * - its prescription is compatible with the current one (same set count and
 *   rep range — see `prescription-compatibility.ts`), so the same minimum
 *   applies to both data points;
 * - every prescribed set was logged — an incomplete log can neither confirm
 *   a target nor a failed minimum (the same conservative rule that governs
 *   the newest occurrence);
 * - every considered set is externally loaded — an unloaded log says
 *   nothing about load.
 *
 * Ineligible occurrences (other schemes, incomplete logs, unloaded logs)
 * are SKIPPED, not treated as streak-breakers: they are no evidence either
 * way, so a below-minimum streak counts across them. The first ELIGIBLE
 * occurrence in the window decides the check: it either confirms the streak
 * (it also fell below the minimum) or breaks it.
 */
import type { SetLog } from '@/domain/entities/workout-session';
import type { PreviousExercisePerformance } from '@/domain/services/previous-exercise-performance';
import { prescriptionsCompatible } from '@/domain/services/prescription-compatibility';
import type { RepScheme } from '@/domain/value-objects/rep-prescription';

/** The FIRST `prescription.sets` logged sets of an occurrence (port order: by set number). */
function consideredSets(
  prescription: RepScheme,
  occurrence: PreviousExercisePerformance,
): ReadonlyArray<SetLog> {
  return occurrence.sets.slice(0, prescription.sets);
}

/** Whether the occurrence is eligible for the trend judgment (see ELIGIBILITY above). */
function isEligible(prescription: RepScheme, occurrence: PreviousExercisePerformance): boolean {
  if (!prescriptionsCompatible(occurrence.prescription, prescription)) {
    return false;
  }
  const considered = consideredSets(prescription, occurrence);
  return (
    considered.length === prescription.sets && considered.every((set) => set.weightKg !== null)
  );
}

/** Whether an eligible occurrence fell below the minimum on every considered set. */
function belowMinimum(prescription: RepScheme, occurrence: PreviousExercisePerformance): boolean {
  return consideredSets(prescription, occurrence).every(
    (set) => set.type === 'reps' && set.reps < prescription.minReps,
  );
}

/**
 * Whether the newest ELIGIBLE prior occurrence ALSO fell below the
 * prescription's minimum — the second data point of the two-occurrence
 * regression rule.
 *
 * `priorPerformances` is the history window WITHOUT its newest entry (that
 * occurrence was already judged by the load decision), newest first.
 */
export function hasConsecutiveBelowMinimumOccurrence(
  prescription: RepScheme,
  priorPerformances: ReadonlyArray<PreviousExercisePerformance>,
): boolean {
  for (const occurrence of priorPerformances) {
    if (!isEligible(prescription, occurrence)) {
      continue;
    }
    return belowMinimum(prescription, occurrence);
  }
  return false;
}
