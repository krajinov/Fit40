/**
 * Progressive overload v1 — pure domain progression engine.
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
 * `PreviousExercisePerformance` mirrors the load-relevant slice of the
 * application port's `LatestCompletedExercisePerformance` projection
 * (prescription + sets): that projection is structurally assignable to this
 * input, so callers can pass it unchanged.
 */

import type { Exercise } from '@/domain/entities/exercise';
import type { SetLog } from '@/domain/entities/workout-session';
import { EquipmentType } from '@/domain/types/exercise';
import type { RepPrescription, RepScheme } from '@/domain/value-objects/rep-prescription';

// ─── Equipment Load Increments ───────────────────────────────────────────────

/**
 * Load increment (kg) applied per equipment type.
 *
 * Barbell, dumbbell, kettlebell, and machine use their standard plate/stack
 * steps; every other equipment falls back to the default 2.5 kg step. Total
 * over `EquipmentType` on purpose: adding an equipment type becomes a compile
 * error until a step is chosen for it.
 */
export const EQUIPMENT_LOAD_INCREMENT_KG: Record<EquipmentType, number> = {
  [EquipmentType.Barbell]: 2.5,
  [EquipmentType.Dumbbell]: 2,
  [EquipmentType.Kettlebell]: 4,
  [EquipmentType.Machine]: 2.5,
  [EquipmentType.Bodyweight]: 2.5,
  [EquipmentType.ResistanceBand]: 2.5,
  [EquipmentType.Bench]: 2.5,
  [EquipmentType.PullUpBar]: 2.5,
};

// ─── Input ───────────────────────────────────────────────────────────────────

/**
 * The latest previous performance of one exercise.
 *
 * Reuses the domain's own prescription and set-log shapes — no parallel
 * history types. Set logs are expected ordered by set number, as produced by
 * the history port.
 */
export interface PreviousExercisePerformance {
  readonly prescription: RepPrescription;
  readonly sets: ReadonlyArray<SetLog>;
}

// ─── Result ──────────────────────────────────────────────────────────────────

/**
 * Discriminated recommendation for an exercise's next workout load.
 */
export type NextExerciseTarget =
  /** No history: the exercise has not been performed under any scheme yet. */
  | { readonly basis: 'first-exposure' }
  /** The prescription changed: history earned under the old scheme cannot drive load. */
  | { readonly basis: 'scheme-change' }
  /** Duration-based prescription: v1 progresses timed work via the scheme, not load. */
  | { readonly basis: 'duration' }
  /** A considered set was logged without load: no external load to progress. */
  | { readonly basis: 'bodyweight' }
  /**
   * Every considered set reached maxReps on one uniform load: add the
   * equipment increment.
   */
  | {
      readonly basis: 'increase';
      readonly previousLoadKg: number;
      readonly nextLoadKg: number;
      readonly incrementKg: number;
    }
  /**
   * Keep the working load: mixed or incomplete performance, or reps between
   * minReps and maxReps.
   */
  | { readonly basis: 'hold'; readonly previousLoadKg: number; readonly nextLoadKg: number }
  /**
   * Every prescribed set fell below minReps: remove the equipment increment.
   * `nextLoadKg` is null when the reduction floors at or below zero —
   * perform the exercise without added load.
   */
  | {
      readonly basis: 'regress';
      readonly previousLoadKg: number;
      readonly nextLoadKg: number | null;
      readonly incrementKg: number;
    };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Exact scheme compatibility: same set type, same set count, and the same
 * per-type targets (min/max reps, or seconds). Any difference means the
 * history was earned under a different scheme.
 */
function prescriptionsCompatible(previous: RepPrescription, current: RepPrescription): boolean {
  if (previous.type === 'reps' && current.type === 'reps') {
    return (
      previous.sets === current.sets &&
      previous.minReps === current.minReps &&
      previous.maxReps === current.maxReps
    );
  }

  if (previous.type === 'duration' && current.type === 'duration') {
    return previous.sets === current.sets && previous.seconds === current.seconds;
  }

  return false;
}

/**
 * Load decision for a reps prescription over its considered sets.
 *
 * `consideredSets` must be non-empty (the caller guards). Decision order:
 * bodyweight (any unweighted set) → hold (fewer sets than prescribed) →
 * increase (all sets ≥ maxReps on one uniform load) → regress (all sets
 * < minReps) → hold (mixed performance).
 *
 * A logged set whose type contradicts the prescription can neither confirm
 * target reps nor a failed minimum, so it can only lead to a hold — the
 * session entity never produces such sets; this is purely defensive.
 */
function decideRepLoadTarget(
  prescription: RepScheme,
  consideredSets: ReadonlyArray<SetLog>,
  incrementKg: number,
): NextExerciseTarget {
  const loads: number[] = [];
  for (const set of consideredSets) {
    if (set.weightKg === null) {
      return { basis: 'bodyweight' };
    }
    loads.push(set.weightKg);
  }

  const workingLoadKg = Math.min(...loads);

  // Incomplete performance never changes the load: increase and regress are
  // only decided when every prescribed set was logged, regardless of how the
  // logged sets performed.
  if (consideredSets.length < prescription.sets) {
    return { basis: 'hold', previousLoadKg: workingLoadKg, nextLoadKg: workingLoadKg };
  }

  const reachedTarget = consideredSets.every(
    (set) => set.type === 'reps' && set.reps >= prescription.maxReps,
  );
  const allSetsBelowMinimum = consideredSets.every(
    (set) => set.type === 'reps' && set.reps < prescription.minReps,
  );
  const uniformLoad = loads.every((load) => load === workingLoadKg);

  if (reachedTarget && uniformLoad) {
    return {
      basis: 'increase',
      previousLoadKg: workingLoadKg,
      nextLoadKg: roundToTwoDecimals(workingLoadKg + incrementKg),
      incrementKg,
    };
  }

  if (allSetsBelowMinimum) {
    const reducedLoadKg = roundToTwoDecimals(workingLoadKg - incrementKg);
    return {
      basis: 'regress',
      previousLoadKg: workingLoadKg,
      nextLoadKg: reducedLoadKg <= 0 ? null : reducedLoadKg,
      incrementKg,
    };
  }

  return {
    basis: 'hold',
    previousLoadKg: workingLoadKg,
    nextLoadKg: workingLoadKg,
  };
}

// ─── Engine ───────────────────────────────────────────────────────────────────

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

