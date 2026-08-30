/**
 * Load decision for a reps prescription over its considered sets — the
 * engine's steps 5–9 of the documented decision order.
 *
 * Decision order (first match wins):
 *
 *   5. Any considered set logged without load         → bodyweight
 *   6. Fewer sets logged than prescribed              → hold
 *   7. All prescribed sets ≥ maxReps on one uniform load → increase
 *   8. All prescribed sets < minReps                  → regress (floored)
 *   9. Anything else (mixed performance)              → hold
 *
 * Load semantics:
 * - `0 kg` is a real external load. Only `weightKg === null` marks an
 *   unweighted (bodyweight) set.
 * - The working load is the MINIMUM load across the considered sets:
 *   progression starts from the weakest set, never the strongest.
 * - Increasing requires a UNIFORM working load — mixed loads cannot be
 *   progressed by one number, so they hold. Regress uses the minimum load
 *   whether loads are uniform or mixed.
 * - Computed targets are rounded to two decimals so float dust never leaks
 *   into a recommendation (2.6 − 2.5 → 0.1, not 0.10000000000000009).
 * - Regression never recommends a non-positive load: when
 *   `workingLoad − increment` rounds to ≤ 0, the target is `null` — train
 *   the exercise without added load.
 *
 * `consideredSets` must be non-empty (the engine guards). A logged set whose
 * type contradicts the prescription can neither confirm target reps nor a
 * failed minimum, so it can only lead to a hold — the session entity never
 * produces such sets; this is purely defensive.
 */
import type { SetLog } from '@/domain/entities/workout-session';
import type { NextExerciseTarget } from '@/domain/services/next-exercise-target';
import type { RepScheme } from '@/domain/value-objects/rep-prescription';

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Uniform increase: add the equipment increment to the working load. */
function increaseTarget(previousLoadKg: number, incrementKg: number): NextExerciseTarget {
  return {
    basis: 'increase',
    previousLoadKg,
    nextLoadKg: roundToTwoDecimals(previousLoadKg + incrementKg),
    incrementKg,
  };
}

/**
 * Floored regress: remove the equipment increment from the working load
 * (the minimum load across the considered sets).
 */
function regressTarget(previousLoadKg: number, incrementKg: number): NextExerciseTarget {
  const reducedLoadKg = roundToTwoDecimals(previousLoadKg - incrementKg);
  return {
    basis: 'regress',
    previousLoadKg,
    nextLoadKg: reducedLoadKg <= 0 ? null : reducedLoadKg,
    incrementKg,
  };
}

/** Keep the working load unchanged. */
function holdAt(previousLoadKg: number): NextExerciseTarget {
  return { basis: 'hold', previousLoadKg, nextLoadKg: previousLoadKg };
}

/**
 * Decides the load target for a reps prescription over its considered sets.
 * `consideredSets` holds the FIRST `prescription.sets` logged sets of the
 * previous performance and is non-empty (the engine guards).
 */
export function decideRepLoadTarget(
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
    return holdAt(workingLoadKg);
  }

  const reachedTarget = consideredSets.every(
    (set) => set.type === 'reps' && set.reps >= prescription.maxReps,
  );
  const allSetsBelowMinimum = consideredSets.every(
    (set) => set.type === 'reps' && set.reps < prescription.minReps,
  );
  const uniformLoad = loads.every((load) => load === workingLoadKg);

  if (reachedTarget && uniformLoad) {
    return increaseTarget(workingLoadKg, incrementKg);
  }

  if (allSetsBelowMinimum) {
    return regressTarget(workingLoadKg, incrementKg);
  }

  return holdAt(workingLoadKg);
}
