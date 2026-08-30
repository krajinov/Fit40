/**
 * Progressive overload v1 — pure domain progression engine (orchestration).
 *
 * `calculateNextExerciseTarget` recommends the load for an exercise's next
 * workout from the current prescription and the latest previous performance.
 * It is deterministic and side-effect free: the same inputs always produce
 * the same recommendation.
 *
 * Decision order (first match wins):
 *
 *   1. No previous performance                      → first-exposure
 *   2. Prescription differs from previous history   → scheme-change
 *   3. Current prescription is duration-based        → duration
 *   4. No considered sets (defensive, see below)     → first-exposure
 *   5. Any considered set logged without load         → bodyweight
 *   6. Fewer sets logged than prescribed              → hold
 *   7. All prescribed sets ≥ maxReps on one uniform load → increase
 *   8. All prescribed sets < minReps                  → regress (floored)
 *   9. Anything else (mixed performance)              → hold
 *
 * Load semantics:
 * - Considered sets are the FIRST `prescription.sets` logged sets of the
 *   previous performance. Sets beyond the prescribed count are ignored;
 *   when fewer sets were logged than prescribed, the load holds — increase
 *   and regress are only decided over a complete prescription, regardless
 *   of how the logged sets performed.
 * - The working load is the MINIMUM load across the considered sets:
 *   progression starts from the weakest set, never the strongest.
 * - Regression requires EVERY prescribed set below minReps. Mixed
 *   performance (any set at or above minReps) holds.
 * - `0 kg` is a real external load. Only `weightKg === null` marks an
 *   unweighted (bodyweight) set.
 * - Increasing requires a UNIFORM working load — mixed loads cannot be
 *   progressed by one number, so they hold. Regress uses the minimum load
 *   whether loads are uniform or mixed.
 * - Computed targets are rounded to two decimals so float dust never leaks
 *   into a recommendation (2.6 − 2.5 → 0.1, not 0.10000000000000009).
 * - Regression never recommends a non-positive load: when
 *   `workingLoad − increment` rounds to ≤ 0, the target is `null` — train
 *   the exercise without added load.
 *
 * Steps 5–9 live in `rep-load-decision.ts`; compatibility, result shape, and
 * equipment increments each live in their own domain module.
 *
 * `PreviousExercisePerformance` mirrors the load-relevant slice of the
 * application port's `LatestCompletedExercisePerformance` projection
 * (prescription + sets): that projection is structurally assignable to this
 * input, so callers can pass it unchanged.
 */

import type { Exercise } from '@/domain/entities/exercise';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';
import { EQUIPMENT_LOAD_INCREMENT_KG } from '@/domain/services/equipment-load-increments';
import type { NextExerciseTarget } from '@/domain/services/next-exercise-target';
import type { PreviousExercisePerformance } from '@/domain/services/previous-exercise-performance';
import { prescriptionsCompatible } from '@/domain/services/prescription-compatibility';
import { decideRepLoadTarget } from '@/domain/services/rep-load-decision';

export type { NextExerciseTarget, PreviousExercisePerformance };
export { EQUIPMENT_LOAD_INCREMENT_KG };

/**
 * Calculates the next load recommendation for one exercise.
 *
 * `previousPerformance` is the user's latest completed performance of that
 * exercise (or null when none exists). Only the exercise's equipment, the
 * current prescription, and that performance influence the result.
 */
export function calculateNextExerciseTarget(
  exercise: Exercise,
  currentPrescription: RepPrescription,
  previousPerformance: PreviousExercisePerformance | null,
): NextExerciseTarget {
  if (previousPerformance === null) {
    return { basis: 'first-exposure' };
  }

  if (!prescriptionsCompatible(previousPerformance.prescription, currentPrescription)) {
    return { basis: 'scheme-change' };
  }

  if (currentPrescription.type === 'duration') {
    return { basis: 'duration' };
  }

  const consideredSets = previousPerformance.sets.slice(0, currentPrescription.sets);

  // Defensive: the history port never produces performances with zero sets
  // (a skipped exercise never wins), so empty input acts like no history.
  if (consideredSets.length === 0) {
    return { basis: 'first-exposure' };
  }

  return decideRepLoadTarget(
    currentPrescription,
    consideredSets,
    EQUIPMENT_LOAD_INCREMENT_KG[exercise.equipment],
  );
}
