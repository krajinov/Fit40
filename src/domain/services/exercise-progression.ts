/**
 * Progressive overload v2 — pure domain progression engine (orchestration).
 *
 * `calculateNextExerciseTarget` recommends the load for an exercise's next
 * workout from the current prescription and a bounded history window of the
 * user's previous performances of that exercise. It is deterministic and
 * side-effect free: the same inputs always produce the same recommendation.
 *
 * `history` is NEWEST-FIRST: index 0 is the most recent occurrence. The
 * window's SIZE is owned by the Application layer (it bounds the query);
 * the domain consumes only what it receives. Empty history means first
 * exposure.
 *
 * Decision order (first match wins):
 *
 *   1. No history (or newest occurrence without considered sets) → first-exposure
 *   2. Newest occurrence earned under a different scheme           → scheme-change
 *   3. Current prescription is duration-based                      → duration decision
 *   4. Any considered set of the newest occurrence without load    → bodyweight decision
 *   5. Fewer sets logged than prescribed                           → hold
 *   6. All prescribed sets ≥ maxReps on one uniform load            → increase
 *   7. All prescribed sets < minReps:
 *        two newest eligible occurrences both below min            → regress (floored)
 *        only the newest one below min                            → hold
 *   8. Anything else (mixed performance)                           → hold
 *
 * Every decision carries a structured `reason` (see `progression-reason.ts`).
 *
 * Load semantics:
 * - Considered sets are the FIRST `prescription.sets` logged sets of the
 *   newest occurrence. Sets beyond the prescribed count are ignored; when
 *   fewer sets were logged than prescribed, the load holds — increase and
 *   regress are only decided over a complete prescription, regardless of
 *   how the logged sets performed.
 * - The working load is the MINIMUM load across the considered sets:
 *   progression starts from the weakest set, never the strongest.
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
 * Steps 5–8 live in `rep-load-decision.ts` (its unloaded entry gate in
 * `bodyweight-rep-decision.ts`); the duration decision in
 * `duration-target-decision.ts`; the two-occurrence rule in
 * `below-minimum-trend.ts`; compatibility, result shape, and equipment
 * increments each live in their own domain module.
 *
 * `PreviousExercisePerformance` mirrors the load-relevant slice of the
 * application port's history projection (prescription + sets): that
 * projection is structurally assignable to this input, so callers can
 * pass it unchanged.
 */

import type { Exercise } from '@/domain/entities/exercise';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';
import { EQUIPMENT_LOAD_INCREMENT_KG } from '@/domain/services/equipment-load-increments';
import type { NextExerciseTarget } from '@/domain/services/next-exercise-target';
import type { PreviousExercisePerformance } from '@/domain/services/previous-exercise-performance';
import { prescriptionsCompatible } from '@/domain/services/prescription-compatibility';
import { decideRepLoadTarget } from '@/domain/services/rep-load-decision';
import {
  decideDurationTarget,
  DURATION_TARGET_INCREMENT_SECONDS,
} from '@/domain/services/duration-target-decision';

export type { NextExerciseTarget, PreviousExercisePerformance };
export { EQUIPMENT_LOAD_INCREMENT_KG, DURATION_TARGET_INCREMENT_SECONDS };

/**
 * Calculates the next load recommendation for one exercise.
 *
 * `history` is the user's previous completed performances of that exercise,
 * newest first (index 0 = most recent), as bounded by the caller. An empty
 * window is the exercise's first exposure. Only the exercise's equipment,
 * the current prescription, and that history influence the result.
 */
export function calculateNextExerciseTarget(
  exercise: Exercise,
  currentPrescription: RepPrescription,
  history: ReadonlyArray<PreviousExercisePerformance>,
): NextExerciseTarget {
  const [newest] = history;

  if (newest === undefined) {
    return { basis: 'first-exposure', reason: 'no-history' };
  }

  if (!prescriptionsCompatible(newest.prescription, currentPrescription)) {
    return { basis: 'scheme-change', reason: 'scheme-changed' };
  }

  const consideredSets = newest.sets.slice(0, currentPrescription.sets);

  // Defensive: the history port never produces performances with zero sets
  // (a skipped exercise never wins), so empty input acts like no history.
  if (consideredSets.length === 0) {
    return { basis: 'first-exposure', reason: 'no-history' };
  }

  if (currentPrescription.type === 'duration') {
    return decideDurationTarget(currentPrescription, consideredSets);
  }

  return decideRepLoadTarget(
    currentPrescription,
    consideredSets,
    EQUIPMENT_LOAD_INCREMENT_KG[exercise.equipment],
    history.slice(1),
  );
}
