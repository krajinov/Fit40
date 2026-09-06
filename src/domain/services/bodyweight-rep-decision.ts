/**
 * Bodyweight (unloaded) rep progression — the engine's decision for a reps
 * prescription whose considered sets carry no external load.
 *
 * Semantics (advisory, deterministic — R1):
 *
 * - The authored prescription IS the progression surface: the decision can
 *   only confirm it (goal reached) or repeat it (hold). It never invents a
 *   load, a harder variation, or a substitution — those are program
 *   authoring choices, not engine outputs.
 * - GOAL REACHED: every prescribed set was logged and reached the top of
 *   the authored rep range. The range was fully earned, so the
 *   prescription repeats as written.
 * - HOLD: an incomplete log, or any complete log with a set below the top,
 *   repeats the prescription.
 * - Bodyweight work never REGRESSES — there is no load to reduce — so the
 *   two-occurrence rule (R2) never applies and history beyond the newest
 *   occurrence is never read.
 * - `weightKg === null` is how unloaded sets are logged; a logged `0 kg`
 *   is a real external load and never routes here.
 * - Sets beyond the prescribed count are ignored (the engine's
 *   considered-sets slice).
 * - RPE is deferred and never read.
 *
 * A logged set whose type contradicts the prescription cannot confirm the
 * top of the range, so it can only hold — the session entity never
 * produces such sets; this is purely defensive.
 */
import type { SetLog } from '@/domain/entities/workout-session';
import type { NextExerciseTarget } from '@/domain/services/next-exercise-target';
import type { RepScheme } from '@/domain/value-objects/rep-prescription';

/**
 * Decides the next target for an unloaded reps prescription over its
 * considered sets — the FIRST `prescription.sets` logged sets of the
 * newest occurrence, each logged without external load.
 */
export function decideBodyweightRepTarget(
  prescription: RepScheme,
  consideredSets: ReadonlyArray<SetLog>,
): NextExerciseTarget {
  // Incomplete performance never changes the recommendation.
  if (consideredSets.length < prescription.sets) {
    return { basis: 'bodyweight-hold', reason: 'incomplete-sets' };
  }

  const reachedTopOfRange = consideredSets.every(
    (set) => set.type === 'reps' && set.reps >= prescription.maxReps,
  );

  if (reachedTopOfRange) {
    return { basis: 'bodyweight-goal-reached', reason: 'all-sets-at-top-of-range' };
  }

  return { basis: 'bodyweight-hold', reason: 'reps-below-top-of-range' };
}
