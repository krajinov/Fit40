/**
 * Duration (timed) progression — the engine's decision for a duration
 * prescription (e.g. 3 × 30 s), in seconds.
 *
 * Semantics (advisory, deterministic — R1):
 *
 * - The single progression step is a FIXED +5 seconds (R3) added to the
 *   CURRENT scheme's target — never a percentage of it and never anchored
 *   to the longest set actually logged (a 60 s hold in history does not
 *   accelerate a 30 s scheme).
 * - The exact boundary counts: a set logged at exactly the scheme's
 *   seconds reaches the target.
 * - HOLD: an incomplete log, or a complete log with any set below the
 *   target, repeats the scheme.
 * - Timed work never REGRESSES — there is no load to reduce — so the
 *   two-occurrence rule (R2) never applies and history beyond the newest
 *   occurrence is never read.
 * - Loads on timed sets are ignored: a `weightKg === null` set never
 *   becomes `0 kg`, a logged `0 kg` stays a truthful zero, and the
 *   decision never emits a load either way — timed work progresses by
 *   time.
 * - Sets beyond the prescribed count are ignored (the engine's
 *   considered-sets slice).
 * - RPE is deferred and never read.
 *
 * A logged set whose type contradicts the prescription cannot confirm the
 * target, so it can only hold — the session entity never produces such
 * sets; this is purely defensive.
 */
import type { SetLog } from '@/domain/entities/workout-session';
import type { NextExerciseTarget } from '@/domain/services/next-exercise-target';
import type { DurationScheme } from '@/domain/value-objects/rep-prescription';

/**
 * The fixed duration progression step (R3): every increase extends the
 * scheme's seconds by exactly this many.
 */
export const DURATION_TARGET_INCREMENT_SECONDS: number = 5;

/**
 * Decides the next target for a duration prescription over its considered
 * sets — the FIRST `prescription.sets` logged sets of the newest
 * occurrence.
 */
export function decideDurationTarget(
  prescription: DurationScheme,
  consideredSets: ReadonlyArray<SetLog>,
): NextExerciseTarget {
  // Incomplete performance never changes the recommendation.
  if (consideredSets.length < prescription.sets) {
    return {
      basis: 'duration-hold',
      reason: 'incomplete-sets',
      previousSeconds: prescription.seconds,
      nextSeconds: prescription.seconds,
    };
  }

  const reachedTargetSeconds = consideredSets.every(
    (set) => set.type === 'duration' && set.durationSeconds >= prescription.seconds,
  );

  if (reachedTargetSeconds) {
    return {
      basis: 'duration-increase',
      reason: 'all-sets-at-target-duration',
      previousSeconds: prescription.seconds,
      nextSeconds: prescription.seconds + DURATION_TARGET_INCREMENT_SECONDS,
      incrementSeconds: DURATION_TARGET_INCREMENT_SECONDS,
    };
  }

  return {
    basis: 'duration-hold',
    reason: 'sets-below-target-duration',
    previousSeconds: prescription.seconds,
    nextSeconds: prescription.seconds,
  };
}
